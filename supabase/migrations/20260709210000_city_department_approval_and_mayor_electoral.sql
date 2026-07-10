-- Department funding minimums, ward electoral mandate, underperforming department events.

drop function if exists public.append_city_presentation_events(char, jsonb, jsonb, text, boolean);

alter table public.city_fiscal_department_allocations
  add column if not exists minimum_required_millions numeric not null default 0 check (minimum_required_millions >= 0);

alter table public.city_fiscal_metrics
  add column if not exists mayor_electoral_approval smallint not null default 52 check (mayor_electoral_approval between 0 and 100);

-- Minimum required = 75% of enacted baseline.
update public.city_fiscal_department_allocations set minimum_required_millions = case department_key
  when 'finance' then 900
  when 'police' then 4350
  when 'public_works' then 1875
  when 'parks' then 525
  when 'planning' then 113
  else minimum_required_millions
end
where city_code = 'MB';

alter table public.city_sim_effect_events
  drop constraint if exists city_sim_effect_events_source_type_check;

alter table public.city_sim_effect_events
  add constraint city_sim_effect_events_source_type_check
  check (source_type in (
    'ordinance', 'budget', 'metrics_narrative', 'election_signal', 'department_underperforming'
  ));

create or replace function public._city_dept_minimum_millions(p_department_key text)
returns numeric
language sql
immutable
as $$
  select case lower(trim(p_department_key))
    when 'finance' then 900::numeric
    when 'police' then 4350::numeric
    when 'public_works' then 1875::numeric
    when 'parks' then 525::numeric
    when 'planning' then 113::numeric
    else 0::numeric
  end;
$$;

create or replace function public._city_mayor_party(p_city_code char(2) default 'MB')
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid;
  party text;
begin
  select g.user_id into uid
  from public.government_role_grants g
  where g.role_key = 'mayor'
  limit 1;

  if uid is not null then
    select p.party into party from public.profiles p where p.id = uid;
    if party is not null then return party; end if;
  end if;

  return 'democrat';
end;
$$;

create or replace function public._city_ward_signed_margin(
  p_winner_party text,
  p_mayor_party text,
  p_winner_vote_share numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_winner_vote_share is null or p_winner_vote_share <= 0 then 0::numeric
    else
      (case when lower(trim(p_winner_party)) = lower(trim(p_mayor_party)) then 1 else -1 end)
      * greatest(0::numeric, least(1::numeric, (greatest(0.5, least(1::numeric, p_winner_vote_share)) - 0.5) * 2))
  end;
$$;

create or replace function public.get_city_ward_election_margins(p_mayor_party text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mayor_party text := coalesce(nullif(trim(p_mayor_party), ''), public._city_mayor_party('MB'));
  sim_tick bigint;
  ward record;
  wards jsonb := '[]'::jsonb;
  race record;
  winner_party text;
  winner_share numeric;
  total_votes numeric;
  signed_margin numeric;
  ticks_since bigint;
begin
  select coalesce(s.sim_tick, 0) into sim_tick
  from public.city_sim_engine_state s where s.city_code = 'MB';

  for ward in
    select w.code, w.pvi, w.incumbent_party
    from public.wards w
    where w.city_code = 'MB'
    order by w.ward_number
  loop
    signed_margin := 0;
    ticks_since := coalesce(sim_tick, 0);

    select e.id, e.created_at into race
    from public.elections e
    where e.office = 'council_ward'
      and e.ward_code = ward.code
      and e.phase = 'closed'
    order by e.created_at desc
    limit 1;

    if race.id is not null then
      select sum(votes), max(party) into total_votes, winner_party
      from (
        select ec.party,
          coalesce(ec.npc_synthetic_votes, 0) + (
            select count(*)::numeric from public.general_votes gv
            where gv.election_id = race.id and gv.candidate_id = ec.id
          ) as votes
        from public.election_candidates ec
        where ec.election_id = race.id
      ) s;

      select party, votes / nullif(total_votes, 0) into winner_party, winner_share
      from (
        select ec.party,
          coalesce(ec.npc_synthetic_votes, 0) + (
            select count(*)::numeric from public.general_votes gv
            where gv.election_id = race.id and gv.candidate_id = ec.id
          ) as votes
        from public.election_candidates ec
        where ec.election_id = race.id
      ) ranked
      order by votes desc
      limit 1;

      signed_margin := public._city_ward_signed_margin(winner_party, mayor_party, winner_share);
      ticks_since := greatest(0, coalesce(sim_tick, 0) - floor(extract(epoch from (now() - race.created_at)) / (4 * 3600))::bigint);
    else
      winner_party := case ward.incumbent_party when 'R' then 'republican' else 'democrat' end;
      winner_share := 0.5 + least(0.45, abs(ward.pvi) / 80.0);
      signed_margin := public._city_ward_signed_margin(winner_party, mayor_party, winner_share);
      ticks_since := 15;
    end if;

    wards := wards || jsonb_build_array(jsonb_build_object(
      'ward_code', ward.code,
      'signed_margin', signed_margin,
      'ticks_since_election', ticks_since,
      'population_share', 1.0 / 7.0
    ));
  end loop;

  return jsonb_build_object('wards', wards, 'mayor_party', mayor_party);
end;
$$;

create or replace function public.recompute_mayor_electoral_approval(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mayor_party text;
  pop numeric;
  payload jsonb;
  elem jsonb;
  weighted_margin numeric := 0;
  weight_sum numeric := 0;
  w numeric;
  pop_share numeric;
  decay numeric;
  margin numeric;
  ticks_since numeric;
  approval smallint;
begin
  mayor_party := public._city_mayor_party(p_city_code);
  select m.population into pop from public.city_fiscal_metrics m where m.city_code = p_city_code;
  if pop is null or pop <= 0 then pop := 8336817; end if;

  payload := public.get_city_ward_election_margins(mayor_party);

  for elem in select * from jsonb_array_elements(coalesce(payload->'wards', '[]'::jsonb)) loop
    pop_share := coalesce((elem->>'population_share')::numeric, 1.0 / 7.0);
    margin := coalesce((elem->>'signed_margin')::numeric, 0);
    ticks_since := coalesce((elem->>'ticks_since_election')::numeric, 15);
    decay := power(0.5::numeric, ticks_since / 15.0);
    w := pop * pop_share * decay;
    weighted_margin := weighted_margin + w * margin;
    weight_sum := weight_sum + w;
  end loop;

  if weight_sum <= 0 then
    approval := 50;
  else
    approval := public._clamp_city_metric(50 + (weighted_margin / weight_sum) * 50);
  end if;

  update public.city_fiscal_metrics set
    mayor_electoral_approval = approval,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object('ok', true, 'mayor_electoral_approval', approval);
end;
$$;

create or replace function public.append_city_presentation_events(
  p_city_code char(2),
  p_presentation_meta jsonb,
  p_narratives jsonb default '[]'::jsonb,
  p_low_approval_briefing text default null,
  p_primary_challenger boolean default false,
  p_department_events jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  elem jsonb;
  head_id uuid;
  dept_key text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update public.city_sim_engine_state
  set presentation_meta = coalesce(p_presentation_meta, '{}'::jsonb)
  where city_code = p_city_code;

  for elem in select * from jsonb_array_elements(coalesce(p_narratives, '[]'::jsonb)) loop
    insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
    values (
      p_city_code,
      'metrics_narrative',
      null,
      elem->>'headline',
      elem->>'body',
      jsonb_build_object(
        'metric', elem->>'metric',
        'tier', elem->>'tier',
        'tick', elem->>'tick'
      )
    );
  end loop;

  for elem in select * from jsonb_array_elements(coalesce(p_department_events, '[]'::jsonb)) loop
    dept_key := coalesce(elem->>'department_key', 'planning');
    insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
    values (
      p_city_code,
      'department_underperforming',
      null,
      elem->>'headline',
      elem->>'body',
      jsonb_build_object(
        'department_key', dept_key,
        'metric', elem->>'metric',
        'tick', elem->>'tick'
      )
    );

    select sp.id into head_id
    from public.city_department_heads h
    join public.sim_politicians sp on sp.id = h.sim_politician_id
    where h.department_key = dept_key
    limit 1;

    if head_id is not null then
      insert into public.city_department_reports (
        department_key, sim_politician_id, title, body, report_kind
      ) values (
        dept_key,
        head_id,
        elem->>'headline',
        elem->>'body',
        'situation'
      );
    end if;
  end loop;

  if p_primary_challenger then
    insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
    values (
      p_city_code,
      'election_signal',
      null,
      'Primary challenger surfaces — mayor''s reelection',
      'City operatives report a named primary challenger is preparing to file if approval stays below 35 before the next cycle.',
      jsonb_build_object('target', 'mayor', 'approval_gate', 35)
    );
  end if;

  if coalesce(trim(p_low_approval_briefing), '') <> '' then
    select sp.id into head_id
    from public.city_department_heads h
    join public.sim_politicians sp on sp.id = h.sim_politician_id
    where h.department_key = 'finance'
    limit 1;

    if head_id is not null then
      insert into public.city_department_reports (
        department_key, sim_politician_id, title, body, report_kind
      ) values (
        'finance',
        head_id,
        'Chief of Staff — reelection risk memo',
        p_low_approval_briefing,
        'briefing'
      );
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public._sync_fiscal_from_engine_metrics(p_city_code char(2), p_metrics jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.city_fiscal_metrics set
    education_quality = public._clamp_city_metric(coalesce((p_metrics->>'education')::numeric, education_quality)),
    public_safety = public._clamp_city_metric(coalesce((p_metrics->>'crime')::numeric, public_safety)),
    economy_index = public._clamp_city_metric(coalesce((p_metrics->>'economy')::numeric, economy_index)),
    housing_affordability = public._clamp_city_metric(coalesce((p_metrics->>'housing')::numeric, housing_affordability)),
    infrastructure_quality = public._clamp_city_metric(coalesce((p_metrics->>'infrastructure')::numeric, infrastructure_quality)),
    environment_score = public._clamp_city_metric(coalesce((p_metrics->>'environment')::numeric, environment_score)),
    updated_at = now()
  where city_code = p_city_code;
end;
$$;

create or replace function public._apply_enacted_city_budget(p_budget_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  line record;
  def numeric;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;

  def := coalesce(
    b.projected_deficit_millions,
    coalesce(b.projected_revenue_millions, public._city_fiscal_revenue_millions('MB'))
      - (select coalesce(sum(amount_millions), 0) from public.city_budget_lines where budget_id = p_budget_id)
  );

  for line in select department_key, amount_millions from public.city_budget_lines where budget_id = p_budget_id loop
    update public.city_fiscal_department_allocations
    set amount_millions = line.amount_millions,
        minimum_required_millions = public._city_dept_minimum_millions(line.department_key)
    where city_code = 'MB' and department_key = line.department_key;
  end loop;

  update public.city_fiscal_metrics set
    treasury_balance = treasury_balance + def,
    fiscal_year = fiscal_year + 1,
    updated_at = now()
  where city_code = 'MB';

  perform public.recompute_mayor_electoral_approval('MB');
end;
$$;

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

  select coalesce(jsonb_agg(jsonb_build_object(
    'department_key', d.department_key,
    'amount_millions', d.amount_millions,
    'minimum_required_millions', d.minimum_required_millions
  ) order by d.department_key), '[]'::jsonb)
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
    'mayor_electoral_approval', coalesce(m.mayor_electoral_approval, m.mayor_approval, 52),
    'updated_at', m.updated_at,
    'departments', depts,
    'recent_effects', effects
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

  if p_sync_fiscal then
    perform public._sync_fiscal_from_engine_metrics(p_city_code, p_engine_state->'metrics');
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

  if p_presentation_events is not null then
    perform public.append_city_presentation_events(
      p_city_code,
      coalesce(p_presentation_meta, '{}'::jsonb),
      coalesce(p_presentation_events->'narratives', '[]'::jsonb),
      p_presentation_events->>'low_approval_briefing',
      coalesce((p_presentation_events->>'primary_challenger')::boolean, false),
      coalesce(p_presentation_events->'department_events', '[]'::jsonb)
    );
  end if;

  return jsonb_build_object('ok', true, 'sim_tick', p_engine_state->>'sim_tick');
end;
$$;

select public.recompute_mayor_electoral_approval('MB');

grant execute on function public.get_city_ward_election_margins(text) to authenticated, service_role;
grant execute on function public.recompute_mayor_electoral_approval(char) to authenticated, service_role;
grant execute on function public.append_city_presentation_events(char, jsonb, jsonb, text, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
