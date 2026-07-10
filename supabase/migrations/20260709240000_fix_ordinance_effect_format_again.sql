-- Re-apply signed-delta formatting in _apply_ordinance_effects (regressed in expansion ordinances migration).

create or replace function public._apply_ordinance_effects(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  deltas jsonb;
  fiscal jsonb;
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

  if lower(trim(p.issue_key)) = 'marijuana_legalization' and p.stance_params is not null then
    fiscal := public._apply_marijuana_fiscal_settings(p.stance_params, 'MB');
  elsif lower(trim(p.issue_key)) = 'sales_tax_rate' and p.stance_params is not null then
    fiscal := public._apply_local_sales_tax_fiscal_settings(p.stance_params, 'MB');
  end if;

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
      ) end,
    case when coalesce((fiscal->>'cannabis_sales_tax_revenue_millions')::numeric, 0) > 0
      then format('cannabis tax revenue $%sM/yr', round((fiscal->>'cannabis_sales_tax_revenue_millions')::numeric, 1)) end,
    case when coalesce((fiscal->>'local_sales_tax_revenue_millions')::numeric, 0) > 0
      then format('local sales tax revenue $%sM/yr', round((fiscal->>'local_sales_tax_revenue_millions')::numeric, 1)) end
  ));

  insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
  values (
    'MB', 'ordinance', p.id, p.title,
    coalesce(nullif(effect_summary, ''), 'Policy enacted with minimal immediate metric shift.'),
    coalesce(deltas, '{}'::jsonb) || coalesce(fiscal, '{}'::jsonb)
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

  return jsonb_build_object('ok', true, 'effects', deltas, 'fiscal', fiscal, 'summary', effect_summary);
end;
$$;

notify pgrst, 'reload schema';
