-- Current flight phase breakdown with percentages.
-- Snapshot of aircraft seen in the last 5 minutes.

with current as (
    select flight_phase, count(*) as cnt
    from {{ ref('fct_active_flights') }}
    group by flight_phase
),
totals as (
    select sum(cnt) as total from current
)
select
    c.flight_phase,
    c.cnt                                                       as aircraft_count,
    round(c.cnt * 100.0 / t.total, 1)                          as pct_of_total,
    now()                                                       as calculated_at
from current c, totals t
order by c.cnt desc
