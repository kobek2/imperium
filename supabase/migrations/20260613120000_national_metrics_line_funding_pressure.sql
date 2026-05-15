-- Tie federal budget line treasury deployments to national_metrics via proportional "funding ratios"
-- r = deployed / enacted allocation (per line). Metrics interpolate between stress floors/ceilings
-- and values stored in line_funding_baseline (admin targets; auto-seeded on first apply).

alter table public.national_metrics
  add column if not exists line_funding_baseline jsonb;

comment on column public.national_metrics.line_funding_baseline is
  'Snapshot of national metric targets (fully funded anchor). Refreshed on admin national_metrics edits; seeded on first funding-pressure apply if null.';


create or replace function public._fiscal_nm_baseline_payload(p public.national_metrics)
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'government_approval', p.government_approval,
    'unemployment_rate', p.unemployment_rate,
    'per_capita_income', p.per_capita_income,
    'education_academic_scores', p.education_academic_scores,
    'education_dropout_rate', p.education_dropout_rate,
    'education_higher_ed_enrollment', p.education_higher_ed_enrollment,
    'poverty_percentage', p.poverty_percentage,
    'poverty_effect', p.poverty_effect,
    'homelessness', p.homelessness,
    'healthcare_coverage', p.healthcare_coverage,
    'life_expectancy', p.life_expectancy,
    'crime_total', p.crime_total,
    'crime_prisoners', p.crime_prisoners,
    'infrastructure_road_quality', p.infrastructure_road_quality,
    'infrastructure_road_congestion', p.infrastructure_road_congestion
  );
$$;


create or replace function public._fiscal_national_metrics_apply_line_funding_pressure(
  p_fiscal_year_id uuid,
  p_actor uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  m public.national_metrics%rowtype;
  b jsonb;
  v_actor uuid := coalesce(p_actor, auth.uid());
  r_infrastructure numeric := 1;
  r_education numeric := 1;
  r_healthcare numeric := 1;
  r_defense numeric := 1;
  r_social_welfare numeric := 1;
  r_environment numeric := 1;
  r_economic_development numeric := 1;
  r_science_tech numeric := 1;
  r_foreign_aid numeric := 1;
  r_relief numeric := 1;
  v_lines int := 0;
  r_roads numeric;
  r_gov numeric;
  r_pci numeric;
  r_crime numeric;
  vb numeric;
  vbi bigint;
  v_new_gov numeric;
  v_new_unemp numeric;
  v_new_pci numeric;
  v_new_ed_score numeric;
  v_new_ed_drop numeric;
  v_new_ed_hi numeric;
  v_new_pov numeric;
  v_new_pov_eff numeric;
  v_new_home bigint;
  v_new_cov numeric;
  v_new_life numeric;
  v_new_crime bigint;
  v_new_pris bigint;
  v_new_rq numeric;
  v_new_rc numeric;
begin
  if p_fiscal_year_id is null then
    return;
  end if;

  select * into m from public.national_metrics where fiscal_year_id = p_fiscal_year_id for update;
  if not found then
    return;
  end if;

  if m.line_funding_baseline is null then
    update public.national_metrics
    set
      line_funding_baseline = public._fiscal_nm_baseline_payload(m),
      updated_at = now(),
      updated_by = coalesce(v_actor, m.updated_by)
    where fiscal_year_id = p_fiscal_year_id;
    select * into m from public.national_metrics where fiscal_year_id = p_fiscal_year_id for update;
  end if;

  b := m.line_funding_baseline;
  if b is null then
    return;
  end if;

  v_new_gov := m.government_approval;
  v_new_unemp := m.unemployment_rate;
  v_new_pci := m.per_capita_income;
  v_new_ed_score := m.education_academic_scores;
  v_new_ed_drop := m.education_dropout_rate;
  v_new_ed_hi := m.education_higher_ed_enrollment;
  v_new_pov := m.poverty_percentage;
  v_new_pov_eff := m.poverty_effect;
  v_new_home := m.homelessness;
  v_new_cov := m.healthcare_coverage;
  v_new_life := m.life_expectancy;
  v_new_crime := m.crime_total;
  v_new_pris := m.crime_prisoners;
  v_new_rq := m.infrastructure_road_quality;
  v_new_rc := m.infrastructure_road_congestion;

  select count(*) into v_lines
  from public.federal_budgets fb,
    lateral jsonb_array_elements(coalesce(fb.line_items, '[]'::jsonb)) e
  where fb.fiscal_year_id = p_fiscal_year_id
    and greatest(0::numeric, round(coalesce((e->>'allocated')::numeric, 0), 2)) > 0;

  if coalesce(v_lines, 0) <= 0 then
    return;
  end if;

  with line_data as (
    select
      nullif(trim(coalesce(e->>'key', '')), '') as k,
      greatest(0::numeric, round(coalesce((e->>'allocated')::numeric, 0), 2)) as alloc,
      coalesce(
        (
          select round(sum(o.amount), 2)
          from public.federal_treasury_outlays o
          where o.fiscal_year_id = p_fiscal_year_id
            and o.category = 'budget_line'
            and o.line_item_key = nullif(trim(coalesce(e->>'key', '')), '')
        ),
        0::numeric
      ) as dep
    from public.federal_budgets fb,
      lateral jsonb_array_elements(coalesce(fb.line_items, '[]'::jsonb)) e
    where fb.fiscal_year_id = p_fiscal_year_id
  ),
  line_r as (
    select
      k,
      case
        when alloc > 0 then least(1::numeric, dep / alloc)
        else 1::numeric
      end as r
    from line_data
    where k is not null
  )
  select
    coalesce(max(r) filter (where k = 'infrastructure'), 1::numeric),
    coalesce(max(r) filter (where k = 'education'), 1::numeric),
    coalesce(max(r) filter (where k = 'healthcare'), 1::numeric),
    coalesce(max(r) filter (where k = 'defense'), 1::numeric),
    coalesce(max(r) filter (where k = 'social_welfare'), 1::numeric),
    coalesce(max(r) filter (where k = 'environment'), 1::numeric),
    coalesce(max(r) filter (where k = 'economic_development'), 1::numeric),
    coalesce(max(r) filter (where k = 'science_tech'), 1::numeric),
    coalesce(max(r) filter (where k = 'foreign_aid'), 1::numeric),
    coalesce(max(r) filter (where k = 'relief'), 1::numeric)
  into
    r_infrastructure,
    r_education,
    r_healthcare,
    r_defense,
    r_social_welfare,
    r_environment,
    r_economic_development,
    r_science_tech,
    r_foreign_aid,
    r_relief
  from line_r;

  r_roads := least(r_infrastructure, r_environment);
  r_gov := least(r_defense, r_foreign_aid);
  r_pci := least(r_economic_development, r_science_tech);
  r_crime := r_defense;

  vb := coalesce((b->>'government_approval')::numeric, m.government_approval);
  if vb is not null then
    v_new_gov := round(25::numeric + (vb - 25::numeric) * r_gov, 4);
  else
    v_new_gov := m.government_approval;
  end if;

  vb := coalesce((b->>'unemployment_rate')::numeric, m.unemployment_rate);
  if vb is not null then
    v_new_unemp := round(vb + (35::numeric - vb) * (1::numeric - r_pci), 4);
  else
    v_new_unemp := m.unemployment_rate;
  end if;

  vb := coalesce((b->>'per_capita_income')::numeric, m.per_capita_income);
  if vb is not null then
    v_new_pci := round(20000::numeric + (vb - 20000::numeric) * r_pci, 2);
  else
    v_new_pci := m.per_capita_income;
  end if;

  vb := coalesce((b->>'education_academic_scores')::numeric, m.education_academic_scores);
  if vb is not null then
    v_new_ed_score := round(2::numeric + (vb - 2::numeric) * least(r_education, r_science_tech), 2);
  else
    v_new_ed_score := m.education_academic_scores;
  end if;

  vb := coalesce((b->>'education_dropout_rate')::numeric, m.education_dropout_rate);
  if vb is not null then
    v_new_ed_drop := round(vb + (40::numeric - vb) * (1::numeric - r_education), 4);
  else
    v_new_ed_drop := m.education_dropout_rate;
  end if;

  vb := coalesce((b->>'education_higher_ed_enrollment')::numeric, m.education_higher_ed_enrollment);
  if vb is not null then
    v_new_ed_hi := round(20::numeric + (vb - 20::numeric) * r_education, 4);
  else
    v_new_ed_hi := m.education_higher_ed_enrollment;
  end if;

  vb := coalesce((b->>'poverty_percentage')::numeric, m.poverty_percentage);
  if vb is not null then
    v_new_pov := round(vb + (85::numeric - vb) * (1::numeric - r_social_welfare), 4);
  else
    v_new_pov := m.poverty_percentage;
  end if;

  vb := coalesce((b->>'poverty_effect')::numeric, m.poverty_effect);
  if vb is not null then
    v_new_pov_eff := round(1::numeric + (vb - 1::numeric) * r_social_welfare, 4);
  else
    v_new_pov_eff := m.poverty_effect;
  end if;

  vbi := coalesce((b->>'homelessness')::bigint, m.homelessness);
  if vbi is not null then
    v_new_home := greatest(
      vbi,
      round(vbi::numeric * (1::numeric + 0.2::numeric * (1::numeric - least(r_social_welfare, r_relief))))::bigint
    );
  else
    v_new_home := m.homelessness;
  end if;

  vb := coalesce((b->>'healthcare_coverage')::numeric, m.healthcare_coverage);
  if vb is not null then
    v_new_cov := round(40::numeric + (vb - 40::numeric) * r_healthcare, 4);
  else
    v_new_cov := m.healthcare_coverage;
  end if;

  vb := coalesce((b->>'life_expectancy')::numeric, m.life_expectancy);
  if vb is not null then
    v_new_life := round(72::numeric + (vb - 72::numeric) * r_healthcare, 2);
  else
    v_new_life := m.life_expectancy;
  end if;

  vbi := coalesce((b->>'crime_total')::bigint, m.crime_total);
  if vbi is not null then
    v_new_crime := greatest(
      vbi,
      round(vbi::numeric * (1::numeric + 0.15::numeric * (1::numeric - r_crime)))::bigint
    );
  else
    v_new_crime := m.crime_total;
  end if;

  vbi := coalesce((b->>'crime_prisoners')::bigint, m.crime_prisoners);
  if vbi is not null then
    v_new_pris := greatest(
      vbi,
      round(vbi::numeric * (1::numeric + 0.15::numeric * (1::numeric - r_crime)))::bigint
    );
  else
    v_new_pris := m.crime_prisoners;
  end if;

  vb := coalesce((b->>'infrastructure_road_quality')::numeric, m.infrastructure_road_quality);
  if vb is not null then
    v_new_rq := round(18::numeric + (vb - 18::numeric) * r_roads, 4);
  else
    v_new_rq := m.infrastructure_road_quality;
  end if;

  vb := coalesce((b->>'infrastructure_road_congestion')::numeric, m.infrastructure_road_congestion);
  if vb is not null then
    v_new_rc := round(vb + (98::numeric - vb) * (1::numeric - r_roads), 4);
  else
    v_new_rc := m.infrastructure_road_congestion;
  end if;

  update public.national_metrics
  set
    government_approval = v_new_gov,
    unemployment_rate = v_new_unemp,
    per_capita_income = v_new_pci,
    education_academic_scores = v_new_ed_score,
    education_dropout_rate = v_new_ed_drop,
    education_higher_ed_enrollment = v_new_ed_hi,
    poverty_percentage = v_new_pov,
    poverty_effect = v_new_pov_eff,
    homelessness = v_new_home,
    healthcare_coverage = v_new_cov,
    life_expectancy = v_new_life,
    crime_total = v_new_crime,
    crime_prisoners = v_new_pris,
    infrastructure_road_quality = v_new_rq,
    infrastructure_road_congestion = v_new_rc,
    updated_at = now(),
    updated_by = coalesce(v_actor, updated_by)
  where fiscal_year_id = p_fiscal_year_id;
end;
$$;

comment on function public._fiscal_national_metrics_apply_line_funding_pressure(uuid, uuid) is
  'Internal: recompute stressed national_metrics from line_funding_baseline and deployed/enacted ratios per budget line.';


create or replace function public.fiscal_recompute_national_metrics_line_funding()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not (
    public._fiscal_is_treasury_officer(v_uid)
    or public._fiscal_is_admin(v_uid)
    or public.is_staff_admin(v_uid)
  ) then
    raise exception 'Treasury or admin authorization required.';
  end if;

  select id into y_id from public.rp_fiscal_years where status = 'active' limit 1;
  if y_id is null then
    raise exception 'No active fiscal year.';
  end if;

  perform public._fiscal_national_metrics_apply_line_funding_pressure(y_id, v_uid);
  return jsonb_build_object('ok', true, 'fiscal_year_id', y_id);
end;
$$;

grant execute on function public.fiscal_recompute_national_metrics_line_funding() to authenticated;


create or replace function public.national_metrics_admin_upsert(
  p_fiscal_year_id uuid,
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  old_row public.national_metrics%rowtype;
  new_row public.national_metrics%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_admin(v_uid) then
    raise exception 'Only admins may edit national metrics.';
  end if;

  if not exists (select 1 from public.rp_fiscal_years where id = p_fiscal_year_id) then
    raise exception 'Fiscal year not found.';
  end if;

  insert into public.national_metrics (fiscal_year_id, updated_by)
  values (p_fiscal_year_id, v_uid)
  on conflict (fiscal_year_id) do nothing;

  select * into old_row from public.national_metrics where fiscal_year_id = p_fiscal_year_id;

  update public.national_metrics
  set
    government_approval = coalesce((p_payload->>'government_approval')::numeric, government_approval),
    unemployment_rate = coalesce((p_payload->>'unemployment_rate')::numeric, unemployment_rate),
    per_capita_income = coalesce((p_payload->>'per_capita_income')::numeric, per_capita_income),
    us_debt = coalesce((p_payload->>'us_debt')::numeric, us_debt),
    education_academic_scores = coalesce((p_payload->>'education_academic_scores')::numeric, education_academic_scores),
    education_dropout_rate = coalesce((p_payload->>'education_dropout_rate')::numeric, education_dropout_rate),
    education_higher_ed_enrollment = coalesce((p_payload->>'education_higher_ed_enrollment')::numeric, education_higher_ed_enrollment),
    poverty_percentage = coalesce((p_payload->>'poverty_percentage')::numeric, poverty_percentage),
    poverty_effect = coalesce((p_payload->>'poverty_effect')::numeric, poverty_effect),
    homelessness = coalesce((p_payload->>'homelessness')::bigint, homelessness),
    healthcare_coverage = coalesce((p_payload->>'healthcare_coverage')::numeric, healthcare_coverage),
    life_expectancy = coalesce((p_payload->>'life_expectancy')::numeric, life_expectancy),
    crime_total = coalesce((p_payload->>'crime_total')::bigint, crime_total),
    crime_prisoners = coalesce((p_payload->>'crime_prisoners')::bigint, crime_prisoners),
    infrastructure_road_quality = coalesce((p_payload->>'infrastructure_road_quality')::numeric, infrastructure_road_quality),
    infrastructure_road_congestion = coalesce((p_payload->>'infrastructure_road_congestion')::numeric, infrastructure_road_congestion),
    updated_at = now(),
    updated_by = v_uid
  where fiscal_year_id = p_fiscal_year_id;

  select * into new_row from public.national_metrics where fiscal_year_id = p_fiscal_year_id;

  update public.national_metrics
  set
    line_funding_baseline = public._fiscal_nm_baseline_payload(new_row),
    updated_at = now(),
    updated_by = v_uid
  where fiscal_year_id = p_fiscal_year_id;

  perform public._fiscal_national_metrics_apply_line_funding_pressure(p_fiscal_year_id, v_uid);

  select * into new_row from public.national_metrics where fiscal_year_id = p_fiscal_year_id;

  insert into public.national_metrics_change_log (
    fiscal_year_id,
    changed_by,
    reason,
    old_values,
    new_values
  ) values (
    p_fiscal_year_id,
    v_uid,
    p_reason,
    to_jsonb(old_row) - 'updated_at',
    to_jsonb(new_row) - 'updated_at'
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.national_metrics_admin_upsert(uuid, jsonb, text) to authenticated;


create or replace function public.fiscal_treasury_deploy_budget_line_allocated_gap(
  p_line_item_key text,
  p_note text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_active record;
  t record;
  v_pay numeric;
  v_bal numeric;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_key text := nullif(trim(coalesce(p_line_item_key, '')), '');
  v_allocated numeric;
  v_deployed numeric;
  v_gap numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;
  if v_key is null then raise exception 'line_item_key is required.'; end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  select round(coalesce((elem->>'allocated')::numeric, 0), 2) into v_allocated
  from public.federal_budgets b,
    lateral jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) elem
  where b.fiscal_year_id = y_active.id
    and (elem->>'key') = v_key
  limit 1;

  if v_allocated is null then
    raise exception 'Unknown line_item_key for the active federal budget.';
  end if;

  select round(coalesce(sum(o.amount), 0), 2) into v_deployed
  from public.federal_treasury_outlays o
  where o.fiscal_year_id = y_active.id
    and o.category = 'budget_line'
    and o.line_item_key = v_key;

  v_gap := greatest(0::numeric, round(coalesce(v_allocated, 0) - coalesce(v_deployed, 0), 2));

  select * into t from public.federal_treasury where id = 1 for update;
  if not found then raise exception 'Federal treasury row missing.'; end if;

  v_bal := round(coalesce(t.balance, 0), 2);
  if v_bal <= 0 then raise exception 'Federal treasury has no cash on hand.'; end if;

  v_pay := least(v_bal, v_gap);
  if v_pay <= 0 then
    raise exception 'Nothing to deploy: line bucket already meets or exceeds enacted allocation (or allocation is zero).';
  end if;

  update public.federal_treasury
  set balance = balance - v_pay
  where id = 1;

  insert into public.federal_treasury_outlays (
    fiscal_year_id, category, line_item_key, amount, note, created_by
  ) values (
    y_active.id,
    'budget_line',
    v_key,
    v_pay,
    v_note,
    v_uid
  );

  perform public._fiscal_national_metrics_apply_line_funding_pressure(y_active.id, v_uid);

  return jsonb_build_object(
    'ok', true,
    'deployed', v_pay,
    'fiscal_year_id', y_active.id,
    'line_item_key', v_key,
    'allocated', v_allocated,
    'deployed_before', v_deployed,
    'gap_before', v_gap,
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1)
  );
end;
$$;

grant execute on function public.fiscal_treasury_deploy_budget_line_allocated_gap(text, text) to authenticated;


create or replace function public.fiscal_treasury_deploy_cash(
  p_category text,
  p_line_item_key text,
  p_amount numeric,
  p_note text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_active record;
  t record;
  v_amt numeric := round(greatest(0, coalesce(p_amount, 0)), 2);
  v_pay numeric;
  v_bal numeric;
  v_debt numeric;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_key text := nullif(trim(coalesce(p_line_item_key, '')), '');
  v_has_line boolean;
  v_new_debt numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  if p_category is null or p_category not in ('us_debt', 'budget_line') then
    raise exception 'category must be us_debt or budget_line.';
  end if;

  if p_category = 'budget_line' and v_key is null then
    raise exception 'line_item_key is required for budget_line deployments.';
  end if;

  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  if p_category = 'budget_line' then
    select exists (
      select 1
      from public.federal_budgets b,
        lateral jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) elem
      where b.fiscal_year_id = y_active.id
        and (elem->>'key') = v_key
    )
    into v_has_line;
    if not coalesce(v_has_line, false) then
      raise exception 'Unknown line_item_key for the active federal budget.';
    end if;
  end if;

  select * into t from public.federal_treasury where id = 1 for update;
  if not found then raise exception 'Federal treasury row missing.'; end if;

  v_bal := round(coalesce(t.balance, 0), 2);
  if v_bal <= 0 then raise exception 'Federal treasury has no cash on hand.'; end if;

  v_pay := least(v_amt, v_bal);

  if p_category = 'us_debt' then
    insert into public.national_metrics (fiscal_year_id, us_debt, updated_by)
    values (y_active.id, 0, v_uid)
    on conflict (fiscal_year_id) do nothing;

    select coalesce(us_debt, 0) into v_debt
    from public.national_metrics
    where fiscal_year_id = y_active.id
    for update;

    if v_debt > 0 then
      v_pay := least(v_pay, v_debt);
      if v_pay <= 0 then
        raise exception 'No positive U.S. debt on file to pay down (already at or below zero).';
      end if;
      v_new_debt := greatest(0::numeric, v_debt - v_pay);
    elsif v_debt < 0 then
      v_pay := least(v_pay, abs(v_debt));
      if v_pay <= 0 then
        raise exception 'No surplus position on file to deploy against (us_debt is not negative).';
      end if;
      v_new_debt := least(0::numeric, v_debt + v_pay);
    else
      v_new_debt := -v_pay;
    end if;

    update public.national_metrics
    set
      us_debt = v_new_debt,
      updated_at = now(),
      updated_by = v_uid
    where fiscal_year_id = y_active.id;
  end if;

  update public.federal_treasury
  set balance = balance - v_pay
  where id = 1;

  insert into public.federal_treasury_outlays (
    fiscal_year_id, category, line_item_key, amount, note, created_by
  ) values (
    y_active.id,
    p_category,
    case when p_category = 'budget_line' then v_key else null end,
    v_pay,
    v_note,
    v_uid
  );

  perform public._fiscal_national_metrics_apply_line_funding_pressure(y_active.id, v_uid);

  return jsonb_build_object(
    'ok', true,
    'deployed', v_pay,
    'fiscal_year_id', y_active.id,
    'category', p_category,
    'line_item_key', case when p_category = 'budget_line' then v_key else null end,
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1),
    'us_debt_after', case
      when p_category = 'us_debt' then (select us_debt from public.national_metrics where fiscal_year_id = y_active.id)
      else null
    end
  );
end;
$$;

grant execute on function public.fiscal_treasury_deploy_cash(text, text, numeric, text) to authenticated;


create or replace function public.fiscal_treasury_deploy_cash_split_budget_lines(
  p_mode text,
  p_cap_amount numeric default null,
  p_note text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_active record;
  t record;
  v_bal numeric;
  v_pool numeric;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_mode text := lower(trim(coalesce(p_mode, 'equal')));
  elem record;
  keys text[] := '{}';
  allocs numeric[] := '{}';
  pays numeric[] := '{}';
  v_n int;
  i int;
  v_sum_alloc numeric := 0;
  v_total_out numeric := 0;
  v_each numeric;
  v_acc numeric;
  v_pay_i numeric;
  v_json_lines jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  if v_mode not in ('equal', 'proportional') then
    raise exception 'mode must be equal or proportional.';
  end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  for elem in
    select
      nullif(trim(coalesce(e->>'key', '')), '') as k2,
      greatest(0::numeric, round(coalesce((e->>'allocated')::numeric, 0), 2)) as a2
    from public.federal_budgets b,
      lateral jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) e
    where b.fiscal_year_id = y_active.id
      and nullif(trim(coalesce(e->>'key', '')), '') is not null
    order by 1
  loop
    keys := array_append(keys, elem.k2);
    allocs := array_append(allocs, elem.a2);
    pays := array_append(pays, 0::numeric);
  end loop;

  v_n := coalesce(array_length(keys, 1), 0);
  if v_n <= 0 then raise exception 'No budget line items to deploy against.'; end if;

  select * into t from public.federal_treasury where id = 1 for update;
  if not found then raise exception 'Federal treasury row missing.'; end if;

  v_bal := round(coalesce(t.balance, 0), 2);
  if v_bal <= 0 then raise exception 'Federal treasury has no cash on hand.'; end if;

  if p_cap_amount is not null and p_cap_amount > 0 then
    v_pool := least(v_bal, round(p_cap_amount, 2));
  else
    v_pool := v_bal;
  end if;

  if v_pool <= 0 then raise exception 'Nothing to deploy after applying cap.'; end if;

  if v_mode = 'equal' then
    v_each := trunc((v_pool / v_n::numeric) * 100) / 100;
    v_acc := 0;
    for i in 1..(v_n - 1) loop
      pays[i] := v_each;
      v_acc := v_acc + v_each;
    end loop;
    pays[v_n] := round(v_pool - v_acc, 2);
  else
    for i in 1..v_n loop
      v_sum_alloc := v_sum_alloc + allocs[i];
    end loop;
    if coalesce(v_sum_alloc, 0) <= 0 then
      v_each := trunc((v_pool / v_n::numeric) * 100) / 100;
      v_acc := 0;
      for i in 1..(v_n - 1) loop
        pays[i] := v_each;
        v_acc := v_acc + v_each;
      end loop;
      pays[v_n] := round(v_pool - v_acc, 2);
    else
      v_acc := 0;
      for i in 1..(v_n - 1) loop
        v_pay_i := round(v_pool * allocs[i] / v_sum_alloc, 2);
        pays[i] := v_pay_i;
        v_acc := v_acc + v_pay_i;
      end loop;
      pays[v_n] := round(v_pool - v_acc, 2);
    end if;
  end if;

  for i in 1..v_n loop
    v_total_out := v_total_out + pays[i];
  end loop;

  v_total_out := round(v_total_out, 2);
  if v_total_out <= 0 then raise exception 'Computed deployment total is zero.'; end if;
  if v_total_out > v_bal then raise exception 'Internal split exceeds treasury balance.'; end if;

  update public.federal_treasury
  set balance = balance - v_total_out
  where id = 1;

  for i in 1..v_n loop
    if pays[i] > 0 then
      insert into public.federal_treasury_outlays (
        fiscal_year_id, category, line_item_key, amount, note, created_by
      ) values (
        y_active.id,
        'budget_line',
        keys[i],
        pays[i],
        case
          when v_note = '' then format('split:%s', v_mode)
          else format('split:%s — %s', v_mode, v_note)
        end,
        v_uid
      );
      v_json_lines := v_json_lines || jsonb_build_array(
        jsonb_build_object('key', keys[i], 'deployed', pays[i])
      );
    end if;
  end loop;

  perform public._fiscal_national_metrics_apply_line_funding_pressure(y_active.id, v_uid);

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'deployed_total', v_total_out,
    'fiscal_year_id', y_active.id,
    'lines', v_json_lines,
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1)
  );
end;
$$;

grant execute on function public.fiscal_treasury_deploy_cash_split_budget_lines(text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
