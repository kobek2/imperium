-- City economic revenue pipeline: office salaries, business tax placeholder, derived economy fiscal columns.

alter table public.city_fiscal_metrics
  add column if not exists business_tax_revenue_millions numeric not null default 0 check (business_tax_revenue_millions >= 0),
  add column if not exists salary_tax_revenue_millions numeric not null default 0 check (salary_tax_revenue_millions >= 0),
  add column if not exists office_salary_pool_millions numeric not null default 0 check (office_salary_pool_millions >= 0);

alter table public.city_sim_engine_state
  add column if not exists economic_pressure numeric not null default 0;

create table if not exists public.city_office_salary_ledger (
  user_id uuid primary key references auth.users (id) on delete cascade,
  city_code char(2) not null default 'MB' references public.cities (code) on delete cascade,
  role_key text not null check (role_key in ('mayor', 'council_member')),
  term_started_at timestamptz not null default now(),
  accrued_usd numeric not null default 0 check (accrued_usd >= 0),
  accrual_capped boolean not null default false,
  collection_deadline_at timestamptz not null,
  last_accrual_at timestamptz,
  collected_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists city_office_salary_ledger_city_idx
  on public.city_office_salary_ledger (city_code);

alter table public.city_office_salary_ledger enable row level security;
drop policy if exists "city_office_salary_ledger read own" on public.city_office_salary_ledger;
create policy "city_office_salary_ledger read own"
  on public.city_office_salary_ledger for select to authenticated
  using (user_id = auth.uid());

create or replace function public._city_office_salary_per_turn(p_role_key text)
returns numeric
language sql
immutable
as $$
  select case lower(trim(p_role_key))
    when 'mayor' then 125000::numeric
    when 'council_member' then 75000::numeric
    else 0::numeric
  end;
$$;

create or replace function public._city_office_salary_pool_total(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.accrued_usd), 0)::numeric
  from public.city_office_salary_ledger l
  where l.city_code = p_city_code
    and l.collected_at is null
    and l.accrued_usd > 0;
$$;

create or replace function public._sync_city_office_salary_pool_column(p_city_code char(2) default 'MB')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.city_fiscal_metrics
  set office_salary_pool_millions = public._city_office_salary_pool_total(p_city_code) / 1000000.0,
      updated_at = now()
  where city_code = p_city_code;
end;
$$;

create or replace function public._open_city_office_salary_term(
  p_user_id uuid,
  p_role_key text,
  p_city_code char(2) default 'MB'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_role_key not in ('mayor', 'council_member') then
    return;
  end if;

  insert into public.city_office_salary_ledger (
    user_id, city_code, role_key, term_started_at, accrued_usd, accrual_capped,
    collection_deadline_at, last_accrual_at, collected_at, updated_at
  ) values (
    p_user_id, p_city_code, p_role_key, now(), 0, false,
    now() + interval '24 hours', null, null, now()
  )
  on conflict (user_id) do update set
    city_code = excluded.city_code,
    role_key = excluded.role_key,
    term_started_at = now(),
    accrued_usd = 0,
    accrual_capped = false,
    collection_deadline_at = now() + interval '24 hours',
    last_accrual_at = null,
    collected_at = null,
    updated_at = now();

  perform public._sync_city_office_salary_pool_column(p_city_code);
end;
$$;

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
    select l.user_id, l.role_key, l.accrual_capped, l.collection_deadline_at
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

    if now() > rec.collection_deadline_at then
      update public.city_office_salary_ledger
      set accrual_capped = true, updated_at = now()
      where user_id = rec.user_id;
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

create or replace function public.city_collect_office_salary(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  led record;
  fiscal record;
  gross numeric;
  tax numeric;
  net numeric;
  blended numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into led
  from public.city_office_salary_ledger
  where user_id = v_uid and city_code = p_city_code
  for update;

  if led.user_id is null then
    return jsonb_build_object('ok', false, 'message', 'No office salary on file.');
  end if;
  if led.accrued_usd <= 0 then
    return jsonb_build_object('ok', false, 'message', 'Nothing to collect yet.');
  end if;
  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key = led.role_key
  ) then
    return jsonb_build_object('ok', false, 'message', 'You no longer hold that office.');
  end if;

  gross := led.accrued_usd;
  select * into fiscal from public.city_fiscal_metrics where city_code = p_city_code;

  tax := 0;
  if fiscal.income_tax_enabled then
    blended := (0.4 * fiscal.income_tax_low_pct + 0.4 * fiscal.income_tax_mid_pct + 0.2 * fiscal.income_tax_high_pct) / 100.0;
    tax := round(gross * blended, 2);
  end if;
  net := gross - tax;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  update public.economy_wallets
  set balance = balance + net, last_collected_at = now(), updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  select v_uid, net, w.balance, 'city_office_salary',
    jsonb_build_object('gross', gross, 'city_income_tax', tax, 'role', led.role_key)
  from public.economy_wallets w where w.user_id = v_uid;

  update public.city_fiscal_metrics set
    salary_tax_revenue_millions = salary_tax_revenue_millions + (tax / 1000000.0),
    treasury_balance = treasury_balance + (tax / 1000000.0),
    updated_at = now()
  where city_code = p_city_code;

  update public.city_office_salary_ledger set
    accrued_usd = 0,
    collected_at = now(),
    updated_at = now()
  where user_id = v_uid;

  perform public._sync_city_office_salary_pool_column(p_city_code);

  return jsonb_build_object(
    'ok', true,
    'gross', gross,
    'city_income_tax', tax,
    'net', net,
    'role', led.role_key
  );
end;
$$;

create or replace function public.refresh_city_business_tax_revenue(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  approval numeric;
  growth numeric := 0.000014;
  revenue_millions numeric;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then
    return jsonb_build_object('ok', false);
  end if;

  approval := greatest(0, least(100, coalesce(m.mayor_approval, 50)));
  if m.population > 0 then
    revenue_millions := (m.population::numeric * (approval / 100.0) * growth * m.population::numeric) / 1000000.0;
  else
    revenue_millions := 0;
  end if;

  update public.city_fiscal_metrics set
    business_tax_revenue_millions = revenue_millions,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object('ok', true, 'business_tax_revenue_millions', revenue_millions);
end;
$$;

-- Open salary term when city offices are won.
create or replace function public._apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  winner record;
  winner_role text;
  incompat text[];
  leadership text[];
  winner_party text;
  party_code char(1);
begin
  select id, office, state, district_code, ward_code, senate_class, phase, winner_user_id, winner_candidate_id, roles_applied_at
    into race
    from public.elections
    where id = e_election;
  if not found then return; end if;
  if race.phase <> 'closed'::public.election_phase then return; end if;
  if race.roles_applied_at is not null then return; end if;

  leadership := array[
    'council_spokesperson',
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.office = 'mayor' then
    winner_role := 'mayor';
    incompat := array['council_member', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'council_ward' then
    winner_role := 'council_member';
    incompat := array['mayor', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president', 'mayor', 'council_member'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president', 'mayor', 'council_member'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president', 'mayor', 'council_member'];
  end if;

  if race.winner_user_id is not null then
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    update public.profiles p
      set office_role = winner_role,
          home_district_code = case
            when race.office = 'council_ward' then coalesce(race.ward_code, p.home_district_code)
            else p.home_district_code
          end,
          residence_state = case
            when race.office in ('mayor', 'council_ward') then 'MB'
            else p.residence_state
          end,
          updated_at = now()
      where p.id = race.winner_user_id;

    if race.office in ('mayor', 'council_ward') then
      perform public._open_city_office_salary_term(race.winner_user_id, winner_role, 'MB');
    end if;

    if race.office = 'council_ward' and race.ward_code is not null then
      select ec.party, ec.sim_politician_id, pr.display_name
        into winner
        from public.election_candidates ec
        left join public.profiles pr on pr.id = ec.user_id
        where ec.election_id = e_election and ec.user_id = race.winner_user_id
        limit 1;

      winner_party := coalesce(winner.party, 'democrat');
      party_code := public._party_to_incumbent_code(winner_party);

      if winner.sim_politician_id is not null then
        update public.wards w set
          incumbent_politician_id = winner.sim_politician_id,
          incumbent_party = party_code,
          incumbent_npc_name = coalesce(nullif(trim(winner.display_name), ''), w.incumbent_npc_name),
          claimed_by = race.winner_user_id
        where w.code = race.ward_code;
      else
        update public.wards w set
          incumbent_party = party_code,
          incumbent_npc_name = coalesce(nullif(trim(winner.display_name), ''), w.incumbent_npc_name),
          claimed_by = race.winner_user_id
        where w.code = race.ward_code;
      end if;

      perform public.sync_campaign_council_caucus();
    elsif race.office = 'mayor' then
      update public.mayor_seat ms set
        incumbent_politician_id = (
          select ec.sim_politician_id from public.election_candidates ec
          where ec.election_id = e_election and ec.user_id = race.winner_user_id
          limit 1
        )
      where ms.city_code = 'MB';
    end if;
  end if;

  for cand in
    select ec.user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'council_ward' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.ward_code, ''))
         or upper(coalesce(cand.residence_state, '')) = 'MB' then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'council_member';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'council_member';
      end if;
    elsif race.office = 'mayor' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'mayor';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'mayor';
    elsif race.office = 'house' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.district_code, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';
    end if;

    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  update public.elections set roles_applied_at = now() where id = e_election;
end;
$$;

-- Patch fiscal snapshot RPC with revenue columns.
create or replace function public.get_city_fiscal_snapshot(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  m record;
  depts jsonb;
  effects jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then raise exception 'City fiscal metrics not found for %', p_city_code; end if;

  select coalesce(jsonb_agg(jsonb_build_object('department_key', d.department_key, 'amount_millions', d.amount_millions) order by d.department_key), '[]'::jsonb)
    into depts from public.city_fiscal_department_allocations d where d.city_code = p_city_code;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'source_type', e.source_type, 'source_id', e.source_id,
    'title', e.title, 'summary', e.summary, 'effects', e.effects, 'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
    into effects
  from (select * from public.city_sim_effect_events where city_code = p_city_code order by created_at desc limit 8) e;

  return jsonb_build_object(
    'city_code', m.city_code,
    'population', m.population,
    'avg_household_income', m.avg_household_income,
    'economy_index', m.economy_index,
    'property_tax_rate_pct', m.property_tax_rate_pct,
    'income_tax_enabled', m.income_tax_enabled,
    'income_tax_low_pct', m.income_tax_low_pct,
    'income_tax_mid_pct', m.income_tax_mid_pct,
    'income_tax_high_pct', m.income_tax_high_pct,
    'intergovernmental_aid_millions', coalesce(m.intergovernmental_aid_millions, 0),
    'treasury_balance', m.treasury_balance,
    'fiscal_year', m.fiscal_year,
    'business_tax_revenue_millions', coalesce(m.business_tax_revenue_millions, 0),
    'salary_tax_revenue_millions', coalesce(m.salary_tax_revenue_millions, 0),
    'office_salary_pool_millions', coalesce(m.office_salary_pool_millions, 0),
    'public_safety', coalesce(m.public_safety, 50),
    'education_quality', coalesce(m.education_quality, 50),
    'housing_affordability', coalesce(m.housing_affordability, 45),
    'business_climate', coalesce(m.business_climate, 50),
    'mayor_approval', coalesce(m.mayor_approval, 52),
    'updated_at', m.updated_at,
    'departments', depts,
    'recent_effects', effects
  );
end;
$$;

-- Seed business tax from current approval.
select public.refresh_city_business_tax_revenue('MB');

-- Persist economic_pressure alongside engine JSON.
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
        'approval_rating', coalesce(h.approval_rating, public._city_approval_rating_from_metrics(h.metrics)),
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
      'seed', eng.seed,
      'variables', eng.variables,
      'metrics', eng.metrics,
      'effect_queue', eng.effect_queue,
      'pressure_log', eng.pressure_log,
      'shock_cooldowns', eng.shock_cooldowns,
      'recent_shocks', eng.recent_shocks,
      'presentation_meta', eng.presentation_meta,
      'economic_pressure', coalesce(eng.economic_pressure, 0)
    ) end,
    'history', hist,
    'fiscal_year', coalesce(fy, 1),
    'updated_at', coalesce(upd, now())
  );
end;
$$;

create or replace function public.save_city_metrics_snapshot(
  p_city_code char(2),
  p_engine_state jsonb,
  p_history_append jsonb default '[]'::jsonb,
  p_sync_fiscal boolean default true,
  p_presentation_meta jsonb default null,
  p_presentation_events jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  elem jsonb;
  metrics jsonb;
  approval smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  insert into public.city_sim_engine_state (
    city_code, sim_tick, seed, variables, metrics, effect_queue, pressure_log, shock_cooldowns, recent_shocks, presentation_meta, economic_pressure, updated_at
  ) values (
    p_city_code,
    coalesce((p_engine_state->>'sim_tick')::bigint, 0),
    coalesce((p_engine_state->>'seed')::bigint, 2864434397),
    coalesce(p_engine_state->'variables', '{}'::jsonb),
    coalesce(p_engine_state->'metrics', '{}'::jsonb),
    coalesce(p_engine_state->'effect_queue', '[]'::jsonb),
    coalesce(p_engine_state->'pressure_log', '{}'::jsonb),
    coalesce(p_engine_state->'shock_cooldowns', '{}'::jsonb),
    coalesce(p_engine_state->'recent_shocks', '[]'::jsonb),
    coalesce(p_presentation_meta, p_engine_state->'presentation_meta', '{}'::jsonb),
    coalesce((p_engine_state->>'economic_pressure')::numeric, 0),
    now()
  )
  on conflict (city_code) do update set
    sim_tick = excluded.sim_tick,
    seed = excluded.seed,
    variables = excluded.variables,
    metrics = excluded.metrics,
    effect_queue = excluded.effect_queue,
    pressure_log = excluded.pressure_log,
    shock_cooldowns = excluded.shock_cooldowns,
    recent_shocks = excluded.recent_shocks,
    presentation_meta = coalesce(excluded.presentation_meta, city_sim_engine_state.presentation_meta),
    economic_pressure = excluded.economic_pressure,
    updated_at = now();

  if jsonb_array_length(coalesce(p_history_append, '[]'::jsonb)) > 0 then
    for elem in select * from jsonb_array_elements(p_history_append) loop
      metrics := elem->'metrics';
      approval := coalesce(
        (elem->>'approval_rating')::smallint,
        public._city_approval_rating_from_metrics(metrics)
      );
      insert into public.city_metric_history (city_code, sim_tick, metrics, approval_rating, recorded_at)
      values (
        p_city_code,
        (elem->>'sim_tick')::bigint,
        metrics,
        approval,
        coalesce((elem->>'recorded_at')::timestamptz, now())
      )
      on conflict (city_code, sim_tick) do update set
        metrics = excluded.metrics,
        approval_rating = excluded.approval_rating,
        recorded_at = excluded.recorded_at;
    end loop;
  end if;

  update public.city_fiscal_metrics set
    sim_tick = coalesce((p_engine_state->>'sim_tick')::bigint, sim_tick),
    economy_index = public._clamp_city_metric(coalesce((p_engine_state->'metrics'->>'economy')::numeric, economy_index)),
    mayor_approval = coalesce(
      (select h.approval_rating from public.city_metric_history h
       where h.city_code = p_city_code order by h.sim_tick desc limit 1),
      mayor_approval
    )
  where city_code = p_city_code;

  if p_sync_fiscal then
    perform public._sync_fiscal_from_engine_metrics(p_city_code, p_engine_state->'metrics');
  end if;

  if p_presentation_events is not null then
    perform public.append_city_presentation_events(
      p_city_code,
      coalesce(p_presentation_meta, '{}'::jsonb),
      coalesce(p_presentation_events->'narratives', '[]'::jsonb),
      p_presentation_events->>'low_approval_briefing',
      coalesce((p_presentation_events->>'primary_challenger')::boolean, false)
    );
  end if;

  return jsonb_build_object('ok', true, 'sim_tick', p_engine_state->>'sim_tick');
end;
$$;

-- Salary + business tax refresh on council campaign turns.
create or replace function public._campaign_auto_advance_turn_internal()
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
    return jsonb_build_object('ok', false, 'skipped', true);
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
  else
    perform public._rival_strategist_congress_tick();
    perform public.tick_city_office_salaries('MB');
    perform public.refresh_city_business_tax_revenue('MB');
  end if;

  perform public._rival_strategist_log(
    'round_advance',
    format('Council turn complete — now cycle %s, turn %s/%s (%s).', new_cycle, new_turn, public._campaign_cycle_turns(), new_phase),
    jsonb_build_object('cycle', new_cycle, 'turn', new_turn, 'phase', new_phase, 'auto', true)
  );

  return jsonb_build_object(
    'ok', true, 'turn_advanced', true, 'cycle', new_cycle, 'turn', new_turn, 'phase', new_phase
  );
end;
$$;

grant execute on function public.tick_city_office_salaries(char) to authenticated, service_role;
grant execute on function public.city_collect_office_salary(char) to authenticated, service_role;
grant execute on function public.refresh_city_business_tax_revenue(char) to authenticated, service_role;

-- Seed salary ledger rows for current officeholders (new wins also open terms via election hook).
insert into public.city_office_salary_ledger (
  user_id, city_code, role_key, term_started_at, accrued_usd, accrual_capped,
  collection_deadline_at, last_accrual_at, collected_at, updated_at
)
select
  g.user_id,
  'MB',
  g.role_key,
  now(),
  0,
  false,
  now() + interval '24 hours',
  null,
  null,
  now()
from public.government_role_grants g
where g.role_key in ('mayor', 'council_member')
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
