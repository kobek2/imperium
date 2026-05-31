-- Baseline calendar: disable automation and pin RP month until admins advance manually.

with cur as (
  select
    id,
    simulation_start_at,
    calendar_is_active,
    calendar_seat_cycle_freeze_rp_year,
    calendar_seat_cycle_freeze_rp_month,
    floor(
      ((2032 - 1) * 12)
      + (((extract(epoch from (now() - simulation_start_at)) / 86400.0) * (48.0 / 10.5)))
    )::int as total_months
  from public.simulation_settings
  where id = 1
)
update public.simulation_settings s
set
  calendar_auto_congress_elections = false,
  auto_open_filings_in_rp_january = false,
  last_auto_open_rp_key = null,
  calendar_seat_cycle_freeze_rp_year = case
    when cur.calendar_is_active
      and cur.simulation_start_at is not null
      and cur.calendar_seat_cycle_freeze_rp_year is null
      and cur.calendar_seat_cycle_freeze_rp_month is null
    then (cur.total_months / 12) + 1
    else s.calendar_seat_cycle_freeze_rp_year
  end,
  calendar_seat_cycle_freeze_rp_month = case
    when cur.calendar_is_active
      and cur.simulation_start_at is not null
      and cur.calendar_seat_cycle_freeze_rp_year is null
      and cur.calendar_seat_cycle_freeze_rp_month is null
    then (mod(cur.total_months, 12) + 1)
    else s.calendar_seat_cycle_freeze_rp_month
  end,
  updated_at = now()
from cur
where s.id = cur.id;
