-- Busiest airlines by active airborne flights, derived from callsign prefix.
-- The first 3 characters of a callsign are the ICAO airline code (e.g. UAL, DAL, AAL).

with active as (
    select
        upper(left(callsign, 3))    as airline_code,
        callsign,
        flight_phase,
        velocity,
        baro_altitude
    from {{ ref('fct_active_flights') }}
    where on_ground = false
      and callsign is not null
      and length(callsign) >= 3
),
ranked as (
    select
        airline_code,
        count(*)                        as flight_count,
        count(distinct callsign)        as unique_callsigns,
        round(avg(velocity)::numeric, 2)       as avg_velocity_ms,
        round(avg(baro_altitude)::numeric, 0)  as avg_altitude_m,
        rank() over (order by count(*) desc)   as traffic_rank
    from active
    group by airline_code
)
select
    traffic_rank,
    airline_code,
    flight_count,
    unique_callsigns,
    avg_velocity_ms,
    avg_altitude_m,
    now()           as calculated_at
from ranked
order by traffic_rank
limit 50
