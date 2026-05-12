-- While calendar seat races (midterm / presidential) are in progress, RP display and calendar
-- milestones use a frozen month (November of the election year) until seating clears it.

alter table public.simulation_settings
  add column if not exists calendar_seat_cycle_freeze_rp_year smallint,
  add column if not exists calendar_seat_cycle_freeze_rp_month smallint;

comment on column public.simulation_settings.calendar_seat_cycle_freeze_rp_year is
  'When set with calendar_seat_cycle_freeze_rp_month, calendar tick and RP UI use this RP year instead of computeRpDate until seating clears.';
comment on column public.simulation_settings.calendar_seat_cycle_freeze_rp_month is
  '1–12; paired with calendar_seat_cycle_freeze_rp_year during an open calendar seat cycle.';

notify pgrst, 'reload schema';
