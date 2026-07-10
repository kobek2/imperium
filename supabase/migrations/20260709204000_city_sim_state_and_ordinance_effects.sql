-- City simulation state: ordinance/budget consequences, effect log, auto briefings.

alter table public.city_fiscal_metrics
  add column if not exists public_safety smallint not null default 50 check (public_safety between 0 and 100),
  add column if not exists education_quality smallint not null default 50 check (education_quality between 0 and 100),
  add column if not exists housing_affordability smallint not null default 45 check (housing_affordability between 0 and 100),
  add column if not exists business_climate smallint not null default 50 check (business_climate between 0 and 100),
  add column if not exists mayor_approval smallint not null default 52 check (mayor_approval between 0 and 100);

update public.city_fiscal_metrics set
  public_safety = 48,
  education_quality = 46,
  housing_affordability = 42,
  business_climate = 51,
  mayor_approval = 54,
  economy_index = 100
where city_code = 'MB';

create table if not exists public.city_sim_effect_events (
  id uuid primary key default gen_random_uuid(),
  city_code char(2) not null default 'MB' references public.cities (code) on delete cascade,
  source_type text not null check (source_type in ('ordinance', 'budget')),
  source_id uuid,
  title text not null,
  summary text not null default '',
  effects jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists city_sim_effect_events_city_created_idx
  on public.city_sim_effect_events (city_code, created_at desc);

alter table public.city_sim_effect_events enable row level security;
drop policy if exists "city_sim_effect_events read" on public.city_sim_effect_events;
create policy "city_sim_effect_events read" on public.city_sim_effect_events
  for select to authenticated using (true);

create or replace function public._clamp_city_metric(p_value numeric)
returns smallint
language sql
immutable
as $$
  select greatest(0, least(100, round(p_value)::smallint));
$$;

create or replace function public._ordinance_sim_effect_deltas(
  p_category text,
  p_issue_key text,
  p_stance_key text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  d jsonb := jsonb_build_object(
    'public_safety', 0,
    'education_quality', 0,
    'housing_affordability', 0,
    'business_climate', 0,
    'mayor_approval', 0,
    'economy_index', 0,
    'property_tax_rate_pct', 0
  );
begin
  if cat = 'taxes' and issue = 'property_tax_rate' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'property_tax_rate_pct', -0.15,
        'housing_affordability', 6,
        'mayor_approval', 5,
        'economy_index', 2,
        'business_climate', -2
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'property_tax_rate_pct', 0.12,
        'housing_affordability', -4,
        'mayor_approval', -3,
        'economy_index', 1,
        'business_climate', 3
      );
    end if;
  elsif cat = 'crime' and issue = 'policing_community_programs' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'public_safety', -3,
        'mayor_approval', 6,
        'housing_affordability', 2,
        'education_quality', 2
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object('public_safety', 2, 'mayor_approval', 1);
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'public_safety', 7,
        'mayor_approval', -2,
        'business_climate', 2,
        'housing_affordability', -1
      );
    end if;
  elsif cat = 'economy' and issue = 'small_business_permits' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'business_climate', 5,
        'mayor_approval', 3,
        'economy_index', 2
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'business_climate', -4,
        'mayor_approval', 2,
        'housing_affordability', 1
      );
    end if;
  elsif cat = 'economy' and issue = 'minimum_wage' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'business_climate', -7,
        'housing_affordability', 5,
        'mayor_approval', 4,
        'economy_index', -3
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object(
        'business_climate', -2,
        'housing_affordability', 3,
        'mayor_approval', 2,
        'economy_index', -1
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'business_climate', 3,
        'housing_affordability', -2,
        'mayor_approval', -2
      );
    end if;
  elsif cat = 'education' and issue = 'school_funding' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'education_quality', 9,
        'mayor_approval', 5,
        'economy_index', -2,
        'business_climate', -1
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object('education_quality', 2, 'mayor_approval', 1);
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'education_quality', -2,
        'mayor_approval', -1,
        'business_climate', 2
      );
    end if;
  else
    if stance = 'progressive' then
      d := d || jsonb_build_object('mayor_approval', 3, 'economy_index', -1);
    elsif stance = 'conservative' then
      d := d || jsonb_build_object('mayor_approval', -2, 'business_climate', 2);
    end if;
  end if;

  return d;
end;
$$;

create or replace function public._ordinance_effect_department_key(p_category text, p_issue_key text)
returns text
language plpgsql
immutable
as $$
declare
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
begin
  if cat = 'taxes' then return 'finance'; end if;
  if cat = 'crime' then return 'police'; end if;
  if cat = 'education' then return 'parks'; end if;
  if issue = 'minimum_wage' then return 'finance'; end if;
  return 'planning';
end;
$$;

create or replace function public._apply_city_metric_deltas(p_city_code char(2), p_deltas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  tax_delta numeric := coalesce((p_deltas->>'property_tax_rate_pct')::numeric, 0);
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code for update;
  if m.city_code is null then raise exception 'City metrics not found'; end if;

  update public.city_fiscal_metrics set
    public_safety = public._clamp_city_metric(
      m.public_safety + coalesce((p_deltas->>'public_safety')::numeric, 0)),
    education_quality = public._clamp_city_metric(
      m.education_quality + coalesce((p_deltas->>'education_quality')::numeric, 0)),
    housing_affordability = public._clamp_city_metric(
      m.housing_affordability + coalesce((p_deltas->>'housing_affordability')::numeric, 0)),
    business_climate = public._clamp_city_metric(
      m.business_climate + coalesce((p_deltas->>'business_climate')::numeric, 0)),
    mayor_approval = public._clamp_city_metric(
      m.mayor_approval + coalesce((p_deltas->>'mayor_approval')::numeric, 0)),
    economy_index = public._clamp_city_metric(
      m.economy_index + coalesce((p_deltas->>'economy_index')::numeric, 0)),
    property_tax_rate_pct = greatest(0, m.property_tax_rate_pct + tax_delta),
    updated_at = now()
  where city_code = p_city_code;

  return p_deltas;
end;
$$;

create or replace function public._apply_ordinance_effects(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  deltas jsonb;
  dept_key text;
  head record;
  briefing_body text;
  effect_summary text;
begin
  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance not found'; end if;

  deltas := public._ordinance_sim_effect_deltas(p.category, p.issue_key, p.stance_key);
  perform public._apply_city_metric_deltas('MB', deltas);

  effect_summary := trim(both ', ' from concat_ws(', ',
    case when coalesce((deltas->>'public_safety')::int, 0) <> 0
      then format('public safety %+s', deltas->>'public_safety') end,
    case when coalesce((deltas->>'education_quality')::int, 0) <> 0
      then format('education %+s', deltas->>'education_quality') end,
    case when coalesce((deltas->>'housing_affordability')::int, 0) <> 0
      then format('housing %+s', deltas->>'housing_affordability') end,
    case when coalesce((deltas->>'business_climate')::int, 0) <> 0
      then format('business climate %+s', deltas->>'business_climate') end,
    case when coalesce((deltas->>'mayor_approval')::int, 0) <> 0
      then format('mayor approval %+s', deltas->>'mayor_approval') end,
    case when coalesce((deltas->>'economy_index')::int, 0) <> 0
      then format('economy %+s', deltas->>'economy_index') end,
    case when coalesce((deltas->>'property_tax_rate_pct')::numeric, 0) <> 0
      then format('property tax %+s%%', deltas->>'property_tax_rate_pct') end
  ));

  insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
  values (
    'MB', 'ordinance', p.id, p.title,
    coalesce(nullif(effect_summary, ''), 'Policy enacted with minimal immediate metric shift.'),
    deltas
  );

  dept_key := public._ordinance_effect_department_key(p.category, p.issue_key);
  select sp.id, sp.character_name into head
  from public.city_department_heads h
  join public.sim_politicians sp on sp.id = h.sim_politician_id
  where h.department_key = dept_key;

  briefing_body := format(
    '%s reports that Local Law "%s" is now in effect. Implementation begins immediately across relevant agency lines.',
    coalesce(head.character_name, 'The department head'),
    p.title
  );
  if effect_summary <> '' then
    briefing_body := briefing_body || E'\n\nModeled city impacts: ' || effect_summary || '.';
  end if;
  briefing_body := briefing_body || E'\n\n' || coalesce(nullif(p.summary, ''), 'See council filing for full policy text.');

  insert into public.city_department_reports (
    department_key, sim_politician_id, title, body, report_kind
  ) values (
    dept_key,
    head.id,
    format('Implementation memo — %s', p.title),
    briefing_body,
    'briefing'
  );

  return jsonb_build_object('ok', true, 'effects', deltas, 'summary', effect_summary);
end;
$$;

create or replace function public.mayor_sign_ordinance(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  applied jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may sign ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'awaiting_mayor' then raise exception 'Ordinance is not awaiting mayor signature'; end if;

  applied := public._apply_ordinance_effects(p_ordinance_id);

  update public.city_ordinance_proposals
  set status = 'enacted', enacted_at = now()
  where id = p_ordinance_id;

  return jsonb_build_object(
    'ok', true, 'status', 'enacted', 'ordinance_id', p_ordinance_id,
    'effects', applied->'effects', 'summary', applied->'summary'
  );
end;
$$;

create or replace function public.preview_ordinance_effects(
  p_category text,
  p_issue_key text,
  p_stance_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return public._ordinance_sim_effect_deltas(p_category, p_issue_key, p_stance_key);
end;
$$;

create or replace function public._apply_budget_sim_effects(p_budget_id uuid, p_deficit_millions numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  line record;
  baseline numeric;
  amount numeric;
  ratio numeric;
  deltas jsonb := jsonb_build_object(
    'public_safety', 0,
    'education_quality', 0,
    'housing_affordability', 0,
    'business_climate', 0,
    'mayor_approval', 0,
    'economy_index', 0,
    'property_tax_rate_pct', 0
  );
  dept_baselines jsonb := jsonb_build_object(
    'finance', 1200, 'police', 5800, 'public_works', 2500, 'parks', 700, 'planning', 150
  );
  effect_summary text;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then return deltas; end if;

  for line in select department_key, amount_millions from public.city_budget_lines where budget_id = p_budget_id loop
    baseline := coalesce((dept_baselines->>line.department_key)::numeric, 0);
    if baseline <= 0 then continue; end if;
    amount := coalesce(line.amount_millions, 0);
    ratio := amount / baseline;

    if line.department_key = 'police' then
      deltas := jsonb_set(deltas, '{public_safety}',
        to_jsonb(round(((ratio - 1) * 14)::numeric, 0)::int));
    elsif line.department_key = 'public_works' then
      deltas := jsonb_set(deltas, '{housing_affordability}',
        to_jsonb(round(((ratio - 1) * 8)::numeric, 0)::int));
      deltas := jsonb_set(deltas, '{business_climate}',
        to_jsonb(coalesce((deltas->>'business_climate')::int, 0) + round(((ratio - 1) * 4)::numeric, 0)::int));
    elsif line.department_key = 'parks' then
      deltas := jsonb_set(deltas, '{education_quality}',
        to_jsonb(round(((ratio - 1) * 6)::numeric, 0)::int));
      deltas := jsonb_set(deltas, '{mayor_approval}',
        to_jsonb(coalesce((deltas->>'mayor_approval')::int, 0) + round(((ratio - 1) * 3)::numeric, 0)::int));
    elsif line.department_key = 'planning' then
      deltas := jsonb_set(deltas, '{business_climate}',
        to_jsonb(coalesce((deltas->>'business_climate')::int, 0) + round(((ratio - 1) * 10)::numeric, 0)::int));
    elsif line.department_key = 'finance' then
      deltas := jsonb_set(deltas, '{mayor_approval}',
        to_jsonb(coalesce((deltas->>'mayor_approval')::int, 0) + round(((ratio - 1) * 2)::numeric, 0)::int));
    end if;
  end loop;

  if p_deficit_millions < -500 then
    deltas := deltas || jsonb_build_object(
      'economy_index', coalesce((deltas->>'economy_index')::int, 0) - 4,
      'mayor_approval', coalesce((deltas->>'mayor_approval')::int, 0) - 5,
      'business_climate', coalesce((deltas->>'business_climate')::int, 0) - 3
    );
  elsif p_deficit_millions > 150 then
    deltas := deltas || jsonb_build_object(
      'economy_index', coalesce((deltas->>'economy_index')::int, 0) + 2,
      'mayor_approval', coalesce((deltas->>'mayor_approval')::int, 0) + 2
    );
  end if;

  perform public._apply_city_metric_deltas('MB', deltas);

  effect_summary := trim(both ', ' from concat_ws(', ',
    case when coalesce((deltas->>'public_safety')::int, 0) <> 0
      then format('public safety %+s', deltas->>'public_safety') end,
    case when coalesce((deltas->>'education_quality')::int, 0) <> 0
      then format('education %+s', deltas->>'education_quality') end,
    case when coalesce((deltas->>'housing_affordability')::int, 0) <> 0
      then format('housing %+s', deltas->>'housing_affordability') end,
    case when coalesce((deltas->>'business_climate')::int, 0) <> 0
      then format('business climate %+s', deltas->>'business_climate') end,
    case when coalesce((deltas->>'mayor_approval')::int, 0) <> 0
      then format('mayor approval %+s', deltas->>'mayor_approval') end,
    case when coalesce((deltas->>'economy_index')::int, 0) <> 0
      then format('economy %+s', deltas->>'economy_index') end
  ));

  insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
  values (
    'MB', 'budget', p_budget_id,
    format('FY%s city budget enacted', b.fiscal_year),
    coalesce(nullif(effect_summary, ''), format('Treasury adjusted by %sM annual balance.', round(p_deficit_millions::numeric, 0))),
    deltas || jsonb_build_object('deficit_millions', p_deficit_millions)
  );

  insert into public.city_department_reports (
    department_key, sim_politician_id, title, body, report_kind
  )
  select
    'finance',
    sp.id,
    format('FY%s budget execution order', b.fiscal_year),
    format(
      '%s confirms FY%s appropriations are live. Treasury movement: %sM annual balance. %s',
      sp.character_name,
      b.fiscal_year,
      round(p_deficit_millions::numeric, 0),
      coalesce(nullif(effect_summary, ''), 'Agency allotments updated per council-enacted lines.')
    ),
    'briefing'
  from public.city_department_heads h
  join public.sim_politicians sp on sp.id = h.sim_politician_id
  where h.department_key = 'finance';

  return deltas || jsonb_build_object('summary', effect_summary);
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
    set amount_millions = line.amount_millions
    where city_code = 'MB' and department_key = line.department_key;
  end loop;

  update public.city_fiscal_metrics set
    treasury_balance = treasury_balance + def,
    fiscal_year = fiscal_year + 1,
    updated_at = now()
  where city_code = 'MB';

  perform public._apply_budget_sim_effects(p_budget_id, def);
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
  events jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then raise exception 'City fiscal metrics not found for %', p_city_code; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('department_key', d.department_key, 'amount_millions', d.amount_millions)
      order by d.department_key
    ),
    '[]'::jsonb
  ) into depts
  from public.city_fiscal_department_allocations d
  where d.city_code = p_city_code;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'source_type', e.source_type,
        'source_id', e.source_id,
        'title', e.title,
        'summary', e.summary,
        'effects', e.effects,
        'created_at', e.created_at
      )
      order by e.created_at desc
    ),
    '[]'::jsonb
  ) into events
  from (
    select * from public.city_sim_effect_events
    where city_code = p_city_code
    order by created_at desc
    limit 8
  ) e;

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
    'intergovernmental_aid_millions', m.intergovernmental_aid_millions,
    'treasury_balance', m.treasury_balance,
    'fiscal_year', m.fiscal_year,
    'public_safety', m.public_safety,
    'education_quality', m.education_quality,
    'housing_affordability', m.housing_affordability,
    'business_climate', m.business_climate,
    'mayor_approval', m.mayor_approval,
    'updated_at', m.updated_at,
    'departments', depts,
    'recent_effects', events
  );
end;
$$;

create or replace function public.mayor_sign_budget(p_budget_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  def numeric;
  effect_summary text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = auth.uid() and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(auth.uid()) then
    raise exception 'Only the mayor may sign the city budget';
  end if;

  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'awaiting_mayor' then raise exception 'Budget is not awaiting mayor signature'; end if;

  def := coalesce(b.projected_deficit_millions, 0);

  update public.city_budgets set status = 'enacted', enacted_at = now() where id = p_budget_id;
  perform public._apply_enacted_city_budget(p_budget_id);

  select e.summary into effect_summary
  from public.city_sim_effect_events e
  where e.source_type = 'budget' and e.source_id = p_budget_id
  order by e.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true, 'status', 'enacted', 'budget_id', p_budget_id,
    'deficit_millions', def,
    'summary', coalesce(effect_summary, 'Budget enacted.')
  );
end;
$$;

grant execute on function public.preview_ordinance_effects(text, text, text) to authenticated;
grant execute on function public._ordinance_sim_effect_deltas(text, text, text) to authenticated;

notify pgrst, 'reload schema';
