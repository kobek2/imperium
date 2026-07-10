-- City metrics engine: policy variables, delayed propagation, metric history.

create table if not exists public.city_sim_engine_state (
  city_code char(2) primary key references public.cities (code) on delete cascade,
  sim_tick bigint not null default 0 check (sim_tick >= 0),
  seed bigint not null default 2864434397,
  variables jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  effect_queue jsonb not null default '[]'::jsonb,
  pressure_log jsonb not null default '{}'::jsonb,
  shock_cooldowns jsonb not null default '{}'::jsonb,
  recent_shocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.city_metric_history (
  id bigint generated always as identity primary key,
  city_code char(2) not null references public.cities (code) on delete cascade,
  sim_tick bigint not null check (sim_tick >= 0),
  metrics jsonb not null,
  recorded_at timestamptz not null default now()
);

create unique index if not exists city_metric_history_city_tick_uidx
  on public.city_metric_history (city_code, sim_tick);

alter table public.city_sim_engine_state enable row level security;
alter table public.city_metric_history enable row level security;

drop policy if exists "city_sim_engine_state read" on public.city_sim_engine_state;
create policy "city_sim_engine_state read" on public.city_sim_engine_state
  for select to authenticated using (true);

drop policy if exists "city_metric_history read" on public.city_metric_history;
create policy "city_metric_history read" on public.city_metric_history
  for select to authenticated using (true);

-- Extended fiscal columns for new engine metrics (optional sync targets).
alter table public.city_fiscal_metrics
  add column if not exists public_health smallint not null default 50 check (public_health between 0 and 100),
  add column if not exists infrastructure_quality smallint not null default 47 check (infrastructure_quality between 0 and 100),
  add column if not exists environment_score smallint not null default 49 check (environment_score between 0 and 100),
  add column if not exists sim_tick bigint not null default 0 check (sim_tick >= 0);

insert into public.city_sim_engine_state (city_code, sim_tick, seed, variables, metrics)
select
  m.city_code,
  0,
  2864434397,
  jsonb_build_object(
    'school_funding', 50,
    'police_funding', 52,
    'health_clinic_funding', 48,
    'housing_subsidy', 45,
    'infrastructure_capital', 50,
    'environmental_enforcement', 47,
    'business_regulation', 50,
    'community_programs', 48,
    'tax_burden', 50
  ),
  jsonb_build_object(
    'education', coalesce(m.education_quality, 46),
    'crime', coalesce(m.public_safety, 48),
    'economy', coalesce(m.economy_index, 51),
    'public_health', coalesce(m.public_health, 50),
    'housing', coalesce(m.housing_affordability, 42),
    'public_trust', coalesce(m.mayor_approval, 54),
    'infrastructure', coalesce(m.infrastructure_quality, 47),
    'environment', coalesce(m.environment_score, 49)
  )
from public.city_fiscal_metrics m
where m.city_code = 'MB'
on conflict (city_code) do nothing;

insert into public.city_metric_history (city_code, sim_tick, metrics)
select
  e.city_code,
  0,
  e.metrics
from public.city_sim_engine_state e
where e.city_code = 'MB'
  and not exists (
    select 1 from public.city_metric_history h
    where h.city_code = e.city_code and h.sim_tick = 0
  );

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
    public_health = public._clamp_city_metric(coalesce((p_metrics->>'public_health')::numeric, public_health)),
    housing_affordability = public._clamp_city_metric(coalesce((p_metrics->>'housing')::numeric, housing_affordability)),
    mayor_approval = public._clamp_city_metric(coalesce((p_metrics->>'public_trust')::numeric, mayor_approval)),
    infrastructure_quality = public._clamp_city_metric(coalesce((p_metrics->>'infrastructure')::numeric, infrastructure_quality)),
    environment_score = public._clamp_city_metric(coalesce((p_metrics->>'environment')::numeric, environment_score)),
    updated_at = now()
  where city_code = p_city_code;
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
      'recent_shocks', eng.recent_shocks
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
  p_sync_fiscal boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  row jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  insert into public.city_sim_engine_state (
    city_code, sim_tick, seed, variables, metrics, effect_queue, pressure_log, shock_cooldowns, recent_shocks, updated_at
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
    updated_at = now();

  if jsonb_array_length(coalesce(p_history_append, '[]'::jsonb)) > 0 then
    insert into public.city_metric_history (city_code, sim_tick, metrics, recorded_at)
    select
      p_city_code,
      (elem->>'sim_tick')::bigint,
      elem->'metrics',
      coalesce((elem->>'recorded_at')::timestamptz, now())
    from jsonb_array_elements(p_history_append) elem
    on conflict (city_code, sim_tick) do update set
      metrics = excluded.metrics,
      recorded_at = excluded.recorded_at;
  end if;

  update public.city_fiscal_metrics set
    sim_tick = coalesce((p_engine_state->>'sim_tick')::bigint, sim_tick)
  where city_code = p_city_code;

  if p_sync_fiscal then
    perform public._sync_fiscal_from_engine_metrics(p_city_code, p_engine_state->'metrics');
  end if;

  return jsonb_build_object('ok', true, 'sim_tick', p_engine_state->>'sim_tick');
end;
$$;

-- Stop applying instant metric deltas from ordinances/budgets; engine handles propagation.
create or replace function public._apply_city_metric_deltas(p_city_code char(2), p_deltas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tax_delta numeric := coalesce((p_deltas->>'property_tax_rate_pct')::numeric, 0);
begin
  if tax_delta <> 0 then
    update public.city_fiscal_metrics set
      property_tax_rate_pct = greatest(0, property_tax_rate_pct + tax_delta),
      updated_at = now()
    where city_code = p_city_code;
  end if;
  return p_deltas;
end;
$$;

grant execute on function public.get_city_metrics_snapshot(char) to authenticated;
grant execute on function public.save_city_metrics_snapshot(char, jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
