-- Observability: distinguish successful milestone rows from failed cron/handler attempts.

alter table public.simulation_calendar_events
  add column if not exists status text not null default 'success'
    constraint simulation_calendar_events_status_check
    check (status in ('success', 'error')),
  add column if not exists error_message text;

comment on column public.simulation_calendar_events.status is
  'success = milestone completed; error = handler threw or an explicit failure was recorded.';
comment on column public.simulation_calendar_events.error_message is
  'Human-readable failure text when status = error.';

create index if not exists simulation_calendar_events_success_key_idx
  on public.simulation_calendar_events (event_key)
  where status = 'success';

create index if not exists simulation_calendar_events_error_fired_idx
  on public.simulation_calendar_events (fired_at desc)
  where status = 'error';

notify pgrst, 'reload schema';
