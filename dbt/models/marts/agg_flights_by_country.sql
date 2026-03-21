-- Daily traffic summary: unique aircraft, observations, avg altitude and speed.
-- Useful for tracking data volume and overall pipeline health over time.

select
    date_trunc('day', time)                                         as day,
    count(distinct icao24)                                          as unique_aircraft,
    count(distinct callsign)                                        as unique_callsigns,
    count(*)                                                        as total_observations,
    round(avg(baro_altitude) filter (where on_ground = false)::numeric, 0) as avg_altitude_m,
    round(avg(velocity)      filter (where on_ground = false)::numeric, 2) as avg_velocity_ms,
    count(*) filter (where on_ground = false)                       as airborne_observations,
    count(*) filter (where on_ground = true)                        as ground_observations
from {{ ref('stg_flight_states') }}
where time > now() - interval '7 days'
group by 1
order by 1 desc
