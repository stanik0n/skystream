with source as (
    select * from {{ source('skystream', 'flight_events') }}
)
select
    id,
    icao24,
    event_type,
    event_time,
    latitude,
    longitude
from source
where icao24 is not null
  and event_time is not null
