with latest as (
    select *,
        row_number() over (partition by icao24 order by time desc) as rn
    from {{ ref('stg_flight_states') }}
    where time > now() - interval '5 minutes'
)
select
    icao24,
    callsign,
    origin_country,
    latitude,
    longitude,
    baro_altitude,
    velocity,
    true_track,
    vertical_rate,
    on_ground,
    flight_phase,
    time as last_seen
from latest
where rn = 1
