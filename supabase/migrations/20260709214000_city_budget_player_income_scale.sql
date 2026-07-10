-- Player-income city budget: proposed tax rates on wallets/wages/commerce; department shares of collectible revenue.

alter table public.city_fiscal_metrics
  add column if not exists business_tax_rate_pct numeric not null default 1.5 check (business_tax_rate_pct >= 0);

update public.city_fiscal_metrics
set
  intergovernmental_aid_millions = 0,
  business_tax_rate_pct = coalesce(business_tax_rate_pct, 1.5)
where city_code = 'MB';

create or replace function public._player_business_tax_millions(
  p_business_tax_rate_pct numeric,
  p_window_days int default 90
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pe jsonb;
  volume numeric := 0;
begin
  pe := public.get_city_player_economy_snapshot(p_window_days);
  volume := coalesce((pe->'business_activity'->>'annualized_volume_usd')::numeric, 0);
  if volume <= 0 or coalesce(p_business_tax_rate_pct, 0) <= 0 then return 0; end if;
  return (volume * (p_business_tax_rate_pct / 100.0)) / 1000000.0;
end;
$$;

create or replace function public._rescale_city_budget_to_player_revenue(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rev numeric;
  shares jsonb := '{
    "finance": 0.08,
    "police": 0.35,
    "public_works": 0.28,
    "parks": 0.18,
    "planning": 0.11
  }'::jsonb;
  key text;
  share numeric;
begin
  rev := public._city_fiscal_revenue_millions(p_city_code);
  if rev <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_revenue');
  end if;

  for key, share in select * from jsonb_each_text(shares) loop
    update public.city_fiscal_department_allocations
    set amount_millions = round((rev * share::numeric)::numeric, 3)
    where city_code = p_city_code and department_key = key;
  end loop;

  return jsonb_build_object('ok', true, 'revenue_millions', rev);
end;
$$;

create or replace function public._city_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  pe jsonb;
  economy_mult numeric;
  property_rev numeric := 0;
  income_rev numeric := 0;
  business_rev numeric := 0;
  salary_rev numeric := 0;
  intergov numeric := 0;
  blended_rate numeric;
  wallet_sum numeric := 0;
  wallet_players int := 0;
  annualized_wage numeric := 0;
  commercial_volume numeric := 0;
  meaningful boolean := false;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then return 0; end if;

  pe := public.get_city_player_economy_snapshot(90);
  wallet_sum := coalesce((pe->>'wallet_balance_sum_usd')::numeric, 0);
  wallet_players := coalesce((pe->>'wallet_player_count')::int, 0);
  annualized_wage := coalesce((pe->>'annualized_wage_usd')::numeric, 0);
  commercial_volume := coalesce((pe->'business_activity'->>'annualized_volume_usd')::numeric, 0);

  meaningful := wallet_players >= 2 and wallet_sum >= 50000;

  economy_mult := case when m.economy_index > 0 then m.economy_index / 100.0 else 1 end;
  salary_rev := coalesce(m.salary_tax_revenue_millions, 0);

  if meaningful then
    if m.property_tax_rate_pct > 0 then
      property_rev := (
        wallet_sum * 0.25 * economy_mult * (m.property_tax_rate_pct / 100.0)
      ) / 1000000.0;
    end if;

    if m.income_tax_enabled and annualized_wage > 0 then
      blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
      income_rev := (annualized_wage * economy_mult * blended_rate) / 1000000.0;
    end if;

    business_rev := public._player_business_tax_millions(coalesce(m.business_tax_rate_pct, 1.5));
    intergov := 0;
  else
    if m.population > 0 and m.property_tax_rate_pct > 0 then
      property_rev := (
        m.population * m.avg_household_income * 0.3 * economy_mult * (m.property_tax_rate_pct / 100.0)
      ) / 1000000.0;
    end if;

    if m.income_tax_enabled and m.population > 0 then
      blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
      income_rev := (m.population * m.avg_household_income * economy_mult * blended_rate) / 1000000.0;
    end if;

    business_rev := coalesce(m.business_tax_revenue_millions, 0);
    intergov := coalesce(m.intergovernmental_aid_millions, 0);
  end if;

  return intergov + property_rev + income_rev + business_rev + salary_rev;
end;
$$;

create or replace function public.mayor_update_fiscal_proposal(
  p_property_tax_rate_pct numeric default null,
  p_business_tax_rate_pct numeric default null,
  p_income_tax_enabled boolean default null,
  p_income_tax_low_pct numeric default null,
  p_income_tax_mid_pct numeric default null,
  p_income_tax_high_pct numeric default null,
  p_finance numeric default null,
  p_police numeric default null,
  p_public_works numeric default null,
  p_parks numeric default null,
  p_planning numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_city_mayor_or_admin(v_uid) then
    raise exception 'Only the mayor may update the fiscal proposal';
  end if;

  update public.city_fiscal_metrics set
    property_tax_rate_pct = coalesce(p_property_tax_rate_pct, property_tax_rate_pct),
    business_tax_rate_pct = coalesce(p_business_tax_rate_pct, business_tax_rate_pct),
    income_tax_enabled = coalesce(p_income_tax_enabled, income_tax_enabled),
    income_tax_low_pct = coalesce(p_income_tax_low_pct, income_tax_low_pct),
    income_tax_mid_pct = coalesce(p_income_tax_mid_pct, income_tax_mid_pct),
    income_tax_high_pct = coalesce(p_income_tax_high_pct, income_tax_high_pct),
    updated_at = now()
  where city_code = 'MB';

  if p_finance is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_finance, 0), 0)
    where city_code = 'MB' and department_key = 'finance';
  end if;
  if p_police is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_police, 0), 0)
    where city_code = 'MB' and department_key = 'police';
  end if;
  if p_public_works is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_public_works, 0), 0)
    where city_code = 'MB' and department_key = 'public_works';
  end if;
  if p_parks is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_parks, 0), 0)
    where city_code = 'MB' and department_key = 'parks';
  end if;
  if p_planning is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_planning, 0), 0)
    where city_code = 'MB' and department_key = 'planning';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Include business_tax_rate_pct in fiscal snapshot reads.
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
    'business_tax_rate_pct', coalesce(m.business_tax_rate_pct, 1.5),
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

select public._rescale_city_budget_to_player_revenue('MB');

grant execute on function public._player_business_tax_millions(numeric, int) to authenticated, service_role;
grant execute on function public._rescale_city_budget_to_player_revenue(char) to authenticated, service_role;

notify pgrst, 'reload schema';
