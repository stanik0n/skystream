with source as (
    select * from {{ source('skystream', 'flight_states') }}
),
cleaned as (
    select
        time,
        icao24,
        nullif(trim(callsign), '') as callsign,
        origin_country,
        latitude,
        longitude,
        baro_altitude,
        geo_altitude,
        velocity,
        true_track,
        vertical_rate,
        on_ground,
        flight_phase,
        squawk,
        ingested_at
    from source
    where icao24 is not null
      and time is not null
)
select * from cleaned
