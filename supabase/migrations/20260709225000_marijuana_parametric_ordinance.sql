-- Marijuana legalization: multi-parameter ordinance + cannabis sales tax fiscal hook.

alter table public.city_fiscal_metrics
  add column if not exists cannabis_sales_tax_rate_pct numeric not null default 0,
  add column if not exists cannabis_sales_tax_revenue_millions numeric not null default 0;

alter table public.city_ordinance_proposals
  drop constraint if exists city_ordinance_proposals_stance_check;

alter table public.city_ordinance_proposals
  add constraint city_ordinance_proposals_stance_check check (
    (
      lower(trim(issue_key)) in ('property_tax_rate', 'marijuana_legalization')
      and (
        (
          stance_params is not null
          and (
            (
              lower(trim(issue_key)) = 'property_tax_rate'
              and (stance_params ? 'rate_delta')
              and (stance_params ? 'earmark_services_pct')
            )
            or (
              lower(trim(issue_key)) = 'marijuana_legalization'
              and (stance_params ? 'legal_status')
              and (stance_params ? 'commercial_sale_allowed')
              and (stance_params ? 'sales_tax_rate')
              and (stance_params ? 'expungement')
            )
          )
        )
        or stance_key in ('progressive', 'moderate', 'conservative')
      )
    )
    or (
      lower(trim(issue_key)) not in ('property_tax_rate', 'marijuana_legalization')
      and stance_key in ('progressive', 'moderate', 'conservative')
    )
  );

create or replace function public._marijuana_status_step_index(p_status text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_status, '')))
    when 'illegal' then 0
    when 'decriminalized' then 1
    when 'medical' then 2
    when 'recreational' then 3
    else 0
  end;
$$;

create or replace function public._clamp_marijuana_sales_tax_rate(p_value numeric)
returns numeric
language sql
immutable
as $$
  select greatest(0::numeric, least(40::numeric, coalesce(p_value, 0)));
$$;

create or replace function public._clamp_marijuana_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  status text := lower(trim(coalesce(p_params->>'legal_status', 'illegal')));
  step int;
  commercial boolean := coalesce((p_params->>'commercial_sale_allowed')::boolean, false);
  tax_rate numeric := public._clamp_marijuana_sales_tax_rate((p_params->>'sales_tax_rate')::numeric);
  expungement boolean := coalesce((p_params->>'expungement')::boolean, false);
begin
  if status not in ('illegal', 'decriminalized', 'medical', 'recreational') then
    status := 'illegal';
  end if;
  step := public._marijuana_status_step_index(status);
  if step < 2 then
    commercial := false;
    tax_rate := 0;
  elsif not commercial then
    tax_rate := 0;
  end if;

  return jsonb_build_object(
    'legal_status', status,
    'commercial_sale_allowed', commercial,
    'sales_tax_rate', tax_rate,
    'expungement', expungement
  );
end;
$$;

create or replace function public._escalating_step_score(
  p_step int,
  p_max_step int,
  p_max_score int,
  p_sign int
)
returns smallint
language plpgsql
immutable
as $$
declare
  norm numeric;
begin
  if coalesce(p_step, 0) <= 0 or coalesce(p_max_step, 0) <= 0 then
    return 0;
  end if;
  norm := power(p_step::numeric / p_max_step::numeric, 1.7);
  return (round(norm * p_max_score)::int * p_sign)::smallint;
end;
$$;

create or replace function public._score_marijuana_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_marijuana_stance_params(p_stance_params);
  step int := public._marijuana_status_step_index(p->>'legal_status');
  econ smallint;
  soc smallint;
  tax_norm numeric;
begin
  econ := public._escalating_step_score(step, 3, 72, -1);
  soc := public._escalating_step_score(step, 3, 78, 1);

  if step >= 2 and coalesce((p->>'commercial_sale_allowed')::boolean, false) then
    econ := econ + 22;
    soc := soc - 6;
    if (p->>'sales_tax_rate')::numeric > 0 then
      tax_norm := power((p->>'sales_tax_rate')::numeric / 40.0, 1.7);
      econ := econ + round(tax_norm * 38)::smallint;
      soc := soc + round(tax_norm * -12)::smallint;
    end if;
  end if;

  if coalesce((p->>'expungement')::boolean, false) then
    soc := soc + 28;
    econ := econ - 10;
  end if;

  issue_economic := greatest(-99, least(99, econ))::smallint;
  issue_social := greatest(-99, least(99, soc))::smallint;
  return next;
end;
$$;

create or replace function public._marijuana_market_usd(p_city_code char(2))
returns numeric
language plpgsql
stable
as $$
declare
  m record;
  market_usd numeric;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then return 80000000; end if;

  market_usd := coalesce(m.office_salary_pool_millions, 0) * 1000000.0 * 0.2;
  if market_usd <= 0 then
    market_usd := greatest(coalesce(m.population, 0), 1)
      * greatest(coalesce(m.avg_household_income, 0), 1) * 0.3;
  end if;
  if market_usd <= 0 then
    market_usd := 80000000;
  end if;
  return market_usd;
end;
$$;

create or replace function public._marijuana_sales_tax_revenue_millions(
  p_stance_params jsonb,
  p_city_code char(2) default 'MB'
)
returns numeric
language plpgsql
stable
as $$
declare
  p jsonb := public._clamp_marijuana_stance_params(p_stance_params);
  step int := public._marijuana_status_step_index(p->>'legal_status');
  market_usd numeric;
  status_scale numeric;
  rate numeric := (p->>'sales_tax_rate')::numeric;
begin
  if step < 2
    or not coalesce((p->>'commercial_sale_allowed')::boolean, false)
    or rate <= 0 then
    return 0;
  end if;

  market_usd := public._marijuana_market_usd(p_city_code);
  status_scale := case when p->>'legal_status' = 'recreational' then 1.0 else 0.45 end;
  return (market_usd / 1000000.0) * status_scale * (rate / 100.0);
end;
$$;

create or replace function public._apply_marijuana_fiscal_settings(
  p_stance_params jsonb,
  p_city_code char(2) default 'MB'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb := public._clamp_marijuana_stance_params(p_stance_params);
  rate numeric := (p->>'sales_tax_rate')::numeric;
  revenue numeric := public._marijuana_sales_tax_revenue_millions(p, p_city_code);
begin
  update public.city_fiscal_metrics
  set
    cannabis_sales_tax_rate_pct = rate,
    cannabis_sales_tax_revenue_millions = revenue,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'cannabis_sales_tax_rate_pct', rate,
    'cannabis_sales_tax_revenue_millions', revenue
  );
end;
$$;

-- Extend scoring router (property tax branch unchanged).
create or replace function public._ordinance_issue_scores(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_stance_params jsonb default null,
  out issue_economic smallint,
  out issue_social smallint
)
language plpgsql
immutable
as $$
declare
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  pt_scores record;
  mj_scores record;
begin
  issue_economic := 0;
  issue_social := 0;

  if cat = 'taxes' and issue = 'property_tax_rate' and p_stance_params is not null then
    select * into pt_scores from public._score_property_tax_ordinance(p_stance_params);
    issue_economic := pt_scores.issue_economic;
    issue_social := pt_scores.issue_social;
    return;
  end if;

  if cat = 'crime' and issue = 'marijuana_legalization' and p_stance_params is not null then
    select * into mj_scores from public._score_marijuana_ordinance(p_stance_params);
    issue_economic := mj_scores.issue_economic;
    issue_social := mj_scores.issue_social;
    return;
  end if;

  if cat = 'taxes' and issue = 'property_tax_rate' then
    issue_economic := case stance when 'progressive' then -72 when 'conservative' then 45 else 0 end;
    issue_social := case stance when 'progressive' then -42 when 'conservative' then 15 else 0 end;
  elsif cat = 'crime' and issue = 'policing_community_programs' then
    issue_economic := case stance when 'progressive' then -25 when 'conservative' then 30 else 0 end;
    issue_social := case stance when 'progressive' then -65 when 'conservative' then 55 else 0 end;
  elsif cat = 'economy' and issue = 'small_business_permits' then
    issue_economic := case stance when 'progressive' then -35 when 'conservative' then 50 else 0 end;
    issue_social := case stance when 'progressive' then 0 when 'conservative' then 25 else 0 end;
  elsif cat = 'economy' and issue = 'minimum_wage' then
    issue_economic := case stance when 'progressive' then -75 when 'conservative' then 40 else -35 end;
    issue_social := case stance when 'progressive' then -40 when 'conservative' then 20 else -10 end;
  elsif cat = 'education' and issue = 'school_funding' then
    issue_economic := case stance when 'progressive' then -70 when 'conservative' then 55 else 0 end;
    issue_social := case stance when 'progressive' then -45 when 'conservative' then 10 else 0 end;
  else
    issue_economic := case stance when 'progressive' then -50 when 'conservative' then 50 else 0 end;
    issue_social := case stance when 'progressive' then -30 when 'conservative' then 30 else 0 end;
  end if;
end;
$$;

create or replace function public._ordinance_sim_effect_deltas(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_stance_params jsonb default null
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
  rd numeric;
  earmark numeric;
  tax_norm numeric;
  p jsonb;
  step int;
  norm numeric;
begin
  if cat = 'taxes' and issue = 'property_tax_rate' and p_stance_params is not null then
    rd := public._clamp_property_tax_rate_delta((p_stance_params->>'rate_delta')::numeric);
    earmark := public._clamp_earmark_pct((p_stance_params->>'earmark_services_pct')::numeric) / 100.0;
    tax_norm := case
      when rd < 0 then power(abs(rd / (-5::numeric)), 1.7)
      when rd > 0 then power(rd / 15::numeric, 1.7)
      else 0
    end;
    d := d || jsonb_build_object('property_tax_rate_pct', rd);
    if rd < 0 then
      d := d || jsonb_build_object(
        'housing_affordability', round(tax_norm * (1 - earmark) * 8),
        'mayor_approval', round(tax_norm * 6),
        'economy_index', round(tax_norm * 2),
        'business_climate', round(-tax_norm * 2)
      );
    elsif rd > 0 then
      d := d || jsonb_build_object(
        'housing_affordability', round(-tax_norm * earmark * 5),
        'mayor_approval', round(-tax_norm * earmark * 3),
        'economy_index', round(tax_norm * 0.5),
        'business_climate', round(tax_norm * earmark * 3)
      );
    end if;
    return d;
  end if;

  if cat = 'crime' and issue = 'marijuana_legalization' and p_stance_params is not null then
    p := public._clamp_marijuana_stance_params(p_stance_params);
    step := public._marijuana_status_step_index(p->>'legal_status');
    norm := case when step > 0 then power(step::numeric / 3.0, 1.7) else 0 end;
    d := d || jsonb_build_object(
      'public_safety', round(-norm * 4),
      'business_climate', round(norm * (case when coalesce((p->>'commercial_sale_allowed')::boolean, false) then 5 else 2 end)),
      'mayor_approval', round(norm * 3),
      'economy_index', round(norm * 2)
    );
    if coalesce((p->>'expungement')::boolean, false) then
      d := d || jsonb_build_object('mayor_approval', coalesce((d->>'mayor_approval')::int, 0) + 2);
    end if;
    return d;
  end if;

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
  end if;

  return d;
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
  end if;

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
      then format('property tax %+s%%', deltas->>'property_tax_rate_pct') end,
    case when coalesce((fiscal->>'cannabis_sales_tax_revenue_millions')::numeric, 0) > 0
      then format('cannabis tax revenue $%sM/yr', round((fiscal->>'cannabis_sales_tax_revenue_millions')::numeric, 1)) end
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

create or replace function public.council_propose_ordinance(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_title text default '',
  p_summary text default '',
  p_stance_params jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  proposal_id uuid;
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  coalition text := null;
  scores record;
  clamped jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'mayor', 'admin')
  ) and not v_is_admin then
    raise exception 'Only the mayor or council members may propose ordinances';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'council_vote') then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'awaiting_mayor') then
    raise exception 'An ordinance is awaiting mayor signature before a new one can be filed';
  end if;

  if cat not in ('taxes', 'crime', 'economy', 'education') then
    raise exception 'Invalid policy category';
  end if;

  if issue = 'property_tax_rate' then
    if p_stance_params is null
      or not (p_stance_params ? 'rate_delta')
      or not (p_stance_params ? 'earmark_services_pct') then
      raise exception 'Property tax ordinances require stance_params (rate_delta, earmark_services_pct)';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, null, p_stance_params);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
    clamped := p_stance_params;
  elsif issue = 'marijuana_legalization' then
    if p_stance_params is null
      or not (p_stance_params ? 'legal_status')
      or not (p_stance_params ? 'commercial_sale_allowed')
      or not (p_stance_params ? 'sales_tax_rate')
      or not (p_stance_params ? 'expungement') then
      raise exception 'Marijuana ordinances require stance_params (legal_status, commercial_sale_allowed, sales_tax_rate, expungement)';
    end if;
    clamped := public._clamp_marijuana_stance_params(p_stance_params);
    select * into scores from public._ordinance_issue_scores(cat, issue, null, clamped);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  else
    if stance not in ('progressive', 'moderate', 'conservative') then
      raise exception 'Invalid stance';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, stance, null);
    coalition := stance;
    clamped := null;
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Ordinance title is required';
  end if;

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, stance_params, title, summary, status,
    issue_economic_score, issue_social_score
  ) values (
    v_uid, cat, trim(p_issue_key),
    coalition,
    case when issue in ('property_tax_rate', 'marijuana_legalization') then clamped else null end,
    trim(p_title), coalesce(p_summary, ''), 'council_vote',
    scores.issue_economic, scores.issue_social
  )
  returning id into proposal_id;

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_ordinance_vote(proposal_id);
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', proposal_id, 'status', 'council_vote');
end;
$$;

create or replace function public.get_city_fiscal_snapshot(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  depts jsonb;
  effects jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into m from public.city_fiscal_metrics where city_code = p_city_code;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'department_key', d.department_key,
      'amount_millions', d.amount_millions
    ) order by d.department_key
  ), '[]'::jsonb) into depts
  from public.city_fiscal_department_allocations d where d.city_code = p_city_code;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'source_type', e.source_type, 'source_id', e.source_id,
      'title', e.title, 'summary', e.summary, 'effects', e.effects, 'created_at', e.created_at
    ) order by e.created_at desc
  ), '[]'::jsonb) into effects
  from (select * from public.city_sim_effect_events where city_code = p_city_code order by created_at desc limit 8) e;

  return jsonb_build_object(
    'city_code', m.city_code,
    'population', m.population,
    'avg_household_income', m.avg_household_income,
    'economy_index', m.economy_index,
    'property_tax_rate_pct', m.property_tax_rate_pct,
    'business_tax_rate_pct', coalesce(m.business_tax_rate_pct, 0),
    'income_tax_enabled', m.income_tax_enabled,
    'income_tax_flat', coalesce(m.income_tax_flat, true),
    'income_tax_low_pct', m.income_tax_low_pct,
    'income_tax_mid_pct', m.income_tax_mid_pct,
    'income_tax_high_pct', m.income_tax_high_pct,
    'intergovernmental_aid_millions', coalesce(m.intergovernmental_aid_millions, 0),
    'treasury_balance', m.treasury_balance,
    'fiscal_year', m.fiscal_year,
    'business_tax_revenue_millions', coalesce(m.business_tax_revenue_millions, 0),
    'salary_tax_revenue_millions', coalesce(m.salary_tax_revenue_millions, 0),
    'cannabis_sales_tax_rate_pct', coalesce(m.cannabis_sales_tax_rate_pct, 0),
    'cannabis_sales_tax_revenue_millions', coalesce(m.cannabis_sales_tax_revenue_millions, 0),
    'office_salary_pool_millions', coalesce(m.office_salary_pool_millions, 0),
    'public_safety', m.public_safety,
    'education_quality', m.education_quality,
    'housing_affordability', m.housing_affordability,
    'business_climate', m.business_climate,
    'mayor_approval', m.mayor_approval,
    'mayor_electoral_approval', coalesce(m.mayor_electoral_approval, m.mayor_approval),
    'updated_at', m.updated_at,
    'departments', depts,
    'recent_effects', effects
  );
end;
$$;

notify pgrst, 'reload schema';
