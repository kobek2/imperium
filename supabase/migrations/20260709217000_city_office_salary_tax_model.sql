-- Office-salary-only city tax model: 5 turns/year, mayor $150k/turn, council $100k/turn, wallet reset.

alter table public.city_fiscal_metrics
  add column if not exists income_tax_flat boolean not null default true;

update public.city_fiscal_metrics
set
  income_tax_enabled = true,
  income_tax_flat = true,
  income_tax_low_pct = coalesce(nullif(income_tax_low_pct, 0), 3.0),
  income_tax_mid_pct = coalesce(nullif(income_tax_mid_pct, 0), 3.0),
  income_tax_high_pct = coalesce(nullif(income_tax_high_pct, 0), 3.0),
  property_tax_rate_pct = 0,
  business_tax_rate_pct = 0,
  updated_at = now()
where city_code = 'MB';

alter table public.city_sim_engine_state
  drop constraint if exists city_sim_engine_state_sim_week_check;

alter table public.city_sim_engine_state
  add constraint city_sim_engine_state_sim_week_check check (sim_week between 1 and 5);

update public.city_sim_engine_state
set sim_week = least(sim_week, 5)
where city_code = 'MB';

create or replace function public._city_office_salary_per_turn(p_role_key text)
returns numeric
language sql
immutable
as $$
  select case lower(trim(p_role_key))
    when 'mayor' then 150000::numeric
    when 'council_member' then 100000::numeric
    else 0::numeric
  end;
$$;

create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  eng record;
  new_year smallint;
  new_week smallint;
  capped int;
  turn_out jsonb;
  warnings text[] := '{}';
  rnd record;
  turns_per_year constant smallint := 5;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;

  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week)
    values (p_city_code, 0, 1, 1)
    returning * into eng;
  end if;

  if not p_force and coalesce(
    (select sim.campaign_manager_active from public.simulation_settings sim where sim.id = 1),
    false
  ) then
    select * into rnd from public.legislative_rounds r
    where r.campaign_cycle = (select campaign_manager_cycle from public.simulation_settings where id = 1)
      and r.campaign_turn = (select campaign_manager_turn from public.simulation_settings where id = 1)
      and r.phase <> 'completed'
    order by r.created_at desc limit 1;

    if rnd.id is not null then
      warnings := array_append(warnings, format('Legislative round still in %s phase', rnd.phase));
    end if;
  end if;

  capped := public._city_sim_cap_uncollected_salaries(p_city_code);

  new_week := eng.sim_week + 1;
  new_year := eng.sim_year;
  if new_week > turns_per_year then
    new_week := 1;
    new_year := new_year + 1;
  end if;

  update public.city_sim_engine_state
  set sim_year = new_year, sim_week = new_week, updated_at = now()
  where city_code = p_city_code;

  perform public._city_sim_reset_salary_week(p_city_code);
  perform public.tick_city_office_salaries(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  turn_out := public._campaign_advance_turn_internal(false);

  return jsonb_build_object(
    'ok', true,
    'sim_year', new_year,
    'sim_week', new_week,
    'sim_tick', eng.sim_tick,
    'salaries_forfeited', capped,
    'campaign_turn', turn_out,
    'warnings', warnings,
    'forced', p_force
  );
end;
$$;

create or replace function public.mayor_update_fiscal_proposal(
  p_property_tax_rate_pct numeric default null,
  p_business_tax_rate_pct numeric default null,
  p_income_tax_enabled boolean default null,
  p_income_tax_flat boolean default null,
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
    income_tax_flat = coalesce(p_income_tax_flat, income_tax_flat),
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

-- Reset wallets except Bleu Bell; ensure mayor grant + salary ledger.
do $$
declare
  bleu_id uuid;
begin
  select id into bleu_id
  from public.profiles
  where character_name ilike 'bleu bell'
  limit 1;

  update public.economy_wallets
  set balance = 0, updated_at = now()
  where bleu_id is null or user_id is distinct from bleu_id;

  if bleu_id is not null then
    delete from public.government_role_grants
    where user_id = bleu_id and role_key in ('president', 'vice_president', 'representative', 'senator', 'speaker', 'admin');

    insert into public.government_role_grants (user_id, role_key)
    values (bleu_id, 'mayor')
    on conflict (user_id, role_key) do nothing;

    update public.profiles
    set office_role = 'mayor', residence_state = 'MB', updated_at = now()
    where id = bleu_id;

    perform public._open_city_office_salary_term(bleu_id, 'mayor', 'MB');
  end if;
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
