-- Revert mistaken `midterms_open_2030` calendar fire: remove log + spawned midterm seat cycle,
-- clear RP freeze, set simulation clock so RP reads **April 2031** at UTC `now()` (v2 formula:
-- delta months Jan 2029 → Apr 2031 = 27; pace = 48/10.5 RP-months per real day).
-- Turns **off** the automated calendar so milestones do not re-fire until staff re-enable.
--
-- If the app only showed **Nov 2030** and midterm races are still open, `calendar_seat_cycle_freeze_*`
-- was pinning RP — this script clears it. You can also use Admin → Elections → **Clear RP seat-cycle freeze**.
--
-- Run in Supabase SQL editor or `psql` against your project DB. Review in a transaction first if unsure.

begin;

delete from public.simulation_calendar_events
where event_key = 'midterms_open_2030'
   or (metadata is not null and metadata->>'target_event' = 'midterms_open_2030');

delete from public.elections
where calendar_cycle_key = 'midterms_2030';

update public.simulation_settings
set
  calendar_seat_cycle_freeze_rp_year = null,
  calendar_seat_cycle_freeze_rp_month = null,
  calendar_is_active = false,
  simulation_start_at = (timezone('utc', now()) - ((27.0 * 10.5) / 48.0) * interval '1 day'),
  updated_at = timezone('utc', now())
where id = 1;

commit;
