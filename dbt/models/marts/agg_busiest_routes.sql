-- Busiest origin countries by active airborne flights.
-- True origin→destination route data is not available from ADS-B without
-- correlating with schedule databases, so we use origin_country as a proxy
-- for traffic volume ranking.

with active as (
    select
        origin_country,
        callsign,
        flight_phase,
        velocity,
        baro_altitude
    from {{ ref('fct_active_flights') }}
    where on_ground = false
      and origin_country is not null
),
ranked as (
    select
        origin_country,
        count(*)                        as flight_count,
        count(distinct callsign)        as unique_callsigns,
        avg(velocity)                   as avg_velocity_ms,
        avg(baro_altitude)              as avg_altitude_m,
        rank() over (order by count(*) desc) as traffic_rank
    from active
    group by origin_country
)
select
    traffic_rank,
    origin_country,
    flight_count,
    unique_callsigns,
    round(avg_velocity_ms::numeric, 2)  as avg_velocity_ms,
    round(avg_altitude_m::numeric, 2)   as avg_altitude_m,
    now()                               as calculated_at
from ranked
order by traffic_rank
limit 50
