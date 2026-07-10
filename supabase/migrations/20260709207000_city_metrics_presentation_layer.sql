-- Presentation layer: approval history, narrative events, cooperation bonus (no engine graph changes).

drop function if exists public.save_city_metrics_snapshot(char, jsonb, jsonb, boolean);

alter table public.city_metric_history
  add column if not exists approval_rating smallint check (approval_rating between 0 and 100);

alter table public.city_sim_engine_state
  add column if not exists presentation_meta jsonb not null default '{}'::jsonb;

create or replace function public._city_approval_rating_from_metrics(p_metrics jsonb)
returns smallint
language sql
immutable
as $$
  select public._clamp_city_metric(round(
    coalesce((p_metrics->>'public_trust')::numeric, 50) * 0.28 +
    coalesce((p_metrics->>'economy')::numeric, 50) * 0.18 +
    coalesce((p_metrics->>'crime')::numeric, 50) * 0.18 +
    coalesce((p_metrics->>'education')::numeric, 50) * 0.10 +
    coalesce((p_metrics->>'housing')::numeric, 50) * 0.08 +
    coalesce((p_metrics->>'public_health')::numeric, 50) * 0.08 +
    coalesce((p_metrics->>'infrastructure')::numeric, 50) * 0.06 +
    coalesce((p_metrics->>'environment')::numeric, 50) * 0.04
  ))::smallint;
$$;

create or replace function public._city_approval_cooperation_bonus(p_city_code char(2) default 'MB')
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r >= 70 then -12
    when r >= 58 then -8
    when r >= 50 then -4
    when r >= 35 then 0
    when r >= 25 then 8
    else 14
  end
  from (
    select coalesce(
      (
        select h.approval_rating
        from public.city_metric_history h
        where h.city_code = p_city_code
        order by h.sim_tick desc
        limit 1
      ),
      public._city_approval_rating_from_metrics(
        (select metrics from public.city_sim_engine_state where city_code = p_city_code)
      ),
      50
    ) as r
  ) s;
$$;

create or replace function public._npc_ideology_vote(
  p_sim_politician_id uuid,
  p_issue_economic smallint,
  p_issue_social smallint,
  p_stance_key text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sp record;
  dist numeric;
  party_adj numeric := 0;
  cooperation numeric := 0;
  stance text := lower(trim(coalesce(p_stance_key, '')));
begin
  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.id is null then return 'nay'; end if;

  if stance = 'moderate' then
    if sp.party = 'democrat' then return 'yea'; end if;
    if sp.ideology_pragmatism >= 62 then return 'yea'; end if;
    return 'nay';
  end if;

  if stance = 'conservative' and p_issue_economic >= 20 and sp.party = 'republican' then
    return 'yea';
  end if;

  if stance = 'progressive' and p_issue_economic <= -15 and sp.party = 'democrat' then
    return 'yea';
  end if;

  dist := abs(sp.ideology_economic - p_issue_economic) + abs(sp.ideology_social - p_issue_social);

  if sp.party = 'democrat' and p_issue_economic < 0 then party_adj := -15;
  elsif sp.party = 'republican' and p_issue_economic > 0 then party_adj := -15;
  end if;

  cooperation := public._city_approval_cooperation_bonus('MB');
  if sp.party = 'democrat' then party_adj := party_adj + cooperation;
  elsif sp.party = 'republican' and cooperation < 0 then party_adj := party_adj - round(cooperation * 0.35);
  elsif sp.party = 'republican' and cooperation > 0 then party_adj := party_adj + round(cooperation * 0.25);
  end if;

  dist := greatest(dist + party_adj, 0);

  if dist <= 50 then return 'yea'; end if;
  if dist <= 80 and sp.ideology_pragmatism >= 55 then return 'yea'; end if;
  if dist <= 65 and sp.ideology_pragmatism >= 72 then return 'yea'; end if;
  return 'nay';
end;
$$;

create or replace function public.append_city_presentation_events(
  p_city_code char(2),
  p_presentation_meta jsonb,
  p_narratives jsonb default '[]'::jsonb,
  p_low_approval_briefing text default null,
  p_primary_challenger boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  elem jsonb;
  head_id uuid;
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
        'approval_rating', coalesce(
          h.approval_rating,
          public._city_approval_rating_from_metrics(h.metrics)
        ),
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
      'presentation_meta', eng.presentation_meta
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
    city_code, sim_tick, seed, variables, metrics, effect_queue, pressure_log, shock_cooldowns, recent_shocks, presentation_meta, updated_at
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
    mayor_approval = coalesce(
      (
        select h.approval_rating from public.city_metric_history h
        where h.city_code = p_city_code
        order by h.sim_tick desc
        limit 1
      ),
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

grant execute on function public._city_approval_rating_from_metrics(jsonb) to authenticated;
grant execute on function public._city_approval_cooperation_bonus(char) to authenticated;
grant execute on function public.append_city_presentation_events(char, jsonb, jsonb, text, boolean) to authenticated;
grant execute on function public.save_city_metrics_snapshot(char, jsonb, jsonb, boolean, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
