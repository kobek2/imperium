-- One-shot staff simulation: close FY 3, replace any existing FY 4 row, open FY 4 with a 24h appropriations
-- countdown, seed line minima = allocated from the agreed closed-year table (sum $143,193,281),
-- set national_metrics.us_debt, align gdp_opening_total so (wallet_sum - opening) = $230,120,124,
-- and distribute exactly $45,000,000 across fiscal_tax_accounts.paid_amount for the new FY.
--
-- Destructive: deletes rp_fiscal_years where year_index = 4 if present. Requires active FY 3.

create or replace function public.admin_simulation_transition_fy4_staff_baseline()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y3 record;
  b3 record;
  m3 record;
  v_w numeric;
  v_gdp_opening numeric;
  v_now timestamptz := now();
  v_deadline timestamptz := v_now + interval '24 hours';
  v_fy4_id uuid;
  v_lines jsonb :=
    '[
      {"key":"infrastructure","label":"Infrastructure and Transportation","base_minimum":18718075,"minimum":18718075,"allocated":18718075},
      {"key":"education","label":"Education","base_minimum":16846269,"minimum":16846269,"allocated":16846269},
      {"key":"healthcare","label":"Healthcare","base_minimum":14974461,"minimum":14974461,"allocated":14974461},
      {"key":"defense","label":"Defense and National Security","base_minimum":18718076,"minimum":18718076,"allocated":18718076},
      {"key":"social_welfare","label":"Social Welfare Programs","base_minimum":19653980,"minimum":19653980,"allocated":19653980},
      {"key":"environment","label":"Environmental Protection","base_minimum":13102653,"minimum":13102653,"allocated":13102653},
      {"key":"economic_development","label":"Economic Development and Job Creation","base_minimum":18718076,"minimum":18718076,"allocated":18718076},
      {"key":"science_tech","label":"Science and Technology Research","base_minimum":9359038,"minimum":9359038,"allocated":9359038},
      {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","base_minimum":3743615,"minimum":3743615,"allocated":3743615},
      {"key":"relief","label":"Relief Funds","base_minimum":9359038,"minimum":9359038,"allocated":9359038}
    ]'::jsonb;
  v_target_tax numeric := 45000000;
  v_target_growth numeric := 230120124;
  v_target_debt numeric := -290124491;
  v_n bigint;
  v_base bigint;
  v_rem bigint;
begin
  if v_uid is not null and not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may run this transition.';
  end if;

  select * into y3 from public.rp_fiscal_years where status = 'active' for update;
  if not found then
    raise exception 'No active fiscal year.';
  end if;
  if y3.year_index is distinct from 3 then
    raise exception 'This script expects the active fiscal year to be FY 3 (year_index = 3). Current: %.', y3.year_index;
  end if;

  select * into b3 from public.federal_budgets where fiscal_year_id = y3.id limit 1;
  if not found then
    raise exception 'No federal budget row for active FY 3.';
  end if;

  select coalesce(sum(balance), 0) into v_w from public.economy_wallets;
  v_gdp_opening := v_w - v_target_growth;
  if v_gdp_opening < 0 then
    raise exception 'Wallet sum (%) is below target growth (%); cannot set non-negative gdp_opening_total.', v_w, v_target_growth;
  end if;

  select count(*) into v_n from public.profiles;
  if v_n <= 0 then
    raise exception 'No profiles — cannot distribute tax paid total.';
  end if;

  v_base := floor(v_target_tax / v_n)::bigint;
  v_rem := (v_target_tax::bigint - v_base * v_n);

  -- Remove stray FY 4 (and cascaded children) so we can insert a clean row.
  delete from public.rp_fiscal_years where year_index = 4;

  update public.rp_fiscal_years
  set
    status = 'closed',
    closed_at = v_now,
    gdp_closing_total = v_w
  where id = y3.id;

  insert into public.rp_fiscal_years (
    year_index,
    label,
    status,
    gdp_opening_total,
    appropriation_deadline_at,
    appropriations_act_bill_id,
    appropriation_clock_started_at,
    appropriation_window_hours,
    budget_initial_window_ends_at,
    budget_initial_window_missed_at,
    tax_due_days_after_close,
    tax_penalty_daily_rate,
    tax_warning_lead_days
  )
  values (
    4,
    'FY 4',
    'active',
    v_gdp_opening,
    v_deadline,
    null,
    v_now,
    coalesce(y3.appropriation_window_hours, 24),
    v_deadline,
    null,
    coalesce(y3.tax_due_days_after_close, 7),
    coalesce(y3.tax_penalty_daily_rate, 0.05::numeric),
    coalesce(y3.tax_warning_lead_days, 2)
  )
  returning id into v_fy4_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  )
  values (
    v_fy4_id,
    'draft',
    coalesce(v_uid, b3.president_user_id),
    coalesce(b3.tax_brackets, '[]'::jsonb),
    v_lines,
    coalesce(b3.metrics, '{}'::jsonb),
    v_now
  );

  select * into m3 from public.national_metrics where fiscal_year_id = y3.id limit 1;

  if not found then
    insert into public.national_metrics (fiscal_year_id, us_debt, updated_by)
    values (v_fy4_id, v_target_debt, coalesce(v_uid, (select id from public.profiles order by id limit 1)));
  else
    insert into public.national_metrics (
      fiscal_year_id,
      government_approval,
      unemployment_rate,
      per_capita_income,
      us_debt,
      education_academic_scores,
      education_dropout_rate,
      education_higher_ed_enrollment,
      poverty_percentage,
      poverty_effect,
      homelessness,
      healthcare_coverage,
      life_expectancy,
      crime_total,
      crime_prisoners,
      infrastructure_road_quality,
      infrastructure_road_congestion,
      updated_by
    )
    values (
      v_fy4_id,
      m3.government_approval,
      m3.unemployment_rate,
      m3.per_capita_income,
      v_target_debt,
      m3.education_academic_scores,
      m3.education_dropout_rate,
      m3.education_higher_ed_enrollment,
      m3.poverty_percentage,
      m3.poverty_effect,
      m3.homelessness,
      m3.healthcare_coverage,
      m3.life_expectancy,
      m3.crime_total,
      m3.crime_prisoners,
      m3.infrastructure_road_quality,
      m3.infrastructure_road_congestion,
      coalesce(v_uid, m3.updated_by)
    );
  end if;

  delete from public.fiscal_tax_accounts where fiscal_year_id = v_fy4_id;

  insert into public.fiscal_tax_accounts (
    fiscal_year_id,
    user_id,
    assessed_tax,
    paid_amount,
    outstanding_amount,
    total_penalties,
    due_at,
    status
  )
  select
    v_fy4_id,
    p.id,
    0,
    0,
    0,
    0,
    v_now + make_interval(days => coalesce(y3.tax_due_days_after_close, 7)),
    'pending'
  from public.profiles p;

  update public.fiscal_tax_accounts a
  set
    paid_amount = v_base + case when n.rn <= v_rem then 1 else 0 end,
    assessed_tax = v_base + case when n.rn <= v_rem then 1 else 0 end,
    outstanding_amount = 0,
    status = 'paid',
    updated_at = v_now
  from (
    select id, row_number() over (order by id) as rn
    from public.profiles
  ) n
  where a.fiscal_year_id = v_fy4_id
    and a.user_id = n.id;

  return jsonb_build_object(
    'ok', true,
    'closed_fiscal_year_id', y3.id,
    'new_fiscal_year_id', v_fy4_id,
    'wallet_sum', round(v_w, 2),
    'gdp_opening_total', round(v_gdp_opening, 2),
    'implied_growth_since_fy_start', round(v_w - v_gdp_opening, 2),
    'total_line_allocated', 143193281,
    'tax_paid_total_distributed', v_target_tax,
    'us_debt', v_target_debt,
    'appropriation_deadline_at', v_deadline
  );
end;
$$;

comment on function public.admin_simulation_transition_fy4_staff_baseline() is
  'Staff-only: destructive FY3→FY4 simulation baseline (24h appropriations window, seeded line items, debt, GDP opening, $45M tax paid split).';

grant execute on function public.admin_simulation_transition_fy4_staff_baseline() to authenticated;

notify pgrst, 'reload schema';
