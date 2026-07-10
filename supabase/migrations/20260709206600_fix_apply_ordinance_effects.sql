-- Fix ordinance enactment: use city_department_reports (not missing city_briefings).

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

notify pgrst, 'reload schema';
