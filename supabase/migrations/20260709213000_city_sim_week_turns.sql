-- City simulator: admin-controlled week-by-week turns (no wall-clock auto-advance).

alter table public.city_sim_engine_state
  add column if not exists sim_year smallint not null default 1 check (sim_year >= 1),
  add column if not exists sim_week smallint not null default 1 check (sim_week between 1 and 52);

comment on column public.city_sim_engine_state.sim_year is 'RP sim year; advances when sim_week rolls past 52.';
comment on column public.city_sim_engine_state.sim_week is 'RP sim week within sim_year (1–52). Advanced only by admin_advance_city_sim_week.';

-- Forfeit uncollected office salary at week boundary (replaces 24h collection deadline).
create or replace function public._city_sim_cap_uncollected_salaries(p_city_code char(2) default 'MB')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  update public.city_office_salary_ledger l
  set
    accrued_usd = 0,
    accrual_capped = true,
    updated_at = now()
  where l.city_code = p_city_code
    and l.accrued_usd > 0
    and exists (
      select 1 from public.government_role_grants g
      where g.user_id = l.user_id and g.role_key = l.role_key
    );

  get diagnostics n = row_count;
  perform public._sync_city_office_salary_pool_column(p_city_code);
  return n;
end;
$$;

-- Turn-based accrual only (no wall-clock deadline).
create or replace function public.tick_city_office_salaries(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  bump numeric;
  n int := 0;
begin
  for rec in
    select l.user_id, l.role_key, l.accrual_capped
    from public.city_office_salary_ledger l
    where l.city_code = p_city_code
      and exists (
        select 1 from public.government_role_grants g
        where g.user_id = l.user_id and g.role_key = l.role_key
      )
  loop
    if rec.accrual_capped then
      continue;
    end if;

    bump := public._city_office_salary_per_turn(rec.role_key);
    update public.city_office_salary_ledger
    set accrued_usd = accrued_usd + bump,
        last_accrual_at = now(),
        updated_at = now()
    where user_id = rec.user_id;
    n := n + 1;
  end loop;

  perform public._sync_city_office_salary_pool_column(p_city_code);
  return jsonb_build_object('ok', true, 'accruals', n);
end;
$$;

-- Reset salary collection window for a new sim week (uncap holders still in office).
create or replace function public._city_sim_reset_salary_week(p_city_code char(2) default 'MB')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.city_office_salary_ledger l
  set
    accrual_capped = false,
    collection_deadline_at = now(),
    updated_at = now()
  where l.city_code = p_city_code
    and exists (
      select 1 from public.government_role_grants g
      where g.user_id = l.user_id and g.role_key = l.role_key
    );
end;
$$;

-- Campaign turn advance logic (admin-triggered only — no auto on round complete).
create or replace function public._campaign_advance_turn_internal(p_auto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  old_turn int;
  old_phase text;
  new_turn int;
  new_cycle int;
  new_phase text;
begin
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.id is null or sim.campaign_manager_active is not true then
    return jsonb_build_object('ok', false, 'skipped', true, 'reason', 'campaign_inactive');
  end if;

  old_turn := sim.campaign_manager_turn;
  old_phase := public._campaign_manager_phase_from_turn(old_turn);

  new_turn := old_turn + 1;
  new_cycle := sim.campaign_manager_cycle;
  if new_turn > public._campaign_cycle_turns() then
    new_turn := 1;
    new_cycle := new_cycle + 1;
  end if;
  new_phase := public._campaign_manager_phase_from_turn(new_turn);

  update public.simulation_settings
  set campaign_manager_turn = new_turn, campaign_manager_cycle = new_cycle, updated_at = now()
  where id = 1;

  if new_cycle > sim.campaign_manager_cycle then
    perform public._campaign_manager_cycle_refill();
  end if;

  if old_phase = 'elections' then
    perform public._rival_strategist_election_tick(false);
  elsif old_phase = 'congress' or old_phase = 'council' then
    perform public._rival_strategist_congress_tick();
  end if;

  perform public._rival_strategist_log(
    'round_advance',
    format(
      'Sim week advanced — cycle %s, turn %s/%s (%s).',
      new_cycle, new_turn, public._campaign_cycle_turns(), new_phase
    ),
    jsonb_build_object('cycle', new_cycle, 'turn', new_turn, 'phase', new_phase, 'auto', p_auto)
  );

  return jsonb_build_object(
    'ok', true,
    'turn_advanced', true,
    'cycle', new_cycle,
    'turn', new_turn,
    'phase', new_phase
  );
end;
$$;

-- Disabled: legislative rounds no longer auto-advance the sim week.
create or replace function public._campaign_auto_advance_turn_internal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('ok', false, 'skipped', true, 'reason', 'admin_week_control');
end;
$$;

create or replace function public.get_city_sim_week_status(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  eng record;
  sim record;
  phase text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select sim_year, sim_week, sim_tick into eng
  from public.city_sim_engine_state where city_code = p_city_code;

  select * into sim from public.simulation_settings where id = 1;
  phase := case
    when coalesce(sim.campaign_manager_active, false) then
      public._campaign_manager_phase_from_turn(coalesce(sim.campaign_manager_turn, 1))
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'city_code', p_city_code,
    'sim_year', coalesce(eng.sim_year, 1),
    'sim_week', coalesce(eng.sim_week, 1),
    'sim_tick', coalesce(eng.sim_tick, 0),
    'campaign_active', coalesce(sim.campaign_manager_active, false),
    'campaign_cycle', coalesce(sim.campaign_manager_cycle, 1),
    'campaign_turn', coalesce(sim.campaign_manager_turn, 1),
    'campaign_phase', phase
  );
end;
$$;

create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  eng record;
  new_year smallint;
  new_week smallint;
  capped int;
  turn_out jsonb;
  warnings text[] := '{}';
  rnd record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;

  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week)
    values (p_city_code, 0, 1, 1)
    returning * into eng;
  end if;

  if not p_force and coalesce(
    (select sim.campaign_manager_active from public.simulation_settings sim where sim.id = 1),
    false
  ) then
    select * into rnd from public.legislative_rounds r
    where r.campaign_cycle = (select campaign_manager_cycle from public.simulation_settings where id = 1)
      and r.campaign_turn = (select campaign_manager_turn from public.simulation_settings where id = 1)
      and r.phase <> 'completed'
    order by r.created_at desc limit 1;

    if rnd.id is not null then
      warnings := array_append(warnings, format('Legislative round still in %s phase', rnd.phase));
    end if;
  end if;

  capped := public._city_sim_cap_uncollected_salaries(p_city_code);

  new_week := eng.sim_week + 1;
  new_year := eng.sim_year;
  if new_week > 52 then
    new_week := 1;
    new_year := new_year + 1;
  end if;

  update public.city_sim_engine_state
  set sim_year = new_year, sim_week = new_week, updated_at = now()
  where city_code = p_city_code;

  perform public._city_sim_reset_salary_week(p_city_code);
  perform public.tick_city_office_salaries(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  turn_out := public._campaign_advance_turn_internal(false);

  return jsonb_build_object(
    'ok', true,
    'sim_year', new_year,
    'sim_week', new_week,
    'sim_tick', eng.sim_tick,
    'salaries_forfeited', capped,
    'campaign_turn', turn_out,
    'warnings', warnings,
    'forced', p_force
  );
end;
$$;

-- Include sim week in metrics snapshot reads.
create or replace function public.get_city_metrics_snapshot(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  eng record;
  hist jsonb;
  fy int;
  upd timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into eng from public.city_sim_engine_state where city_code = p_city_code;
  select fiscal_year, updated_at into fy, upd from public.city_fiscal_metrics where city_code = p_city_code;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sim_tick', h.sim_tick,
        'metrics', h.metrics,
        'approval_rating', h.approval_rating,
        'recorded_at', h.recorded_at
      )
      order by h.sim_tick asc
    ),
    '[]'::jsonb
  ) into hist
  from (
    select * from public.city_metric_history
    where city_code = p_city_code
    order by sim_tick desc
    limit 120
  ) h;

  return jsonb_build_object(
    'engine_state', case when eng.city_code is null then null else jsonb_build_object(
      'city_code', eng.city_code,
      'sim_tick', eng.sim_tick,
      'sim_year', coalesce(eng.sim_year, 1),
      'sim_week', coalesce(eng.sim_week, 1),
      'seed', eng.seed,
      'variables', eng.variables,
      'metrics', eng.metrics,
      'effect_queue', eng.effect_queue,
      'pressure_log', eng.pressure_log,
      'shock_cooldowns', eng.shock_cooldowns,
      'recent_shocks', eng.recent_shocks,
      'presentation_meta', eng.presentation_meta,
      'economic_pressure', eng.economic_pressure
    ) end,
    'history', hist,
    'fiscal_year', coalesce(fy, 1),
    'updated_at', coalesce(upd, now())
  );
end;
$$;

grant execute on function public.get_city_sim_week_status(char) to authenticated, service_role;
grant execute on function public.admin_advance_city_sim_week(char, boolean) to authenticated, service_role;
grant execute on function public._city_sim_cap_uncollected_salaries(char) to authenticated, service_role;

notify pgrst, 'reload schema';
