-- Biennial budget: allow propose during legislative until enacted; expose propose gate in scheduler status.

create or replace function public._city_budget_propose_allowed(p_epoch timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._city_cycle_phase_from_epoch(p_epoch) = 'sign_ups_open' then true
    when public._city_cycle_phase_from_epoch(p_epoch) = 'legislative'
      and not public._city_biennium_budget_enacted(public._city_biennium_index_from_epoch(p_epoch)) then true
    else false
  end;
$$;

create or replace function public.mayor_propose_city_budget(
  p_finance numeric default null,
  p_police numeric default null,
  p_public_works numeric default null,
  p_parks numeric default null,
  p_planning numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  budget_id uuid;
  fy smallint;
  rev numeric;
  exp numeric;
  def numeric;
  epoch timestamptz;
  phase text;
  biennium smallint;
  f numeric := coalesce(p_finance, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'finance'));
  pol numeric := coalesce(p_police, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'police'));
  pw numeric := coalesce(p_public_works, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'public_works'));
  pk numeric := coalesce(p_parks, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'parks'));
  pl numeric := coalesce(p_planning, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'planning'));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may propose the city budget';
  end if;

  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  phase := public._city_cycle_phase_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);

  if not public._city_budget_propose_allowed(epoch) then
    raise exception 'City budget may only be proposed during sign-ups or legislative session until the biennium budget is enacted';
  end if;

  if public._city_biennium_budget_enacted(biennium) then
    raise exception 'A budget for biennium % has already been enacted', biennium;
  end if;

  if exists (select 1 from public.city_budgets where status in ('proposed', 'council_vote', 'awaiting_mayor')) then
    raise exception 'A budget is already pending council action or mayor signature';
  end if;

  rev := public._city_biennial_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;
  fy := biennium;

  insert into public.city_budgets (
    fiscal_year, status, proposed_by,
    projected_revenue_millions, projected_expenditure_millions, projected_deficit_millions
  ) values (
    fy, 'council_vote', v_uid, rev, exp, def
  )
  returning id into budget_id;

  insert into public.city_budget_lines (budget_id, department_key, amount_millions) values
    (budget_id, 'finance', coalesce(f, 0)),
    (budget_id, 'police', coalesce(pol, 0)),
    (budget_id, 'public_works', coalesce(pw, 0)),
    (budget_id, 'parks', coalesce(pk, 0)),
    (budget_id, 'planning', coalesce(pl, 0));

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object('ok', true, 'budget_id', budget_id, 'fiscal_year', fy, 'biennium', true);
end;
$$;

create or replace function public.tick_city_realtime_scheduler(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  eng record;
  epoch timestamptz;
  elapsed numeric;
  cycle_idx bigint;
  pos numeric;
  phase text;
  sim_yr smallint;
  biennium smallint;
  even_yr smallint;
  phase_changed boolean := false;
  elections_opened int := 0;
  class_b_opened int := 0;
  salary_forfeited int := 0;
  election_out jsonb;
  cycle_start timestamptz;
begin
  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week, turn_phase, epoch_started_at)
    values (p_city_code, 0, 1, 1, 'sign_ups_open', now())
    returning * into eng;
  end if;

  epoch := coalesce(eng.epoch_started_at, now());
  elapsed := public._city_elapsed_hours(epoch);
  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  pos := public._city_position_in_cycle_hours(epoch);
  phase := public._city_cycle_phase_from_epoch(epoch);
  sim_yr := public._city_sim_year_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;

  if eng.last_cycle_phase is distinct from phase then
    phase_changed := true;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  salary_forfeited := public._city_forfeit_expired_salary_windows(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  if cycle_idx <> coalesce(eng.last_cycle_index, -1) then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours())::int);
    elections_opened := public._city_open_election_cycle(
      p_city_code,
      (cycle_idx * 2 + 1)::smallint,
      cycle_start
    );
  end if;

  if pos >= public._city_sim_year_hours()
     and coalesce(eng.class_b_cycle_opened, -1) <> cycle_idx then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours() + public._city_sim_year_hours())::int);
    class_b_opened := public._city_open_election_cycle(p_city_code, even_yr, cycle_start);
    update public.city_sim_engine_state
    set class_b_cycle_opened = cycle_idx
    where city_code = p_city_code;
  end if;

  election_out := public._city_advance_mb_election_phases();

  update public.city_sim_engine_state
  set
    sim_year = sim_yr,
    sim_week = 1,
    turn_phase = phase::public.city_turn_phase,
    last_cycle_index = cycle_idx,
    last_cycle_phase = phase,
    updated_at = now()
  where city_code = p_city_code;

  update public.city_fiscal_metrics
  set fiscal_year = biennium, updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'sim_year', sim_yr,
    'biennium_index', biennium,
    'cycle_index', cycle_idx,
    'cycle_phase', phase,
    'position_in_cycle_hours', round(pos, 2),
    'phase_changed', phase_changed,
    'active_council_class', public._city_active_council_class(sim_yr),
    'mayor_election_active', public._city_mayor_election_active(sim_yr),
    'budget_proposal_open', phase = 'sign_ups_open',
    'budget_propose_allowed', public._city_budget_propose_allowed(epoch),
    'budget_enacted', public._city_biennium_budget_enacted(biennium),
    'ordinances_allowed', phase = 'legislative' and public._city_biennium_budget_enacted(biennium),
    'elections_opened', elections_opened,
    'class_b_opened', class_b_opened,
    'salary_forfeited', salary_forfeited,
    'election_track', election_out
  );
end;
$$;

grant execute on function public._city_budget_propose_allowed(timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
