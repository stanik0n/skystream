-- Hourly aircraft counts broken down by flight phase.
-- Shows traffic trends over the last 24 hours.
-- Materialized as a table and refreshed on each dbt run.

select
    date_trunc('hour', time)                                        as hour,
    count(distinct icao24)                                          as unique_aircraft,
    count(*) filter (where flight_phase = 'GROUND')                 as ground_count,
    count(*) filter (where flight_phase = 'CLIMBING')               as climbing_count,
    count(*) filter (where flight_phase = 'CRUISE')                 as cruise_count,
    count(*) filter (where flight_phase = 'DESCENDING')             as descending_count,
    round(avg(baro_altitude) filter (where on_ground = false)::numeric, 0) as avg_altitude_m,
    round(avg(velocity)      filter (where on_ground = false)::numeric, 2) as avg_velocity_ms
from {{ ref('stg_flight_states') }}
where time > now() - interval '24 hours'
group by 1
order by 1 desc
