-- September budget cycle: start in RP September 2026, apply one-day pace override,
-- enforce shutdown after the initial 24-hour presidential window, and allow a treasury
-- recovery period until the next September cycle.

alter table public.simulation_settings
  add column if not exists september_budget_speed_active boolean not null default false,
  add column if not exists september_budget_speed_previous numeric,
  add column if not exists september_budget_speed_started_at timestamptz,
  add column if not exists september_budget_speed_expires_at timestamptz,
  add column if not exists september_budget_window_key text;

alter table public.rp_fiscal_years
  add column if not exists budget_cycle_rp_key text,
  add column if not exists budget_initial_window_ends_at timestamptz,
  add column if not exists budget_initial_window_missed_at timestamptz,
  add column if not exists budget_treasury_override_until timestamptz;

comment on column public.rp_fiscal_years.budget_cycle_rp_key is
  'RP year-month key (YYYY-MM) that opened the September budget window for this fiscal year.';
comment on column public.rp_fiscal_years.budget_initial_window_ends_at is
  'IRL instant when the initial 24h presidential September budget window ends.';
comment on column public.rp_fiscal_years.budget_initial_window_missed_at is
  'IRL instant when the initial September budget window expired without enrolled appropriations.';
comment on column public.rp_fiscal_years.budget_treasury_override_until is
  'IRL instant until which treasury override filing is permitted after a missed presidential window.';

create or replace function public.fiscal_sync_budget_cycle_with_simulation()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  s record;
  y record;
  v_elapsed_days numeric;
  v_float_months numeric;
  v_rp_at timestamptz;
  v_rp_year int;
  v_rp_month int;
  v_rp_key text;
begin
  select * into s
  from public.simulation_settings
  where id = 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Simulation settings missing.');
  end if;

  -- Restore prior pace after the temporary 24h September window.
  if coalesce(s.september_budget_speed_active, false)
     and s.september_budget_speed_expires_at is not null
     and v_now >= s.september_budget_speed_expires_at then
    update public.simulation_settings
    set rp_months_per_real_day = coalesce(nullif(s.september_budget_speed_previous, 0), rp_months_per_real_day),
        september_budget_speed_active = false,
        september_budget_speed_previous = null,
        september_budget_speed_started_at = null,
        september_budget_speed_expires_at = null,
        updated_at = v_now
    where id = 1;
  end if;

  v_elapsed_days := extract(epoch from (v_now - s.real_anchor_at)) / 86400.0;
  v_float_months := coalesce(s.admin_rp_month_offset, 0) + v_elapsed_days * coalesce(s.rp_months_per_real_day, 3.5);
  v_rp_at := (s.rp_anchor_date::timestamptz + interval '12 hours') + (v_float_months * interval '1 month');
  v_rp_year := extract(year from (v_rp_at at time zone 'utc'));
  v_rp_month := extract(month from (v_rp_at at time zone 'utc'));
  v_rp_key := format('%s-%s', v_rp_year::text, lpad(v_rp_month::text, 2, '0'));

  select * into y
  from public.rp_fiscal_years
  where status = 'active'
  for update;

  -- New cycle starts in RP September 2026 (and every September after).
  if v_rp_year >= 2026 and v_rp_month = 9 and coalesce(s.september_budget_window_key, '') <> v_rp_key then
    update public.simulation_settings
    set september_budget_speed_active = true,
        september_budget_speed_previous = coalesce(s.rp_months_per_real_day, 3.5),
        september_budget_speed_started_at = v_now,
        september_budget_speed_expires_at = v_now + interval '24 hours',
        september_budget_window_key = v_rp_key,
        rp_months_per_real_day = 1,
        updated_at = v_now
    where id = 1;

    if found and y.id is not null and y.appropriations_act_bill_id is null then
      update public.rp_fiscal_years
      set budget_cycle_rp_key = v_rp_key,
          appropriation_clock_started_at = v_now,
          appropriation_deadline_at = v_now + interval '24 hours',
          budget_initial_window_ends_at = v_now + interval '24 hours',
          budget_initial_window_missed_at = null,
          budget_treasury_override_until = v_now + interval '365 days'
      where id = y.id;
    end if;
  end if;

  -- If the initial 24h presidential window elapsed without an enrolled appropriations act,
  -- mark missed and keep treasury override active until next cycle.
  if y.id is not null
     and y.appropriations_act_bill_id is null
     and y.budget_initial_window_ends_at is not null
     and v_now > y.budget_initial_window_ends_at
     and y.budget_initial_window_missed_at is null then
    update public.rp_fiscal_years
    set budget_initial_window_missed_at = v_now,
        budget_treasury_override_until = coalesce(y.budget_treasury_override_until, v_now + interval '365 days')
    where id = y.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rp_year', v_rp_year,
    'rp_month', v_rp_month,
    'rp_key', v_rp_key
  );
end;
$$;

grant execute on function public.fiscal_sync_budget_cycle_with_simulation() to authenticated;

create or replace function public.fiscal_start_appropriation_clock_if_president_seated()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y record;
begin
  perform public.fiscal_sync_budget_cycle_with_simulation();

  select * into y
  from public.rp_fiscal_years
  where status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No active fiscal year.');
  end if;

  if y.budget_cycle_rp_key is null then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'awaiting_sep_2026_cycle');
  end if;

  if y.appropriation_clock_started_at is not null then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'already_started');
  end if;

  update public.rp_fiscal_years
  set appropriation_clock_started_at = now(),
      appropriation_deadline_at = now() + make_interval(hours => greatest(1, coalesce(y.appropriation_window_hours, 24))),
      budget_initial_window_ends_at = coalesce(y.budget_initial_window_ends_at, now() + interval '24 hours')
  where id = y.id;

  return jsonb_build_object('ok', true, 'started', true);
end;
$$;

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
    where y.status = 'active'
      and y.appropriations_act_bill_id is null
      and (
        (y.budget_initial_window_ends_at is not null and now() > y.budget_initial_window_ends_at)
        or (
          y.budget_initial_window_ends_at is null
          and y.appropriation_deadline_at is not null
          and now() > y.appropriation_deadline_at
        )
      )
  ) then
    raise exception
      'Federal government shutdown: the appropriations window has expired without an enrolled act. Economy payouts and purchases are suspended until appropriations are enacted.';
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

notify pgrst, 'reload schema';
