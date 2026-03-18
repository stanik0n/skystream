select
    icao24,
    registration,
    model,
    airline,
    updated_at
from {{ source('skystream', 'aircraft_dim') }}
where icao24 is not null
