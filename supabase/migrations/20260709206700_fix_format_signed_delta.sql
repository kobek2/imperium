-- PostgreSQL format() does not support %+s — use a signed-delta helper instead.

create or replace function public._format_signed_delta(p_value numeric)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or p_value = 0 then '0'
    when p_value > 0 then '+' || trim(to_char(p_value, 'FM999999990.##'))
    else trim(to_char(p_value, 'FM999999990.##'))
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

  deltas := public._ordinance_sim_effect_deltas(
    p.category, p.issue_key, p.stance_key, p.stance_params
  );
  perform public._apply_city_metric_deltas('MB', deltas);

  effect_summary := trim(both ', ' from concat_ws(', ',
    case when coalesce((deltas->>'public_safety')::int, 0) <> 0
      then format('public safety %s', public._format_signed_delta((deltas->>'public_safety')::numeric)) end,
    case when coalesce((deltas->>'education_quality')::int, 0) <> 0
      then format('education %s', public._format_signed_delta((deltas->>'education_quality')::numeric)) end,
    case when coalesce((deltas->>'housing_affordability')::int, 0) <> 0
      then format('housing %s', public._format_signed_delta((deltas->>'housing_affordability')::numeric)) end,
    case when coalesce((deltas->>'business_climate')::int, 0) <> 0
      then format('business climate %s', public._format_signed_delta((deltas->>'business_climate')::numeric)) end,
    case when coalesce((deltas->>'mayor_approval')::int, 0) <> 0
      then format('mayor approval %s', public._format_signed_delta((deltas->>'mayor_approval')::numeric)) end,
    case when coalesce((deltas->>'economy_index')::int, 0) <> 0
      then format('economy %s', public._format_signed_delta((deltas->>'economy_index')::numeric)) end,
    case when coalesce((deltas->>'property_tax_rate_pct')::numeric, 0) <> 0
      then format(
        'property tax %s%%',
        public._format_signed_delta((deltas->>'property_tax_rate_pct')::numeric)
      ) end
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

  if head.id is not null then
    insert into public.city_department_reports (
      department_key, sim_politician_id, title, body, report_kind
    ) values (
      dept_key,
      head.id,
      format('Implementation memo — %s', p.title),
      briefing_body,
      'briefing'
    );
  end if;

  return jsonb_build_object('ok', true, 'effects', deltas, 'summary', effect_summary);
end;
$$;

-- Budget enactment uses the same invalid %+s pattern.
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
      then format('public safety %s', public._format_signed_delta((deltas->>'public_safety')::numeric)) end,
    case when coalesce((deltas->>'education_quality')::int, 0) <> 0
      then format('education %s', public._format_signed_delta((deltas->>'education_quality')::numeric)) end,
    case when coalesce((deltas->>'housing_affordability')::int, 0) <> 0
      then format('housing %s', public._format_signed_delta((deltas->>'housing_affordability')::numeric)) end,
    case when coalesce((deltas->>'business_climate')::int, 0) <> 0
      then format('business climate %s', public._format_signed_delta((deltas->>'business_climate')::numeric)) end,
    case when coalesce((deltas->>'mayor_approval')::int, 0) <> 0
      then format('mayor approval %s', public._format_signed_delta((deltas->>'mayor_approval')::numeric)) end,
    case when coalesce((deltas->>'economy_index')::int, 0) <> 0
      then format('economy %s', public._format_signed_delta((deltas->>'economy_index')::numeric)) end
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

grant execute on function public._format_signed_delta(numeric) to authenticated;

notify pgrst, 'reload schema';
