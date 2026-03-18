-- Bucket active airborne aircraft into altitude bands.
-- Band boundaries in metres:
--   Surface / Low:    0     –  1 524 m  (0     – 5 000 ft)
--   Medium:       1 524     –  4 572 m  (5 000 – 15 000 ft)
--   High:         4 572 m+             (15 000 ft+)

with banded as (
    select
        icao24,
        baro_altitude,
        case
            when baro_altitude is null          then 'Unknown'
            when baro_altitude < 1524           then 'Low (0-5k ft)'
            when baro_altitude between 1524 and 4572 then 'Medium (5k-15k ft)'
            else                                     'High (15k+ ft)'
        end as altitude_band
    from {{ ref('fct_active_flights') }}
    where on_ground = false
      or baro_altitude is not null
)
select
    altitude_band,
    count(*)                    as aircraft_count,
    avg(baro_altitude)          as avg_altitude_m,
    min(baro_altitude)          as min_altitude_m,
    max(baro_altitude)          as max_altitude_m,
    now()                       as calculated_at
from banded
group by altitude_band
order by min_altitude_m nulls last
