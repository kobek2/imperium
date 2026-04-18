-- Simulation calendar (RP time vs real time) + dormant seat-election filing windows.
-- Seat elections may exist in DB before players see them: filing_window_started_at IS NULL
-- means "dormant" (hidden from public listings, no filing, skipped by phase scheduler).

-- ---------- Simulation settings (singleton id = 1) ----------
create table public.simulation_settings (
  id smallint primary key default 1 check (id = 1),
  -- Real-world instant when the RP calendar matched rp_anchor_date (use "Set real anchor to now" after changing only the RP date).
  real_anchor_at timestamptz not null default now(),
  -- Roleplay calendar date at real_anchor_at (typically start of a Congress cycle).
  rp_anchor_date date not null default date '2023-01-01',
  -- Fixed pace: RP months advanced per real Earth day (product default 3.5).
  rp_months_per_real_day numeric not null default 3.5
    check (rp_months_per_real_day > 0 and rp_months_per_real_day <= 366),
  -- Admin override added to the continuous RP-month counter (can be fractional).
  admin_rp_month_offset numeric not null default 0,
  -- When true, advance_election_phases caller may auto-open dormant occupied seat races in RP January.
  auto_open_filings_in_rp_january boolean not null default false,
  -- Dedupe key for January auto-open (YYYY-MM in RP calendar when last run).
  last_auto_open_rp_key text,
  updated_at timestamptz not null default now()
);

insert into public.simulation_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.simulation_settings enable row level security;

create policy "simulation_settings read authenticated"
  on public.simulation_settings for select
  to authenticated
  using (true);

create policy "simulation_settings update admin"
  on public.simulation_settings for update
  to authenticated
  using (public.is_staff_admin(auth.uid()))
  with check (public.is_staff_admin(auth.uid()));

-- ---------- Elections: filing window lifecycle ----------
alter table public.elections
  add column if not exists filing_window_started_at timestamptz;

comment on column public.elections.filing_window_started_at is
  'When non-null, this race participates in the public election UI and scheduled phase transitions. Null means dormant (seat template): admins must open filings first.';

-- Existing races behave as before: treat filing window as already started.
update public.elections e
set filing_window_started_at = coalesce(e.filing_window_started_at, e.filing_opens_at, e.created_at)
where e.filing_window_started_at is null;

-- ---------- Phase scheduler: ignore dormant races ----------
create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and filing_window_started_at is not null
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.filing_window_started_at is not null
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    perform public._close_primary_for_election(r.id);
  end loop;

  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
      and e.office <> 'president'
  loop
    perform public._close_general_for_election(r.id);
  end loop;
end;
$$;

revoke all on function public.advance_election_phases_by_schedule() FROM PUBLIC;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated;

comment on function public.advance_election_phases_by_schedule() is
  'Scheduled phase transitions; skips elections with filing_window_started_at IS NULL (dormant templates).';
