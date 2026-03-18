"""
SkyStream Flight Data Producer
Polls the OpenSky Network REST API and publishes raw state vectors to Kafka.
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

# ── OAuth2 token cache ────────────────────────────────────────────────────────

_token: Optional[str] = None
_token_expires_at: float = 0.0


def _fetch_oauth2_token(session: requests.Session) -> Optional[str]:
    """Request a new OAuth2 access token using Client Credentials flow."""
    try:
        resp = session.post(
            config.OPENSKY_TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": config.OPENSKY_CLIENT_ID,
                "client_secret": config.OPENSKY_CLIENT_SECRET,
            },
            timeout=config.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        body = resp.json()
        return body["access_token"], int(body.get("expires_in", 300))
    except Exception as exc:
        logger.error("OAuth2 token request failed: %s", exc)
        return None, 0


def get_bearer_token(session: requests.Session) -> Optional[str]:
    """Return a valid Bearer token, refreshing if expired."""
    global _token, _token_expires_at
    # Refresh 30s before actual expiry
    if _token is None or time.monotonic() >= _token_expires_at - 30:
        token, expires_in = _fetch_oauth2_token(session)
        if token:
            _token = token
            _token_expires_at = time.monotonic() + expires_in
            logger.info("OAuth2 token acquired, expires in %ds.", expires_in)
        else:
            _token = None
    return _token

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("skystream.producer")


# ── Kafka helpers ─────────────────────────────────────────────────────────────

def delivery_report(err, msg) -> None:
    """Callback invoked by confluent-kafka after each message produce attempt."""
    if err is not None:
        logger.error("Delivery failed for record %s: %s", msg.key(), err)
    else:
        logger.debug(
            "Record delivered to %s [partition %d] @ offset %d",
            msg.topic(),
            msg.partition(),
            msg.offset(),
        )


def ensure_topic(bootstrap_servers: str, topic: str, num_partitions: int = 4) -> None:
    """Create the Kafka topic if it does not already exist."""
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
            "retention.ms": str(24 * 60 * 60 * 1000),  # 24 h
            "compression.type": "lz4",
        },
    )
    futures = admin.create_topics([new_topic])
    for t, future in futures.items():
        try:
            future.result()
            logger.info("Kafka topic '%s' created with %d partitions.", t, num_partitions)
        except Exception as exc:
            # Topic may already exist due to a race – that is fine.
            logger.warning("Could not create topic '%s': %s", t, exc)


# ── OpenSky API ───────────────────────────────────────────────────────────────

def fetch_flights(session: requests.Session) -> Optional[list]:
    """
    Fetch current state vectors from the OpenSky Network API.
    Applies a geographic bounding box and retries on transient errors.

    Uses OAuth2 Bearer token if client credentials are configured,
    falls back to basic auth, then anonymous.

    Returns the raw 'states' list or None on failure.
    """
    min_lat, max_lat, min_lon, max_lon = config.BOUNDING_BOX
    params = {
        "lamin": min_lat,
        "lamax": max_lat,
        "lomin": min_lon,
        "lomax": max_lon,
    }

    last_exc: Optional[Exception] = None
    for attempt in range(1, config.MAX_RETRIES + 1):
        # Build auth headers fresh each attempt (token may have been refreshed)
        headers: dict = {}
        auth: Optional[tuple] = None
        if config.OPENSKY_CLIENT_ID and config.OPENSKY_CLIENT_SECRET:
            token = get_bearer_token(session)
            if token:
                headers["Authorization"] = f"Bearer {token}"
        elif config.OPENSKY_USERNAME and config.OPENSKY_PASSWORD:
            auth = (config.OPENSKY_USERNAME, config.OPENSKY_PASSWORD)

        try:
            resp = session.get(
                config.OPENSKY_URL,
                params=params,
                headers=headers,
                auth=auth,
                timeout=config.REQUEST_TIMEOUT,
            )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 60))
                logger.warning("Rate-limited by OpenSky. Sleeping %ds.", retry_after)
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data.get("states") or []
        except requests.RequestException as exc:
            last_exc = exc
            backoff = 2 ** attempt
            logger.warning(
                "OpenSky request failed (attempt %d/%d): %s. Retrying in %ds.",
                attempt,
                config.MAX_RETRIES,
                exc,
                backoff,
            )
            time.sleep(backoff)

    logger.error("All %d fetch attempts failed. Last error: %s", config.MAX_RETRIES, last_exc)
    return None


# ── State vector parsing ──────────────────────────────────────────────────────

def parse_state_vector(state: list) -> Optional[FlightState]:
    """
    Map a raw OpenSky state vector (list) to a FlightState model.

    OpenSky indices:
      0  icao24
      1  callsign
      2  origin_country
      3  time_position
      4  last_contact
      5  longitude
      6  latitude
      7  baro_altitude
      8  on_ground
      9  velocity
      10 true_track
      11 vertical_rate
      12 sensors  (not used)
      13 geo_altitude
      14 squawk
      15 spi
      16 position_source
    """
    try:
        icao24: str = state[0]
        if not icao24:
            return None

        return FlightState(
            icao24=icao24,
            callsign=state[1],
            origin_country=state[2],
            time_position=state[3],
            last_contact=state[4],
            longitude=state[5],
            latitude=state[6],
            baro_altitude=state[7],
            on_ground=bool(state[8]),
            velocity=state[9],
            true_track=state[10],
            vertical_rate=state[11],
            sensors=None,  # omit sensor list to keep messages small
            geo_altitude=state[13],
            squawk=state[14],
            spi=state[15] if len(state) > 15 else None,
            position_source=state[16] if len(state) > 16 else None,
        )
    except (IndexError, TypeError, ValueError) as exc:
        logger.debug("Could not parse state vector %s: %s", state, exc)
        return None


def within_bbox(flight: FlightState) -> bool:
    """Return True when the flight has a valid position inside the configured bounding box."""
    if flight.latitude is None or flight.longitude is None:
        return False
    min_lat, max_lat, min_lon, max_lon = config.BOUNDING_BOX
    return (
        min_lat <= flight.latitude <= max_lat
        and min_lon <= flight.longitude <= max_lon
    )


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    logger.info("SkyStream producer starting up.")
    logger.info(
        "Bounding box: lat=[%.1f, %.1f] lon=[%.1f, %.1f]",
        *config.BOUNDING_BOX,
    )

    # Wait briefly for Kafka to be fully ready before admin calls.
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
    session.headers.update({"Accept": "application/json"})

    # Pre-fetch OAuth2 token on startup so the first poll isn't delayed.
    if config.OPENSKY_CLIENT_ID and config.OPENSKY_CLIENT_SECRET:
        logger.info("OAuth2 credentials configured (client_id=%s).", config.OPENSKY_CLIENT_ID)
        get_bearer_token(session)
    elif config.OPENSKY_USERNAME:
        logger.info("Using basic auth for OpenSky (username=%s).", config.OPENSKY_USERNAME)
    else:
        logger.warning("No OpenSky credentials set — using anonymous access (rate-limited).")

    poll_interval = config.POLL_INTERVAL_SECONDS
    logger.info("Polling OpenSky every %ds. Kafka topic: %s", poll_interval, config.KAFKA_TOPIC)

    while True:
        cycle_start = time.monotonic()

        states = fetch_flights(session)
        if states is None:
            logger.warning("Skipping cycle – fetch returned None.")
            time.sleep(poll_interval)
            continue

        published = 0
        skipped = 0

        for raw_state in states:
            flight = parse_state_vector(raw_state)
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

            # Periodically poll the delivery queue to avoid buffer overflow.
            if published % 100 == 0:
                producer.poll(0)

        producer.flush()

        elapsed = time.monotonic() - cycle_start
        logger.info(
            "Cycle complete: %d published, %d skipped, %.2fs elapsed.",
            published,
            skipped,
            elapsed,
        )

        sleep_for = max(0.0, poll_interval - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
