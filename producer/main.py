"""
SkyStream Flight Data Producer
Polls the airplanes.live API and publishes raw state vectors to Kafka.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

import requests
from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, NewTopic

import config
from schemas import FlightState

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("skystream.producer")


# ── Kafka helpers ─────────────────────────────────────────────────────────────

def delivery_report(err, msg) -> None:
    if err is not None:
        logger.error("Delivery failed for record %s: %s", msg.key(), err)
    else:
        logger.debug(
            "Record delivered to %s [partition %d] @ offset %d",
            msg.topic(), msg.partition(), msg.offset(),
        )


def ensure_topic(bootstrap_servers: str, topic: str, num_partitions: int = 4) -> None:
    admin = AdminClient({"bootstrap.servers": bootstrap_servers})
    existing = admin.list_topics(timeout=10).topics

    if topic in existing:
        logger.info("Kafka topic '%s' already exists.", topic)
        return

    new_topic = NewTopic(
        topic,
        num_partitions=num_partitions,
        replication_factor=1,
        config={
            "retention.ms": str(24 * 60 * 60 * 1000),
            "compression.type": "lz4",
        },
    )
    futures = admin.create_topics([new_topic])
    for t, future in futures.items():
        try:
            future.result()
            logger.info("Kafka topic '%s' created with %d partitions.", t, num_partitions)
        except Exception as exc:
            logger.warning("Could not create topic '%s': %s", t, exc)


# ── airplanes.live API ────────────────────────────────────────────────────────

def fetch_flights(session: requests.Session) -> Optional[list]:
    """
    Fetch current aircraft positions from the airplanes.live API.
    Uses a large 10000nm radius from (0,0) for global coverage so that
    client-side bounding box filtering handles the final crop.
    Returns the raw aircraft list or None on failure.
    """
    min_lat, max_lat, min_lon, max_lon = config.BOUNDING_BOX
    is_global = (min_lat <= -89 and max_lat >= 89 and min_lon <= -179 and max_lon >= 179)

    if is_global:
        # Single global call — 10000nm from the equator covers the whole earth
        url = f"{config.AIRPLANES_LIVE_BASE_URL}/0/0/10000"
    else:
        # Derive a center point and radius that encloses the bounding box
        center_lat = (min_lat + max_lat) / 2
        center_lon = (min_lon + max_lon) / 2
        # Rough radius: half the diagonal in nautical miles (1° ≈ 60nm)
        import math
        dlat = (max_lat - min_lat) / 2 * 60
        dlon = (max_lon - min_lon) / 2 * 60 * math.cos(math.radians(center_lat))
        radius_nm = min(int(math.hypot(dlat, dlon)) + 100, 3000)
        url = f"{config.AIRPLANES_LIVE_BASE_URL}/{center_lat:.2f}/{center_lon:.2f}/{radius_nm}"

    last_exc: Optional[Exception] = None
    for attempt in range(1, config.MAX_RETRIES + 1):
        try:
            resp = session.get(
                url,
                timeout=config.REQUEST_TIMEOUT,
            )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 60))
                logger.warning("Rate-limited by airplanes.live. Sleeping %ds.", retry_after)
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data.get("ac") or []
        except requests.RequestException as exc:
            last_exc = exc
            backoff = 2 ** attempt
            logger.warning(
                "airplanes.live request failed (attempt %d/%d): %s. Retrying in %ds.",
                attempt, config.MAX_RETRIES, exc, backoff,
            )
            time.sleep(backoff)

    logger.error("All %d fetch attempts failed. Last error: %s", config.MAX_RETRIES, last_exc)
    return None


# ── airplanes.live response parsing ──────────────────────────────────────────

_FT_TO_M = 0.3048
_KT_TO_MS = 0.514444
_FTMIN_TO_MS = 0.00508


def _safe_float(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def parse_aircraft(ac: dict) -> Optional[FlightState]:
    """Map an airplanes.live aircraft object to a FlightState."""
    try:
        icao24: str = ac.get("hex", "").strip().lower()
        if not icao24:
            return None

        lat = _safe_float(ac.get("lat"))
        lon = _safe_float(ac.get("lon"))
        if lat is None or lon is None:
            return None

        # alt_baro is the string "ground" when the aircraft is on the ground
        alt_baro_raw = ac.get("alt_baro")
        on_ground = alt_baro_raw == "ground"
        baro_altitude = None if on_ground else (
            _safe_float(alt_baro_raw) * _FT_TO_M if alt_baro_raw is not None else None
        )

        geo_alt_raw = _safe_float(ac.get("alt_geom"))
        geo_altitude = geo_alt_raw * _FT_TO_M if geo_alt_raw is not None else None

        gs_raw = _safe_float(ac.get("gs"))
        velocity = gs_raw * _KT_TO_MS if gs_raw is not None else None

        baro_rate_raw = _safe_float(ac.get("baro_rate"))
        vertical_rate = baro_rate_raw * _FTMIN_TO_MS if baro_rate_raw is not None else None

        callsign = ac.get("flight", "")
        if callsign:
            callsign = callsign.strip() or None

        return FlightState(
            icao24=icao24,
            callsign=callsign,
            latitude=lat,
            longitude=lon,
            baro_altitude=baro_altitude,
            geo_altitude=geo_altitude,
            on_ground=on_ground,
            velocity=velocity,
            true_track=_safe_float(ac.get("track")),
            vertical_rate=vertical_rate,
            squawk=ac.get("squawk"),
            category=ac.get("category"),
        )
    except Exception as exc:
        logger.debug("Could not parse aircraft %s: %s", ac.get("hex"), exc)
        return None


def within_bbox(flight: FlightState) -> bool:
    if flight.latitude is None or flight.longitude is None:
        return False
    min_lat, max_lat, min_lon, max_lon = config.BOUNDING_BOX
    return (
        min_lat <= flight.latitude <= max_lat
        and min_lon <= flight.longitude <= max_lon
    )


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    logger.info("SkyStream producer starting up (source: airplanes.live).")
    logger.info(
        "Bounding box: lat=[%.1f, %.1f] lon=[%.1f, %.1f]",
        *config.BOUNDING_BOX,
    )

    time.sleep(5)
    ensure_topic(config.KAFKA_BOOTSTRAP_SERVERS, config.KAFKA_TOPIC)

    producer = Producer(
        {
            "bootstrap.servers": config.KAFKA_BOOTSTRAP_SERVERS,
            "linger.ms": 50,
            "batch.num.messages": 500,
            "compression.type": "lz4",
            "acks": "1",
            "retries": 5,
            "retry.backoff.ms": 500,
        }
    )

    session = requests.Session()
    session.headers.update({"Accept": "application/json", "User-Agent": "SkyStream/1.0"})

    poll_interval = config.POLL_INTERVAL_SECONDS
    logger.info("Polling airplanes.live every %ds. Kafka topic: %s", poll_interval, config.KAFKA_TOPIC)

    while True:
        cycle_start = time.monotonic()

        aircraft_list = fetch_flights(session)
        if aircraft_list is None:
            logger.warning("Skipping cycle – fetch returned None.")
            time.sleep(poll_interval)
            continue

        published = 0
        skipped = 0

        for ac in aircraft_list:
            flight = parse_aircraft(ac)
            if flight is None:
                skipped += 1
                continue
            if not within_bbox(flight):
                skipped += 1
                continue

            payload = flight.model_dump_json().encode("utf-8")
            producer.produce(
                topic=config.KAFKA_TOPIC,
                key=flight.icao24.encode("utf-8"),
                value=payload,
                callback=delivery_report,
            )
            published += 1

            if published % 100 == 0:
                producer.poll(0)

        producer.flush()

        elapsed = time.monotonic() - cycle_start
        logger.info(
            "Cycle complete: %d published, %d skipped, %.2fs elapsed.",
            published, skipped, elapsed,
        )

        sleep_for = max(0.0, poll_interval - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
