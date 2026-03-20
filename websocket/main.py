"""
SkyStream WebSocket Server
Broadcasts real-time aircraft positions to connected browser clients.
Data is served primarily from Redis; falls back to TimescaleDB when Redis is empty.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("skystream.websocket")

# ── Configuration ─────────────────────────────────────────────────────────────
REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379")
POSTGRES_DSN: str = os.getenv(
    "POSTGRES_DSN", "postgresql://postgres:postgres@postgres:5432/skystream"
)
WS_BROADCAST_INTERVAL_MS: int = int(os.getenv("WS_BROADCAST_INTERVAL_MS", "5000"))
BROADCAST_INTERVAL_S: float = WS_BROADCAST_INTERVAL_MS / 1000.0
OPENSKY_USERNAME: str = os.getenv("OPENSKY_USERNAME", "")
OPENSKY_PASSWORD: str = os.getenv("OPENSKY_PASSWORD", "")
FLIGHTAWARE_API_KEY: str = os.getenv("FLIGHTAWARE_API_KEY", "")

# ── Postgres fallback query ───────────────────────────────────────────────────
_PG_FALLBACK_QUERY = """
SELECT DISTINCT ON (icao24)
    icao24,
    callsign,
    latitude   AS lat,
    longitude  AS lon,
    baro_altitude AS altitude,
    velocity,
    true_track AS heading,
    on_ground,
    flight_phase
FROM flight_states
WHERE time > now() - interval '30 seconds'
ORDER BY icao24, time DESC
"""

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="SkyStream WebSocket API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Connection manager ────────────────────────────────────────────────────────

class ConnectionManager:
    """Manages the set of active WebSocket connections and fan-out broadcasts."""

    def __init__(self) -> None:
        self._active: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._active.add(websocket)
        logger.info(
            "Client connected: %s. Total connections: %d",
            websocket.client,
            len(self._active),
        )

    def disconnect(self, websocket: WebSocket) -> None:
        self._active.discard(websocket)
        logger.info(
            "Client disconnected: %s. Total connections: %d",
            websocket.client,
            len(self._active),
        )

    async def broadcast(self, message: str) -> None:
        """Send message to all connected clients; silently drop broken connections."""
        dead: list[WebSocket] = []
        for ws in list(self._active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._active.discard(ws)

    @property
    def connection_count(self) -> int:
        return len(self._active)


manager = ConnectionManager()

# ── Application state (Redis + Postgres pools) ────────────────────────────────

class AppState:
    redis_client: Optional[aioredis.Redis] = None
    pg_pool: Optional[asyncpg.Pool] = None


state = AppState()


@app.on_event("startup")
async def startup() -> None:
    logger.info("Connecting to Redis at %s", REDIS_URL)
    try:
        state.redis_client = aioredis.from_url(
            REDIS_URL, encoding="utf-8", decode_responses=True
        )
        await state.redis_client.ping()
        logger.info("Redis connection established.")
    except Exception as exc:
        logger.error("Could not connect to Redis: %s", exc)
        state.redis_client = None

    logger.info("Connecting to Postgres at %s", POSTGRES_DSN)
    try:
        state.pg_pool = await asyncpg.create_pool(
            POSTGRES_DSN,
            min_size=1,
            max_size=5,
            command_timeout=10,
        )
        logger.info("Postgres pool established.")
    except Exception as exc:
        logger.error("Could not connect to Postgres: %s", exc)
        state.pg_pool = None

    # Start the background broadcast task.
    asyncio.create_task(broadcast_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if state.redis_client:
        await state.redis_client.aclose()
    if state.pg_pool:
        await state.pg_pool.close()


# ── Data fetchers ─────────────────────────────────────────────────────────────

def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes")
    return bool(value)


STALE_THRESHOLD = timedelta(minutes=2)


async def fetch_from_redis() -> list[dict]:
    """Return fresh aircraft records from the Redis 'flights' hash (max 2 min old)."""
    if state.redis_client is None:
        return []
    try:
        raw: dict[str, str] = await state.redis_client.hgetall("flights")
        now = datetime.now(timezone.utc)
        aircraft = []
        stale_keys: list[str] = []
        for icao24, payload in raw.items():
            try:
                rec = json.loads(payload)
                # Drop entries that haven't been updated recently
                ingested_str = rec.get("ingested_at") or rec.get("time")
                if ingested_str:
                    try:
                        ingested_at = datetime.fromisoformat(
                            ingested_str.replace("Z", "+00:00")
                        )
                        if ingested_at.tzinfo is None:
                            ingested_at = ingested_at.replace(tzinfo=timezone.utc)
                        if now - ingested_at > STALE_THRESHOLD:
                            stale_keys.append(icao24)
                            continue
                    except (ValueError, TypeError):
                        pass
                aircraft.append(
                    {
                        "icao24": icao24,
                        "callsign": rec.get("callsign"),
                        "lat": _safe_float(rec.get("latitude")),
                        "lon": _safe_float(rec.get("longitude")),
                        "altitude": _safe_float(rec.get("baro_altitude")),
                        "velocity": _safe_float(rec.get("velocity")),
                        "heading": _safe_float(rec.get("true_track")),
                        "on_ground": _safe_bool(rec.get("on_ground", False)),
                        "flight_phase": rec.get("flight_phase", "CRUISE"),
                    }
                )
            except (json.JSONDecodeError, KeyError) as exc:
                logger.debug("Skipping malformed Redis record for %s: %s", icao24, exc)
        if stale_keys:
            logger.debug("Filtered %d stale aircraft from broadcast.", len(stale_keys))
        return aircraft
    except Exception as exc:
        logger.warning("Redis fetch failed: %s", exc)
        return []


async def fetch_from_postgres() -> list[dict]:
    """Fallback: query TimescaleDB for recent aircraft positions."""
    if state.pg_pool is None:
        return []
    try:
        async with state.pg_pool.acquire() as conn:
            rows = await conn.fetch(_PG_FALLBACK_QUERY)
        return [
            {
                "icao24": r["icao24"],
                "callsign": r["callsign"],
                "lat": r["lat"],
                "lon": r["lon"],
                "altitude": r["altitude"],
                "velocity": r["velocity"],
                "heading": r["heading"],
                "on_ground": r["on_ground"],
                "flight_phase": r["flight_phase"],
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("Postgres fallback fetch failed: %s", exc)
        return []


async def get_aircraft() -> list[dict]:
    """Fetch aircraft data, preferring Redis and falling back to Postgres."""
    aircraft = await fetch_from_redis()
    if not aircraft:
        logger.debug("Redis empty or unavailable – falling back to Postgres.")
        aircraft = await fetch_from_postgres()
    return aircraft


# ── Background broadcast loop ─────────────────────────────────────────────────

async def broadcast_loop() -> None:
    """Continuously fetch aircraft data and broadcast to all WebSocket clients."""
    logger.info(
        "Broadcast loop started. Interval: %.1fs (%dms)",
        BROADCAST_INTERVAL_S,
        WS_BROADCAST_INTERVAL_MS,
    )
    while True:
        await asyncio.sleep(BROADCAST_INTERVAL_S)
        if manager.connection_count == 0:
            continue
        try:
            aircraft = await get_aircraft()
            payload = json.dumps(
                {
                    "type": "positions",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "count": len(aircraft),
                    "aircraft": aircraft,
                }
            )
            await manager.broadcast(payload)
            logger.debug("Broadcast %d aircraft to %d clients.", len(aircraft), manager.connection_count)
        except Exception as exc:
            logger.error("Broadcast loop error: %s", exc)


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

_TRAILS_QUERY = """
SELECT icao24, lat, lon, flight_phase
FROM (
    SELECT
        icao24,
        latitude    AS lat,
        longitude   AS lon,
        flight_phase,
        ROW_NUMBER() OVER (PARTITION BY icao24 ORDER BY time DESC) AS rn
    FROM flight_states
    WHERE time > now() - interval '15 minutes'
      AND latitude  IS NOT NULL
      AND longitude IS NOT NULL
) t
WHERE rn <= 15
ORDER BY icao24, rn DESC
"""


_FULL_TRAIL_QUERY = """
WITH transitions AS (
    SELECT
        time,
        flight_phase,
        LAG(flight_phase) OVER (ORDER BY time) AS prev_phase
    FROM flight_states
    WHERE icao24 = $1
      AND time > now() - interval '48 hours'
),
last_takeoff AS (
    SELECT time AS takeoff_time
    FROM transitions
    WHERE flight_phase != 'GROUND'
      AND (prev_phase = 'GROUND' OR prev_phase IS NULL)
    ORDER BY time DESC
    LIMIT 1
)
SELECT
    latitude  AS lat,
    longitude AS lon,
    flight_phase
FROM flight_states
WHERE icao24 = $1
  AND latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND time >= COALESCE(
      (SELECT takeoff_time FROM last_takeoff),
      now() - interval '24 hours'
  )
ORDER BY time ASC
"""


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/trails")
async def get_trails() -> JSONResponse:
    """Return the last 15 positions per aircraft from the past 15 minutes."""
    if state.pg_pool is None:
        return JSONResponse({"trails": []})
    try:
        async with state.pg_pool.acquire() as conn:
            rows = await conn.fetch(_TRAILS_QUERY)

        trails: dict[str, dict] = {}
        for r in rows:
            icao24 = r["icao24"]
            if icao24 not in trails:
                trails[icao24] = {"icao24": icao24, "path": [], "phase": r["flight_phase"]}
            trails[icao24]["path"].append([r["lon"], r["lat"]])
            trails[icao24]["phase"] = r["flight_phase"]

        return JSONResponse({"trails": [t for t in trails.values() if len(t["path"]) > 1]})
    except Exception as exc:
        logger.warning("Trails fetch failed: %s", exc)
        return JSONResponse({"trails": []})



@app.get("/trail/{icao24}")
async def get_full_trail(icao24: str, callsign: str = "") -> JSONResponse:
    """Return the full flight path from TimescaleDB."""
    local_path: list = []
    local_phase = "CRUISE"
    if state.pg_pool is not None:
        try:
            async with state.pg_pool.acquire() as conn:
                rows = await conn.fetch(_FULL_TRAIL_QUERY, icao24.lower())
            local_path = [[r["lon"], r["lat"]] for r in rows]
            local_phase = rows[-1]["flight_phase"] if rows else "CRUISE"
        except Exception as exc:
            logger.warning("Local trail fetch failed for %s: %s", icao24, exc)

    return JSONResponse({"icao24": icao24, "path": local_path, "phase": local_phase})


@app.get("/aircraft")
async def aircraft_snapshot() -> JSONResponse:
    """REST endpoint returning the current aircraft snapshot (useful for debugging)."""
    data = await get_aircraft()
    return JSONResponse(
        {
            "type": "positions",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "count": len(data),
            "aircraft": data,
        }
    )


# ── Route lookup (FlightAware) ────────────────────────────────────────────────

_ROUTE_CACHE_TTL = 43200  # 12 hours


@app.get("/route/{icao24}")
async def get_route(icao24: str, callsign: str = "") -> JSONResponse:
    """Return origin/destination airports using FlightAware AeroAPI (Redis-cached)."""
    if not FLIGHTAWARE_API_KEY or not callsign.strip():
        return JSONResponse({"origin": None, "destination": None})

    cs = callsign.strip()
    cache_key = f"route:{cs}"

    # ── Check Redis cache first ────────────────────────────────────────────────
    if state.redis_client:
        try:
            cached = await state.redis_client.get(cache_key)
            if cached:
                logger.debug("Route cache hit for %s", cs)
                return JSONResponse(json.loads(cached))
        except Exception:
            pass

    # ── Call FlightAware ───────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://aeroapi.flightaware.com/aeroapi/flights/{cs}",
                headers={"x-apikey": FLIGHTAWARE_API_KEY},
                params={"max_pages": 1},
                timeout=10,
            )
        if not resp.is_success:
            logger.warning("FlightAware route fetch returned %d for %s", resp.status_code, cs)
            return JSONResponse({"origin": None, "destination": None})
        flights = resp.json().get("flights", [])
        # Prefer currently airborne: departed but not yet landed
        flight = next(
            (f for f in flights if f.get("actual_off") and not f.get("actual_on")),
            None,
        )
        # Fallback: En Route status (some flights don't set actual_off)
        if not flight:
            flight = next(
                (f for f in flights if "En Route" in f.get("status", "")),
                None,
            )
        # Fallback: most recently departed
        if not flight:
            departed = [f for f in flights if f.get("actual_off")]
            if departed:
                flight = max(departed, key=lambda f: f["actual_off"])
        if not flight:
            return JSONResponse({"origin": None, "destination": None})
        origin = flight.get("origin") or {}
        dest = flight.get("destination") or {}
        if not origin or not dest:
            return JSONResponse({"origin": None, "destination": None})
        dep_delay = flight.get("departure_delay") or 0
        arr_delay = flight.get("arrival_delay") or 0
        result = {
            "origin": {
                "iata_code": origin.get("code_iata") or origin.get("code", ""),
                "municipality": origin.get("city", ""),
                "name": origin.get("name", ""),
            },
            "destination": {
                "iata_code": dest.get("code_iata") or dest.get("code", ""),
                "municipality": dest.get("city", ""),
                "name": dest.get("name", ""),
            },
            "aircraft_type": flight.get("aircraft_type"),
            "flight_number": flight.get("ident_iata") or flight.get("ident"),
            "status": flight.get("status"),
            "departure_delay": dep_delay,
            "arrival_delay": arr_delay,
            "route_distance": flight.get("route_distance"),
            "estimated_on": flight.get("estimated_on"),
            "actual_on": flight.get("actual_on"),
            "scheduled_on": flight.get("scheduled_on"),
            "fa_flight_id": flight.get("fa_flight_id"),
        }
        # ── Store in Redis cache ───────────────────────────────────────────────
        if state.redis_client:
            try:
                await state.redis_client.setex(cache_key, _ROUTE_CACHE_TTL, json.dumps(result))
            except Exception:
                pass
        return JSONResponse(result)
    except Exception as exc:
        logger.warning("FlightAware route fetch failed for %s: %s", cs, exc)
        return JSONResponse({"origin": None, "destination": None})


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    # Send an immediate snapshot so the client doesn't wait for the first interval.
    try:
        aircraft = await get_aircraft()
        await websocket.send_text(
            json.dumps(
                {
                    "type": "positions",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "count": len(aircraft),
                    "aircraft": aircraft,
                }
            )
        )
    except Exception:
        pass

    try:
        while True:
            # Keep connection alive by awaiting client messages.
            # Clients may send pings or filter requests here in the future.
            data = await websocket.receive_text()
            logger.debug("Received from client %s: %s", websocket.client, data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        logger.warning("WebSocket error for %s: %s", websocket.client, exc)
        manager.disconnect(websocket)
