-- Calendar system overhaul (v2): fixed RP pace when active, event log, economy freeze flag,
-- bill leadership_review / rejected / expired, simulation_rp_calendar_date branch.

-- ---------- simulation_calendar_events ----------
create table if not exists public.simulation_calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  fired_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists simulation_calendar_events_key_idx
  on public.simulation_calendar_events (event_key);

create index if not exists simulation_calendar_events_fired_idx
  on public.simulation_calendar_events (fired_at desc);

comment on table public.simulation_calendar_events is
  'Log of simulation calendar events (deterministic keys deduped in application layer).';

alter table public.simulation_calendar_events enable row level security;

drop policy if exists "simulation_calendar_events read authenticated" on public.simulation_calendar_events;
create policy "simulation_calendar_events read authenticated"
  on public.simulation_calendar_events for select
  to authenticated
  using (true);

-- ---------- simulation_settings: v2 activation ----------
alter table public.simulation_settings
  add column if not exists simulation_start_at timestamptz,
  add column if not exists calendar_is_active boolean not null default false,
  add column if not exists simulation_start_unlocked boolean not null default false;

comment on column public.simulation_settings.simulation_start_at is
  'Real-world instant when the v2 calendar engine starts; RP month/year is January 2029 at this moment.';
comment on column public.simulation_settings.calendar_is_active is
  'When true, tickCalendarEvents runs; false keeps legacy RP display and disables v2 ticks.';
comment on column public.simulation_settings.simulation_start_unlocked is
  'Super-admin: allow editing simulation_start_at after first lock.';

alter table public.simulation_settings drop column if exists september_budget_speed_active;
alter table public.simulation_settings drop column if exists september_budget_speed_previous;
alter table public.simulation_settings drop column if exists september_budget_speed_started_at;
alter table public.simulation_settings drop column if exists september_budget_speed_expires_at;
alter table public.simulation_settings drop column if exists september_budget_window_key;

alter table public.simulation_settings drop column if exists admin_rp_month_offset;

-- ---------- rp_fiscal_years: explicit economy freeze (shutdown) ----------
alter table public.rp_fiscal_years
  add column if not exists economy_activity_frozen boolean not null default false;

comment on column public.rp_fiscal_years.economy_activity_frozen is
  'When true, wallet mutations are blocked (government shutdown / calendar budget miss).';

-- ---------- bill_status: leadership_review, rejected, expired ----------
alter type public.bill_status add value if not exists 'leadership_review';
alter type public.bill_status add value if not exists 'rejected';
alter type public.bill_status add value if not exists 'expired';

alter table public.bills
  add column if not exists leadership_review_opened_at timestamptz,
  add column if not exists leadership_primary_deadline timestamptz,
  add column if not exists leadership_deputy_deadline timestamptz,
  add column if not exists bill_closure_reason text;

comment on column public.bills.bill_closure_reason is
  'e.g. new_congress when mass-expired by calendar inauguration / midterm seating.';

-- ---------- Fixed pace (matches web/src/lib/simulation-calendar-constants.ts) ----------
create or replace function public._rp_months_per_real_day_fixed()
returns numeric
language sql
immutable
as $$
  select (48::numeric / 10.5);
$$;

-- ---------- simulation_rp_calendar_date ----------
create or replace function public.simulation_rp_calendar_date()
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cfg record;
  anchor_ts timestamptz;
  elapsed_days numeric;
  pace numeric;
  float_months numeric;
  whole int;
  frac numeric;
  after_whole timestamptz;
  at_ts timestamptz;
  v_start timestamptz;
  v_rp_months numeric;
  v_total numeric;
  v_year int;
  v_month int;
begin
  select
    calendar_is_active,
    simulation_start_at,
    rp_anchor_date,
    real_anchor_at,
    rp_months_per_real_day
  into cfg
  from public.simulation_settings
  where id = 1;

  if not found then
    return (timezone('UTC', now()))::date;
  end if;

  if coalesce(cfg.calendar_is_active, false) and cfg.simulation_start_at is not null then
    v_start := cfg.simulation_start_at;
    v_rp_months := public._rp_months_per_real_day_fixed();
    elapsed_days := extract(epoch from (now() - v_start)) / 86400.0;
    float_months := elapsed_days * v_rp_months;
    v_total := (2029 - 1) * 12 + (1 - 1) + float_months;
    v_year := floor(v_total / 12)::int + 1;
    v_month := (floor(v_total)::int % 12) + 1;
    return make_date(v_year, greatest(1, least(12, v_month)), 1);
  end if;

  anchor_ts := make_timestamptz(
    extract(year from cfg.rp_anchor_date)::int,
    extract(month from cfg.rp_anchor_date)::int,
    extract(day from cfg.rp_anchor_date)::int,
    12,
    0,
    0,
    'UTC'
  );

  elapsed_days := extract(epoch from (now() - cfg.real_anchor_at)) / 86400.0;
  pace := coalesce(cfg.rp_months_per_real_day, 3.5);
  float_months := elapsed_days * pace;
  whole := floor(float_months)::int;
  frac := float_months - whole;

  after_whole := anchor_ts + make_interval(months => whole);
  at_ts := after_whole + (frac * 30.436875) * interval '1 day';

  return (timezone('UTC', at_ts))::date;
end;
$$;

grant execute on function public.simulation_rp_calendar_date() to authenticated;

-- ---------- Economy gate ----------
create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active' and coalesce(y.economy_activity_frozen, false)
  ) then
    raise exception
      'ECONOMY_FROZEN: Government shutdown in effect. No economic activity permitted.';
  end if;

  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active'
      and y.appropriation_deadline_at is not null
      and y.appropriations_act_bill_id is null
      and now() > y.appropriation_deadline_at
  ) then
    raise exception
      'Federal government shutdown: the annual appropriations act was not enrolled before the statutory deadline. Economy payouts and purchases are suspended until Congress enrolls appropriations.';
  end if;

  if not exists (
    select 1
    from public.rp_fiscal_years y
    join public.federal_budgets b on b.fiscal_year_id = y.id
    where y.status = 'active' and b.status = 'submitted'
  ) then
    raise exception 'Economy is frozen until the President submits a federal budget for the active fiscal year.';
  end if;
end;
$$;

-- ---------- Appropriations signed: clear economy freeze ----------
create or replace function public.fiscal_on_appropriations_enrolled(p_bill_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b record;
  y record;
begin
  if p_bill_id is null then
    raise exception 'Bill id required.';
  end if;

  select * into b from public.bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found.';
  end if;
  if b.status is distinct from 'law' then
    raise exception 'Bill is not enrolled as law.';
  end if;
  if not coalesce(b.is_federal_appropriations, false) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if b.linked_fiscal_year_id is null then
    raise exception 'Appropriations bill is not linked to a fiscal year.';
  end if;

  select * into y from public.rp_fiscal_years where id = b.linked_fiscal_year_id for update;
  if not found then
    raise exception 'Fiscal year not found.';
  end if;

  if y.appropriations_act_bill_id is not null and y.appropriations_act_bill_id is distinct from p_bill_id then
    raise exception 'This fiscal year already has an enrolled appropriations act.';
  end if;

  update public.rp_fiscal_years
  set
    appropriations_act_bill_id = p_bill_id,
    economy_activity_frozen = false
  where id = y.id;

  update public.federal_budgets
  set
    status = 'submitted',
    submitted_at = coalesce(submitted_at, now()),
    updated_at = now()
  where fiscal_year_id = y.id;

  return jsonb_build_object('ok', true, 'fiscal_year_id', y.id, 'bill_id', p_bill_id);
end;
$$;

-- ---------- September auto-pace sync removed (columns dropped) ----------
create or replace function public.fiscal_sync_budget_cycle_with_simulation()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s record;
begin
  select calendar_is_active into s from public.simulation_settings where id = 1;
  if found and coalesce(s.calendar_is_active, false) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'calendar_v2_active');
  end if;

  return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'September_pace_override_removed');
end;
$$;

-- ---------- Leadership hopper deadlines ----------
create or replace function public.legislation_apply_leadership_deadlines()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bills b
  set
    status = 'debate',
    debate_started_at = now(),
    leadership_deadline_at = now() + interval '24 hours',
    chamber_vote_deadline_at = null,
    vp_tie_break_pending = false
  where b.status = 'leadership_review'
    and b.leadership_deputy_deadline is not null
    and b.leadership_deputy_deadline < now();

  update public.bills b
  set
    status = 'debate',
    debate_started_at = now(),
    leadership_deadline_at = now() + interval '24 hours',
    chamber_vote_deadline_at = null,
    vp_tie_break_pending = false
  where b.status = 'submitted'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now();

  update public.bills b
  set
    status = 'other_chamber_debate',
    debate_started_at = now(),
    leadership_deadline_at = now() + interval '24 hours',
    chamber_vote_deadline_at = null,
    vp_tie_break_pending = false
  where b.status = 'other_chamber_review'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now();

  update public.bills b
  set
    status = case
      when b.status = 'debate' then
        case
          when b.originating_chamber = 'house' then 'house_floor'::public.bill_status
          else 'senate_floor'::public.bill_status
        end
      when b.status = 'other_chamber_debate' then
        case
          when b.originating_chamber = 'house' then 'senate_floor'::public.bill_status
          else 'house_floor'::public.bill_status
        end
      else b.status
    end,
    leadership_deadline_at = null,
    chamber_vote_deadline_at = now() + interval '24 hours',
    vp_tie_break_pending = false
  where b.status in ('debate', 'other_chamber_debate')
    and b.chamber_vote_deadline_at is null
    and not exists (
      select 1
      from public.bill_amendments a
      where a.bill_id = b.id
        and a.status = 'pending'
    )
    and (
      (b.leadership_deadline_at is not null and b.leadership_deadline_at < now())
      or (
        b.leadership_deadline_at is null
        and b.debate_started_at is not null
        and b.debate_started_at + interval '24 hours' < now()
      )
    );

  update public.bills b
  set
    status = case
      when b.originating_chamber = 'house' then 'house_floor'::public.bill_status
      else 'senate_floor'::public.bill_status
    end,
    leadership_deadline_at = null,
    chamber_vote_deadline_at = now() + interval '24 hours',
    vp_tie_break_pending = false
  where b.status = 'on_docket'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now()
    and not exists (
      select 1
      from public.bill_amendments a
      where a.bill_id = b.id
        and a.status = 'pending'
    );
end;
$$;

-- ---------- Admin: emergency economy unfreeze ----------
create or replace function public.simulation_admin_unfreeze_economy(p_confirm boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not coalesce(p_confirm, false) then
    raise exception 'Confirmation required.';
  end if;
  if not public.is_staff_admin(v_uid) then
    raise exception 'Admin only.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' order by started_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.rp_fiscal_years
  set economy_activity_frozen = false
  where id = y.id;

  insert into public.simulation_calendar_events (event_key, metadata)
  values (
    'admin_economy_unfreeze_' || gen_random_uuid()::text,
    jsonb_build_object('manually_triggered', true, 'triggered_by', v_uid, 'fiscal_year_id', y.id)
  );

  return jsonb_build_object('ok', true, 'changed', true, 'fiscal_year_id', y.id);
end;
$$;

grant execute on function public.simulation_admin_unfreeze_economy(boolean) to authenticated;

notify pgrst, 'reload schema';
