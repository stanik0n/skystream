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
from pydantic import BaseModel

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
RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
ALERT_FROM_EMAIL: str = os.getenv("ALERT_FROM_EMAIL", "SkyStream <alerts@skystream.rajeshchowdary.com>")
ALERT_WINDOW_MINUTES: int = 65  # notify when ETA is within this many minutes

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

    # Start background tasks.
    asyncio.create_task(broadcast_loop())
    asyncio.create_task(notification_loop())


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
                        "category": rec.get("category"),
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


# ── Email alert subscriptions ─────────────────────────────────────────────────

class SubscribeRequest(BaseModel):
    email: str
    icao24: str
    callsign: str


def _sub_key(icao24: str, email: str) -> str:
    return f"sub:{icao24.lower()}:{email.lower()}"


@app.post("/subscribe")
async def subscribe(body: SubscribeRequest) -> JSONResponse:
    """Subscribe an email to a 1-hour-out landing alert for a flight."""
    if "@" not in body.email:
        return JSONResponse({"ok": False, "error": "Invalid email"}, status_code=400)
    if not state.redis_client:
        return JSONResponse({"ok": False, "error": "Service unavailable"}, status_code=503)
    key = _sub_key(body.icao24, body.email)
    data = {
        "email": body.email,
        "icao24": body.icao24.lower(),
        "callsign": body.callsign,
        "notified": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await state.redis_client.set(key, json.dumps(data), ex=86400)
    logger.info("Alert subscription created: %s → %s", body.email, body.icao24)
    return JSONResponse({"ok": True})


@app.delete("/subscribe/{icao24}")
async def unsubscribe(icao24: str, email: str) -> JSONResponse:
    """Cancel a landing alert subscription."""
    if not state.redis_client:
        return JSONResponse({"ok": False})
    key = _sub_key(icao24, email)
    await state.redis_client.delete(key)
    logger.info("Alert subscription removed: %s → %s", email, icao24)
    return JSONResponse({"ok": True})


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


# ── Alert email ───────────────────────────────────────────────────────────────

def _build_alert_html(
    callsign: str,
    flight_number: str,
    orig_iata: str,
    orig_city: str,
    dest_iata: str,
    dest_city: str,
    minutes_remaining: int,
    eta_formatted: str,
) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:500px;margin:32px auto;padding:0 16px;">
    <div style="background:#161b22;border:1px solid #30363d;border-radius:14px;overflow:hidden;">
      <div style="background:#0d2137;padding:22px 28px;border-bottom:1px solid #30363d;">
        <span style="font-size:22px;">&#9992;</span>
        <span style="color:#58a6ff;font-size:19px;font-weight:700;margin-left:10px;letter-spacing:0.5px;">SkyStream Alert</span>
      </div>
      <div style="padding:26px 28px;">
        <p style="color:#8b949e;font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">Flight</p>
        <h1 style="color:#f0f6fc;font-size:30px;font-weight:700;margin:0 0 24px;letter-spacing:2px;font-family:monospace;">{flight_number}</h1>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;border:1px solid #30363d;border-radius:10px;margin-bottom:20px;">
          <tr>
            <td style="padding:18px 20px;width:40%">
              <div style="font-size:26px;font-weight:700;color:#f0f6fc;font-family:monospace;letter-spacing:2px;">{orig_iata}</div>
              <div style="font-size:11px;color:#8b949e;margin-top:4px;">{orig_city}</div>
            </td>
            <td style="text-align:center;color:#6e7681;font-size:20px;padding:18px 8px;">&#x2192;</td>
            <td style="padding:18px 20px;width:40%;text-align:right;">
              <div style="font-size:26px;font-weight:700;color:#f0f6fc;font-family:monospace;letter-spacing:2px;">{dest_iata}</div>
              <div style="font-size:11px;color:#8b949e;margin-top:4px;">{dest_city}</div>
            </td>
          </tr>
        </table>

        <div style="background:rgba(0,220,120,0.07);border:1px solid rgba(0,220,120,0.3);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <div style="color:#8b949e;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Estimated Arrival</div>
          <div style="color:#00dc78;font-size:26px;font-weight:700;letter-spacing:0.5px;">~{minutes_remaining} minutes</div>
          <div style="color:#8b949e;font-size:12px;margin-top:4px;">{eta_formatted}</div>
        </div>

        <p style="color:#6e7681;font-size:11px;margin:0;line-height:1.5;">
          You asked SkyStream to notify you when this flight was 1&nbsp;hour from landing.
          This is an automated alert &mdash; no action needed.
        </p>
      </div>
    </div>
    <p style="color:#484f58;font-size:11px;text-align:center;margin-top:14px;">SkyStream &mdash; Real-Time Flight Tracker</p>
  </div>
</body>
</html>"""


async def send_alert_email(
    email: str,
    callsign: str,
    route: dict,
    minutes_remaining: int,
) -> None:
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping alert email for %s.", callsign)
        return

    origin = route.get("origin") or {}
    dest = route.get("destination") or {}
    flight_number = route.get("flight_number") or callsign
    orig_iata = origin.get("iata_code", "???")
    orig_city = origin.get("municipality", "")
    dest_iata = dest.get("iata_code", "???")
    dest_city = dest.get("municipality", "")

    eta_str = route.get("estimated_on") or route.get("scheduled_on") or ""
    try:
        eta_dt = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
        eta_formatted = eta_dt.strftime("%H:%M %Z")
    except (ValueError, AttributeError):
        eta_formatted = "—"

    html = _build_alert_html(
        callsign, flight_number,
        orig_iata, orig_city,
        dest_iata, dest_city,
        minutes_remaining, eta_formatted,
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": ALERT_FROM_EMAIL,
                    "to": [email],
                    "subject": f"✈ {flight_number} landing in ~{minutes_remaining} min — {dest_iata}",
                    "html": html,
                },
            )
        if resp.is_success:
            logger.info("Alert sent to %s for %s (%d min out).", email, callsign, minutes_remaining)
        else:
            logger.error("Resend API error %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.error("Failed to send alert email to %s: %s", email, exc)


# ── Notification background loop ──────────────────────────────────────────────

async def notification_loop() -> None:
    """Every 60 s, check all active subscriptions and fire emails when ETA ≤ ALERT_WINDOW_MINUTES."""
    logger.info("Notification loop started (window: %d min).", ALERT_WINDOW_MINUTES)
    while True:
        await asyncio.sleep(60)
        if not state.redis_client:
            continue
        try:
            keys: list[str] = await state.redis_client.keys("sub:*")
            if not keys:
                continue
            now = datetime.now(timezone.utc)
            for key in keys:
                raw = await state.redis_client.get(key)
                if not raw:
                    continue
                data: dict = json.loads(raw)
                if data.get("notified"):
                    continue

                icao24: str = data["icao24"]
                callsign: str = data.get("callsign", "").strip()

                # Fall back to live Redis flight data to get callsign
                if not callsign:
                    flight_raw = await state.redis_client.hget("flights", icao24)
                    if flight_raw:
                        callsign = json.loads(flight_raw).get("callsign", "").strip()
                if not callsign:
                    continue

                # Look up cached route (populated when any client views this flight)
                route_raw = await state.redis_client.get(f"route:{callsign}")
                if not route_raw:
                    continue
                route: dict = json.loads(route_raw)

                # Skip already-landed flights
                if route.get("actual_on"):
                    continue

                eta_str: str = route.get("estimated_on") or route.get("scheduled_on") or ""
                if not eta_str:
                    continue
                try:
                    eta_dt = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
                    if eta_dt.tzinfo is None:
                        eta_dt = eta_dt.replace(tzinfo=timezone.utc)
                except (ValueError, TypeError):
                    continue

                minutes_remaining = (eta_dt - now).total_seconds() / 60
                if 0 < minutes_remaining <= ALERT_WINDOW_MINUTES:
                    await send_alert_email(data["email"], callsign, route, int(minutes_remaining))
                    data["notified"] = True
                    ttl = await state.redis_client.ttl(key)
                    await state.redis_client.set(key, json.dumps(data), ex=max(ttl, 3600))

        except Exception as exc:
            logger.error("Notification loop error: %s", exc)


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
