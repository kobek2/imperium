-- When false, cron and calendar ticks skip automatic election-phase advancement, leadership
-- session schedule advancement, presidential auto-close, inauguration / midterm / presidential
-- open and seating handlers, and deferred leadership closes. Budget-cycle calendar steps still run.
-- Page-load schedule RPCs are also skipped unless a server action passes force (see web).

alter table public.simulation_settings
  add column if not exists calendar_auto_congress_elections boolean not null default false;

comment on column public.simulation_settings.calendar_auto_congress_elections is
  'When true, calendar tick and passive reads may advance election phases and leadership sessions and run seating/inauguration automation.';
