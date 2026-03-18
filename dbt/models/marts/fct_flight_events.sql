with events as (
    select * from {{ ref('stg_flight_events') }}
),
aircraft as (
    select * from {{ ref('dim_aircraft') }}
)
select
    e.id,
    e.icao24,
    e.event_type,
    e.event_time,
    e.latitude,
    e.longitude,
    a.registration,
    a.model,
    a.airline
from events e
left join aircraft a
    on e.icao24 = a.icao24
