-- Ordinances unlock once the biennium budget passes council (awaiting mayor signature or enacted).

create or replace function public._city_biennium_budget_passed(p_biennium smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.city_budgets b
    where b.fiscal_year = p_biennium
      and b.status in ('awaiting_mayor', 'enacted')
  )
  or exists (
    -- Legacy rows keyed by sim year instead of biennium index (early cycle 1 data).
    select 1 from public.city_budgets b
    where p_biennium = 1
      and b.fiscal_year between 1 and 2
      and b.status in ('awaiting_mayor', 'enacted')
      and not exists (
        select 1
        from public.city_budgets newer
        where newer.id <> b.id
          and newer.status in ('awaiting_mayor', 'enacted', 'council_vote', 'proposed')
          and coalesce(newer.enacted_at, newer.created_at)
            > coalesce(b.enacted_at, b.created_at)
      )
  );
$$;

create or replace function public._city_assert_legislation_allowed()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  epoch timestamptz;
  phase text;
  biennium smallint;
begin
  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  phase := public._city_cycle_phase_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);

  if phase <> 'legislative' then
    raise exception 'Ordinances may only be proposed or voted during the legislative window (after election season ends)';
  end if;

  if not public._city_biennium_budget_passed(biennium) then
    raise exception 'The biennium budget must pass council before other legislation can be filed';
  end if;
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
  budget_passed boolean;
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
  budget_passed := public._city_biennium_budget_passed(biennium);

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
    'budget_passed', budget_passed,
    'ordinances_allowed', phase = 'legislative' and budget_passed,
    'elections_opened', elections_opened,
    'class_b_opened', class_b_opened,
    'salary_forfeited', salary_forfeited,
    'election_track', election_out
  );
end;
$$;

grant execute on function public._city_biennium_budget_passed(smallint) to authenticated, service_role;

notify pgrst, 'reload schema';
