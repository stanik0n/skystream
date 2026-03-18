select
    origin_country,
    count(*)                                        as active_flight_count,
    count(*) filter (where on_ground = false)       as airborne_count,
    count(*) filter (where on_ground = true)        as on_ground_count,
    avg(baro_altitude)  filter (where on_ground = false) as avg_altitude_m,
    avg(velocity)       filter (where on_ground = false) as avg_velocity_ms,
    now()                                           as calculated_at
from {{ ref('fct_active_flights') }}
where origin_country is not null
group by origin_country
order by active_flight_count desc
