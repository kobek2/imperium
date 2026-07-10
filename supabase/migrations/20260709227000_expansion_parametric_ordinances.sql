-- Parametric ordinance expansion (bills 2–11) + local sales tax fiscal hook.

alter table public.city_fiscal_metrics
  add column if not exists local_sales_tax_rate_pct numeric not null default 0,
  add column if not exists local_sales_tax_revenue_millions numeric not null default 0;

create or replace function public._registry_parametric_issue_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'property_tax_rate',
    'marijuana_legalization',
    'policing_community_programs',
    'sentencing_bail_reform',
    'surveillance_policing_technology',
    'minimum_wage',
    'rent_control_housing',
    'small_business_tax_incentives',
    'public_transit_investment',
    'school_funding',
    'charter_school_expansion',
    'teacher_pay_class_size',
    'sales_tax_rate'
  ]::text[];
$$;

create or replace function public._expansion_parametric_issue_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'sentencing_bail_reform',
    'surveillance_policing_technology',
    'minimum_wage',
    'rent_control_housing',
    'small_business_tax_incentives',
    'public_transit_investment',
    'school_funding',
    'charter_school_expansion',
    'teacher_pay_class_size',
    'sales_tax_rate'
  ]::text[];
$$;

create or replace function public._power_curve_norm(p_val numeric, p_min numeric, p_max numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_max <= p_min then 0::numeric
    when p_val <= p_min then 0::numeric
    when p_val >= p_max then 1::numeric
    else power((p_val - p_min) / (p_max - p_min), 1.7)
  end;
$$;

create or replace function public._signed_continuous_score(
  p_val numeric,
  p_min numeric,
  p_max numeric,
  p_pos_amp numeric,
  p_neg_amp numeric
)
returns int
language plpgsql
immutable
as $$
declare
  mid numeric := (p_min + p_max) / 2.0;
  span numeric := greatest(abs(p_max - mid), abs(p_min - mid));
  norm numeric;
begin
  if p_val > mid then
    norm := public._power_curve_norm(p_val - mid, 0, span);
    return round(norm * p_pos_amp)::int;
  elsif p_val < mid then
    norm := public._power_curve_norm(mid - p_val, 0, span);
    return -round(norm * p_neg_amp)::int;
  end if;
  return 0;
end;
$$;

-- ─── Clamp helpers ───────────────────────────────────────────────────────────

create or replace function public._clamp_sentencing_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'sentencing_severity', greatest(0::numeric, least(100::numeric, coalesce((p_params->>'sentencing_severity')::numeric, 50))),
    'cash_bail', coalesce((p_params->>'cash_bail')::boolean, false)
  );
$$;

create or replace function public._clamp_surveillance_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  coverage numeric := greatest(0::numeric, least(100::numeric, coalesce((p_params->>'camera_coverage')::numeric, 0)));
begin
  return jsonb_build_object(
    'camera_coverage', coverage,
    'facial_recognition', case when coverage > 0 then coalesce((p_params->>'facial_recognition')::boolean, false) else false end
  );
end;
$$;

create or replace function public._clamp_minimum_wage_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'wage_floor', greatest(15::numeric, least(30::numeric, coalesce((p_params->>'wage_floor')::numeric, 15)))
  );
$$;

create or replace function public._clamp_rent_control_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  cap numeric := greatest(0::numeric, least(15::numeric, coalesce((p_params->>'rent_increase_cap')::numeric, 15)));
begin
  return jsonb_build_object(
    'rent_increase_cap', cap,
    'affordable_unit_mandate_pct', case
      when cap < 12 then greatest(0::numeric, least(30::numeric, coalesce((p_params->>'affordable_unit_mandate_pct')::numeric, 0)))
      else 0::numeric
    end
  );
end;
$$;

create or replace function public._clamp_small_biz_tax_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  elig text := lower(trim(coalesce(p_params->>'eligibility', 'new_businesses')));
begin
  if elig not in ('new_businesses', 'under_50_employees', 'all_businesses') then
    elig := 'new_businesses';
  end if;
  return jsonb_build_object(
    'tax_credit_pct', greatest(0::numeric, least(25::numeric, coalesce((p_params->>'tax_credit_pct')::numeric, 0))),
    'eligibility', elig
  );
end;
$$;

create or replace function public._clamp_transit_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'funding_delta', greatest(-20::numeric, least(50::numeric, coalesce((p_params->>'funding_delta')::numeric, 0))),
    'fare_change', greatest(-50::numeric, least(25::numeric, coalesce((p_params->>'fare_change')::numeric, 0)))
  );
$$;

create or replace function public._clamp_school_funding_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  focus text := lower(trim(coalesce(p_params->>'allocation_focus', 'general')));
begin
  if focus not in ('general', 'title_i', 'universal_pre_k') then
    focus := 'general';
  end if;
  return jsonb_build_object(
    'funding_delta', greatest(-15::numeric, least(25::numeric, coalesce((p_params->>'funding_delta')::numeric, 0))),
    'allocation_focus', focus
  );
end;
$$;

create or replace function public._clamp_charter_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'charter_cap_change', greatest(-50::numeric, least(50::numeric, coalesce((p_params->>'charter_cap_change')::numeric, 0))),
    'voucher_program', coalesce((p_params->>'voucher_program')::boolean, false)
  );
$$;

create or replace function public._clamp_teacher_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'pay_increase_pct', greatest(0::numeric, least(20::numeric, coalesce((p_params->>'pay_increase_pct')::numeric, 0))),
    'class_size_target', greatest(15::numeric, least(35::numeric, coalesce((p_params->>'class_size_target')::numeric, 25)))
  );
$$;

create or replace function public._clamp_sales_tax_stance_params(p_params jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'rate', greatest(0::numeric, least(10::numeric, coalesce((p_params->>'rate')::numeric, 0)))
  );
$$;

create or replace function public._clamp_expansion_parametric_stance_params(p_issue text, p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  issue text := lower(trim(coalesce(p_issue, '')));
begin
  case issue
    when 'sentencing_bail_reform' then return public._clamp_sentencing_stance_params(p_params);
    when 'surveillance_policing_technology' then return public._clamp_surveillance_stance_params(p_params);
    when 'minimum_wage' then return public._clamp_minimum_wage_stance_params(p_params);
    when 'rent_control_housing' then return public._clamp_rent_control_stance_params(p_params);
    when 'small_business_tax_incentives' then return public._clamp_small_biz_tax_stance_params(p_params);
    when 'public_transit_investment' then return public._clamp_transit_stance_params(p_params);
    when 'school_funding' then return public._clamp_school_funding_stance_params(p_params);
    when 'charter_school_expansion' then return public._clamp_charter_stance_params(p_params);
    when 'teacher_pay_class_size' then return public._clamp_teacher_stance_params(p_params);
    when 'sales_tax_rate' then return public._clamp_sales_tax_stance_params(p_params);
    else return coalesce(p_params, '{}'::jsonb);
  end case;
end;
$$;

create or replace function public._valid_expansion_parametric_params(p_issue text, p_params jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  issue text := lower(trim(coalesce(p_issue, '')));
begin
  if p_params is null then return false; end if;
  case issue
    when 'sentencing_bail_reform' then
      return (p_params ? 'sentencing_severity') and (p_params ? 'cash_bail');
    when 'surveillance_policing_technology' then
      return (p_params ? 'camera_coverage') and (p_params ? 'facial_recognition');
    when 'minimum_wage' then return p_params ? 'wage_floor';
    when 'rent_control_housing' then
      return (p_params ? 'rent_increase_cap') and (p_params ? 'affordable_unit_mandate_pct');
    when 'small_business_tax_incentives' then
      return (p_params ? 'tax_credit_pct') and (p_params ? 'eligibility');
    when 'public_transit_investment' then
      return (p_params ? 'funding_delta') and (p_params ? 'fare_change');
    when 'school_funding' then
      return (p_params ? 'funding_delta') and (p_params ? 'allocation_focus');
    when 'charter_school_expansion' then
      return (p_params ? 'charter_cap_change') and (p_params ? 'voucher_program');
    when 'teacher_pay_class_size' then
      return (p_params ? 'pay_increase_pct') and (p_params ? 'class_size_target');
    when 'sales_tax_rate' then return p_params ? 'rate';
    else return false;
  end case;
end;
$$;

-- ─── Score helpers ───────────────────────────────────────────────────────────

create or replace function public._score_sentencing_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_sentencing_stance_params(p_stance_params);
  sev numeric := (p->>'sentencing_severity')::numeric;
  sev_norm numeric := public._power_curve_norm(sev - 50, 0, 50);
  econ int;
  soc int;
begin
  econ := round(sev_norm * 35)::int;
  soc := round(sev_norm * 40)::int + case when coalesce((p->>'cash_bail')::boolean, false) then -25 else 0 end;
  issue_economic := greatest(-99, least(99, econ))::smallint;
  issue_social := greatest(-99, least(99, soc))::smallint;
  return next;
end;
$$;

create or replace function public._score_surveillance_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_surveillance_stance_params(p_stance_params);
  cov numeric := public._power_curve_norm((p->>'camera_coverage')::numeric, 0, 100);
  econ int := round(cov * 28)::int;
  soc int := round(cov * 35)::int;
begin
  if coalesce((p->>'facial_recognition')::boolean, false) then
    econ := econ + 12;
    soc := soc + 20;
  end if;
  issue_economic := greatest(-99, least(99, econ))::smallint;
  issue_social := greatest(-99, least(99, soc))::smallint;
  return next;
end;
$$;

create or replace function public._score_minimum_wage_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_minimum_wage_stance_params(p_stance_params);
  norm numeric := public._power_curve_norm((p->>'wage_floor')::numeric - 15, 0, 15);
begin
  issue_economic := greatest(-99, least(99, -round(norm * 75)::int))::smallint;
  issue_social := greatest(-99, least(99, -round(norm * 42)::int))::smallint;
  return next;
end;
$$;

create or replace function public._score_rent_control_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_rent_control_stance_params(p_stance_params);
  strictness numeric := public._power_curve_norm(12 - (p->>'rent_increase_cap')::numeric, 0, 12);
  mandate numeric := public._power_curve_norm((p->>'affordable_unit_mandate_pct')::numeric, 0, 30);
begin
  issue_economic := greatest(-99, least(99, round((strictness + mandate) * 30)::int))::smallint;
  issue_social := greatest(-99, least(99, -round(strictness * 40 + mandate * 25)::int))::smallint;
  return next;
end;
$$;

create or replace function public._ordinal_eligibility_index(p_elig text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_elig, '')))
    when 'new_businesses' then 0
    when 'under_50_employees' then 1
    when 'all_businesses' then 2
    else 0
  end;
$$;

create or replace function public._score_small_biz_tax_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_small_biz_tax_stance_params(p_stance_params);
  credit numeric := public._power_curve_norm((p->>'tax_credit_pct')::numeric, 0, 25);
  elig int := public._ordinal_eligibility_index(p->>'eligibility');
  econ int;
  soc int;
begin
  econ := -round(credit * 40 + elig * 8)::int;
  soc := round(credit * 15)::int;
  issue_economic := greatest(-99, least(99, econ))::smallint;
  issue_social := greatest(-99, least(99, soc))::smallint;
  return next;
end;
$$;

create or replace function public._score_transit_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_transit_stance_params(p_stance_params);
  fund_delta numeric := (p->>'funding_delta')::numeric;
  fare_change numeric := (p->>'fare_change')::numeric;
begin
  issue_economic := greatest(-99, least(99,
    public._signed_continuous_score(fund_delta, -20, 50, 45, 35)
    + public._signed_continuous_score(-fare_change, -50, 25, 30, 25)
  ))::smallint;
  issue_social := greatest(-99, least(99,
    public._signed_continuous_score(-fund_delta, -20, 50, 35, 30)
    + public._signed_continuous_score(fare_change, -50, 25, 25, 20)
  ))::smallint;
  return next;
end;
$$;

create or replace function public._allocation_focus_index(p_focus text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_focus, '')))
    when 'general' then 0
    when 'title_i' then 1
    when 'universal_pre_k' then 2
    else 0
  end;
$$;

create or replace function public._score_school_funding_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_school_funding_stance_params(p_stance_params);
  fund int := public._signed_continuous_score((p->>'funding_delta')::numeric, -15, 25, 70, 55);
  focus int := case public._allocation_focus_index(p->>'allocation_focus')
    when 0 then -20 when 1 then -35 else -45 end;
begin
  issue_economic := greatest(-99, least(99, fund))::smallint;
  issue_social := greatest(-99, least(99, fund + focus))::smallint;
  return next;
end;
$$;

create or replace function public._score_charter_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_charter_stance_params(p_stance_params);
  cap int := public._signed_continuous_score((p->>'charter_cap_change')::numeric, -50, 50, 45, 35);
  voucher int := case when coalesce((p->>'voucher_program')::boolean, false) then 35 else 0 end;
begin
  issue_economic := greatest(-99, least(99, cap + round(voucher * 0.6)::int))::smallint;
  issue_social := greatest(-99, least(99, cap + voucher))::smallint;
  return next;
end;
$$;

create or replace function public._score_teacher_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_teacher_stance_params(p_stance_params);
  pay numeric := public._power_curve_norm((p->>'pay_increase_pct')::numeric, 0, 20);
  size_norm numeric := public._power_curve_norm(35 - (p->>'class_size_target')::numeric, 0, 20);
begin
  issue_economic := greatest(-99, least(99, -round((pay + size_norm) * 35)::int))::smallint;
  issue_social := greatest(-99, least(99, -round(pay * 30 + size_norm * 40)::int))::smallint;
  return next;
end;
$$;

create or replace function public._score_sales_tax_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_sales_tax_stance_params(p_stance_params);
  norm numeric := public._power_curve_norm((p->>'rate')::numeric, 0, 10);
begin
  issue_economic := greatest(-99, least(99, round(norm * 55)::int))::smallint;
  issue_social := greatest(-99, least(99, round(norm * -18)::int))::smallint;
  return next;
end;
$$;

create or replace function public._score_expansion_parametric_ordinance(p_issue text, p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  issue text := lower(trim(coalesce(p_issue, '')));
  scores record;
begin
  case issue
    when 'sentencing_bail_reform' then
      select * into scores from public._score_sentencing_ordinance(p_stance_params);
    when 'surveillance_policing_technology' then
      select * into scores from public._score_surveillance_ordinance(p_stance_params);
    when 'minimum_wage' then
      select * into scores from public._score_minimum_wage_ordinance(p_stance_params);
    when 'rent_control_housing' then
      select * into scores from public._score_rent_control_ordinance(p_stance_params);
    when 'small_business_tax_incentives' then
      select * into scores from public._score_small_biz_tax_ordinance(p_stance_params);
    when 'public_transit_investment' then
      select * into scores from public._score_transit_ordinance(p_stance_params);
    when 'school_funding' then
      select * into scores from public._score_school_funding_ordinance(p_stance_params);
    when 'charter_school_expansion' then
      select * into scores from public._score_charter_ordinance(p_stance_params);
    when 'teacher_pay_class_size' then
      select * into scores from public._score_teacher_ordinance(p_stance_params);
    when 'sales_tax_rate' then
      select * into scores from public._score_sales_tax_ordinance(p_stance_params);
    else
      issue_economic := 0;
      issue_social := 0;
      return next;
  end case;
  issue_economic := scores.issue_economic;
  issue_social := scores.issue_social;
  return next;
end;
$$;

-- ─── Sim effect deltas ─────────────────────────────────────────────────────────

create or replace function public._expansion_parametric_sim_deltas(p_issue text, p_stance_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  issue text := lower(trim(coalesce(p_issue, '')));
  p jsonb;
  norm numeric;
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
  case issue
    when 'sentencing_bail_reform' then
      p := public._clamp_sentencing_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'sentencing_severity')::numeric, 0, 100);
      d := d || jsonb_build_object(
        'public_safety', round(norm * 6)::int,
        'mayor_approval', case when coalesce((p->>'cash_bail')::boolean, false) then 4 else -1 end
      );
    when 'surveillance_policing_technology' then
      p := public._clamp_surveillance_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'camera_coverage')::numeric, 0, 100);
      d := d || jsonb_build_object(
        'public_safety', round(norm * 5)::int,
        'mayor_approval', case when coalesce((p->>'facial_recognition')::boolean, false) then -3 else 1 end
      );
    when 'minimum_wage' then
      p := public._clamp_minimum_wage_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'wage_floor')::numeric - 15, 0, 15);
      d := d || jsonb_build_object(
        'business_climate', -round(norm * 7)::int,
        'housing_affordability', round(norm * 5)::int,
        'mayor_approval', round(norm * 3)::int
      );
    when 'rent_control_housing' then
      p := public._clamp_rent_control_stance_params(p_stance_params);
      norm := public._power_curve_norm(12 - (p->>'rent_increase_cap')::numeric, 0, 12);
      d := d || jsonb_build_object(
        'housing_affordability', round(norm * 8)::int,
        'business_climate', -round(norm * 4)::int
      );
    when 'small_business_tax_incentives' then
      p := public._clamp_small_biz_tax_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'tax_credit_pct')::numeric, 0, 25);
      d := d || jsonb_build_object('business_climate', round(norm * 6)::int, 'mayor_approval', round(norm * 2)::int);
    when 'public_transit_investment' then
      p := public._clamp_transit_stance_params(p_stance_params);
      d := d || jsonb_build_object(
        'economy_index', public._signed_continuous_score((p->>'funding_delta')::numeric, -20, 50, 3, 2),
        'mayor_approval', public._signed_continuous_score(-(p->>'fare_change')::numeric, -50, 25, 4, 2)
      );
    when 'school_funding' then
      p := public._clamp_school_funding_stance_params(p_stance_params);
      d := d || jsonb_build_object(
        'education_quality', public._signed_continuous_score((p->>'funding_delta')::numeric, -15, 25, 9, 4),
        'mayor_approval', public._signed_continuous_score((p->>'funding_delta')::numeric, -15, 25, 4, 2)
      );
    when 'charter_school_expansion' then
      p := public._clamp_charter_stance_params(p_stance_params);
      d := d || jsonb_build_object(
        'education_quality', public._signed_continuous_score((p->>'charter_cap_change')::numeric, -50, 50, 4, 3)
      );
    when 'teacher_pay_class_size' then
      p := public._clamp_teacher_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'pay_increase_pct')::numeric, 0, 20);
      d := d || jsonb_build_object(
        'education_quality', round(norm * 7 + public._power_curve_norm(35 - (p->>'class_size_target')::numeric, 0, 20) * 5)::int,
        'mayor_approval', round(norm * 3)::int
      );
    when 'sales_tax_rate' then
      p := public._clamp_sales_tax_stance_params(p_stance_params);
      norm := public._power_curve_norm((p->>'rate')::numeric, 0, 10);
      d := d || jsonb_build_object(
        'economy_index', -round(norm * 2)::int,
        'business_climate', -round(norm * 2)::int,
        'mayor_approval', round(norm * 2)::int
      );
    else
      null;
  end case;
  return d;
end;
$$;

-- ─── Local sales tax fiscal ──────────────────────────────────────────────────

create or replace function public._local_sales_tax_base_usd(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
as $$
declare
  gdp numeric;
begin
  select coalesce(population, 0)::numeric * coalesce(avg_household_income, 0)::numeric * 2.5
  into gdp
  from public.city_fiscal_metrics
  where city_code = p_city_code;
  if coalesce(gdp, 0) > 0 then
    return gdp * 0.15;
  end if;
  return 12000000000::numeric;
end;
$$;

create or replace function public._local_sales_tax_revenue_millions(
  p_stance_params jsonb,
  p_city_code char(2) default 'MB'
)
returns numeric
language plpgsql
stable
as $$
declare
  p jsonb := public._clamp_sales_tax_stance_params(p_stance_params);
  rate numeric := (p->>'rate')::numeric;
begin
  if rate <= 0 then return 0; end if;
  return (public._local_sales_tax_base_usd(p_city_code) * (rate / 100.0)) / 1000000.0;
end;
$$;

create or replace function public._apply_local_sales_tax_fiscal_settings(
  p_stance_params jsonb,
  p_city_code char(2) default 'MB'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb := public._clamp_sales_tax_stance_params(p_stance_params);
  rate numeric := (p->>'rate')::numeric;
  revenue numeric := public._local_sales_tax_revenue_millions(p, p_city_code);
begin
  update public.city_fiscal_metrics
  set
    local_sales_tax_rate_pct = rate,
    local_sales_tax_revenue_millions = revenue,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'local_sales_tax_rate_pct', rate,
    'local_sales_tax_revenue_millions', revenue
  );
end;
$$;

-- ─── Stance check ──────────────────────────────────────────────────────────────

alter table public.city_ordinance_proposals
  drop constraint if exists city_ordinance_proposals_stance_check;

alter table public.city_ordinance_proposals
  add constraint city_ordinance_proposals_stance_check check (
    (
      lower(trim(issue_key)) = any(public._registry_parametric_issue_keys())
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
            or (
              lower(trim(issue_key)) = 'policing_community_programs'
              and (stance_params ? 'staffing_level')
              and (stance_params ? 'strategy')
            )
            or (
              lower(trim(issue_key)) = any(public._expansion_parametric_issue_keys())
              and public._valid_expansion_parametric_params(lower(trim(issue_key)), stance_params)
            )
          )
        )
        or stance_key in ('progressive', 'moderate', 'conservative')
      )
    )
    or (
      lower(trim(issue_key)) <> all(public._registry_parametric_issue_keys())
      and stance_key in ('progressive', 'moderate', 'conservative')
    )
  );

-- ─── Scoring router ────────────────────────────────────────────────────────────

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
  pol_scores record;
  exp_scores record;
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

  if cat = 'crime' and issue = 'policing_community_programs' and p_stance_params is not null then
    select * into pol_scores from public._score_policing_ordinance(p_stance_params);
    issue_economic := pol_scores.issue_economic;
    issue_social := pol_scores.issue_social;
    return;
  end if;

  if issue = any(public._expansion_parametric_issue_keys()) and p_stance_params is not null then
    select * into exp_scores from public._score_expansion_parametric_ordinance(issue, p_stance_params);
    issue_economic := exp_scores.issue_economic;
    issue_social := exp_scores.issue_social;
    return;
  end if;

  if cat = 'taxes' and issue = 'property_tax_rate' then
    issue_economic := case stance when 'progressive' then -72 when 'conservative' then 45 else 0 end;
    issue_social := case stance when 'progressive' then -42 when 'conservative' then 15 else 0 end;
  elsif cat = 'crime' and issue = 'policing_community_programs' then
    issue_economic := case stance when 'progressive' then -25 when 'conservative' then 30 else 0 end;
    issue_social := case stance when 'progressive' then -65 when 'conservative' then 55 else 0 end;
  else
    issue_economic := case stance when 'progressive' then -50 when 'conservative' then 50 else 0 end;
    issue_social := case stance when 'progressive' then -30 when 'conservative' then 30 else 0 end;
  end if;
end;
$$;

-- ─── Sim effect router ─────────────────────────────────────────────────────────

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

  if cat = 'crime' and issue = 'policing_community_programs' and p_stance_params is not null then
    return public._policing_ordinance_sim_deltas(p_stance_params);
  end if;

  if issue = any(public._expansion_parametric_issue_keys()) and p_stance_params is not null then
    return public._expansion_parametric_sim_deltas(issue, p_stance_params);
  end if;

  if stance = 'progressive' then
    d := d || jsonb_build_object('community_programs', 2);
  elsif stance = 'conservative' then
    d := d || jsonb_build_object('business_climate', -3);
  end if;

  return d;
end;
$$;

-- ─── Propose ordinance ─────────────────────────────────────────────────────────

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
  parametric_issues text[] := public._registry_parametric_issue_keys();
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
  elsif issue = 'policing_community_programs' then
    if p_stance_params is null
      or not (p_stance_params ? 'staffing_level')
      or not (p_stance_params ? 'strategy') then
      raise exception 'Policing ordinances require stance_params (staffing_level, strategy)';
    end if;
    clamped := public._clamp_policing_stance_params(p_stance_params);
    select * into scores from public._ordinance_issue_scores(cat, issue, null, clamped);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  elsif issue = any(public._expansion_parametric_issue_keys()) then
    if not public._valid_expansion_parametric_params(issue, p_stance_params) then
      raise exception 'Parametric ordinance missing required stance_params for issue %', issue;
    end if;
    clamped := public._clamp_expansion_parametric_stance_params(issue, p_stance_params);
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
    case when issue = any(parametric_issues) then clamped else null end,
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

-- ─── Apply ordinance effects (sales tax fiscal) ────────────────────────────────

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
    'local_sales_tax_rate_pct', coalesce(m.local_sales_tax_rate_pct, 0),
    'local_sales_tax_revenue_millions', coalesce(m.local_sales_tax_revenue_millions, 0),
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
