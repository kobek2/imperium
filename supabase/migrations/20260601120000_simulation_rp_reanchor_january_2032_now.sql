-- Re-anchor RP v2 so the calendar reads **January 2032** at migration apply time (matches
-- `RP_START_YEAR` / `RP_START_MONTH` in `web/src/lib/simulation-calendar-constants.ts`).
--
-- Wall clock keeps advancing RP from that instant (~48/10.5 RP months per real day). If the date
-- drifts again, re-run this pattern (or use the admin “hard reset calendar” which also sets
-- `simulation_start_at` to now).

update public.simulation_settings
set
  simulation_start_at = now(),
  calendar_seat_cycle_freeze_rp_year = null,
  calendar_seat_cycle_freeze_rp_month = null,
  updated_at = now()
where id = 1;
