-- Most frequently observed callsigns in the last 24 hours.
-- Observation count is a proxy for flight duration / coverage.

select
    callsign,
    count(*)                                            as observation_count,
    count(distinct icao24)                              as unique_aircraft,
    min(time)                                           as first_seen,
    max(time)                                           as last_seen,
    round(avg(baro_altitude) filter (where on_ground = false)::numeric, 0) as avg_altitude_m,
    round(avg(velocity)      filter (where on_ground = false)::numeric, 2) as avg_velocity_ms,
    bool_or(on_ground = false)                          as was_airborne
from {{ ref('stg_flight_states') }}
where time > now() - interval '24 hours'
  and callsign is not null
group by callsign
order by observation_count desc
limit 100
