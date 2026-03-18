CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE flight_states (
    time            TIMESTAMPTZ NOT NULL,
    icao24          TEXT NOT NULL,
    callsign        TEXT,
    origin_country  TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    baro_altitude   DOUBLE PRECISION,
    geo_altitude    DOUBLE PRECISION,
    velocity        DOUBLE PRECISION,
    true_track      DOUBLE PRECISION,
    vertical_rate   DOUBLE PRECISION,
    on_ground       BOOLEAN,
    flight_phase    TEXT,
    squawk          TEXT,
    ingested_at     TIMESTAMPTZ
);

SELECT create_hypertable('flight_states', 'time');
CREATE INDEX ON flight_states (icao24, time DESC);

CREATE TABLE flight_events (
    id          BIGSERIAL PRIMARY KEY,
    icao24      TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    event_time  TIMESTAMPTZ NOT NULL,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION
);
CREATE INDEX ON flight_events (icao24, event_time DESC);

CREATE TABLE aircraft_dim (
    icao24       TEXT PRIMARY KEY,
    registration TEXT,
    model        TEXT,
    airline      TEXT,
    updated_at   TIMESTAMPTZ DEFAULT now()
);
