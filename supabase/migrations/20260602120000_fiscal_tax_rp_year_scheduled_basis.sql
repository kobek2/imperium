-- Align income-tax assessment with the federal workbook bracket preview:
-- use scheduled one-sim-hour gross (government roles + PAC), annualized as ×72 sim-hours (one RP-year planning slice),
-- then marginal brackets — not cumulative economy_ledger hourly_income since FY start (which grows with every collect).

create or replace function public.admin_fy4_apply_budget_tax_baseline()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  y record;
  v_brackets jsonb :=
    '[
      {"ceiling":20000,"rate":0.15},
      {"ceiling":50000,"rate":0.20},
      {"ceiling":100000,"rate":0.25},
      {"ceiling":200000,"rate":0.30},
      {"ceiling":null,"rate":0.349}
    ]'::jsonb;
  v_lines jsonb :=
    '[
      {"key":"infrastructure","label":"Infrastructure and Transportation","base_minimum":35691670,"minimum":35691670,"allocated":35691670},
      {"key":"education","label":"Education","base_minimum":31362069,"minimum":31362069,"allocated":31362069},
      {"key":"healthcare","label":"Healthcare","base_minimum":30074213,"minimum":30074213,"allocated":30074213},
      {"key":"defense","label":"Defense and National Security","base_minimum":35691672,"minimum":35691672,"allocated":35691672},
      {"key":"social_welfare","label":"Social Welfare Programs","base_minimum":37856475,"minimum":37856475,"allocated":37856475},
      {"key":"environment","label":"Environmental Protection","base_minimum":24223733,"minimum":24223733,"allocated":24223733},
      {"key":"economic_development","label":"Economic Development and Job Creation","base_minimum":37212547,"minimum":37212547,"allocated":37212547},
      {"key":"science_tech","label":"Science and Technology Research","base_minimum":21648024,"minimum":21648024,"allocated":21648024},
      {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","base_minimum":8659207,"minimum":8659207,"allocated":8659207},
      {"key":"relief","label":"Relief Funds","base_minimum":21648024,"minimum":21648024,"allocated":21648024}
    ]'::jsonb;
  u record;
  v_hourly numeric;
  v_rp_year_gross numeric;
  v_tax numeric;
  v_due timestamptz;
  v_rows int := 0;
  v_assessed_total numeric := 0;
  v_rp_hours int := 72;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may run this FY4 tax baseline.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then
    raise exception 'No active fiscal year.';
  end if;
  if y.year_index is distinct from 4 then
    raise exception 'This baseline applies only when the active fiscal year is FY 4 (year_index = 4). Current: %.', y.year_index;
  end if;

  update public.federal_budgets
  set
    tax_brackets = v_brackets,
    line_items = v_lines,
    status = 'submitted',
    submitted_at = coalesce(submitted_at, v_now),
    updated_at = v_now
  where fiscal_year_id = y.id;

  update public.federal_treasury
  set balance = 0
  where id = 1;

  delete from public.federal_treasury_outlays where fiscal_year_id = y.id;

  delete from public.fiscal_tax_events where fiscal_year_id = y.id;

  v_due := v_now + (greatest(1, least(60, coalesce(y.tax_due_days_after_close, 7))) * interval '1 day');

  for u in select id from public.profiles
  loop
    select (
      public._economy_hourly_from_roles(public._economy_effective_role_keys(u.id))
      + coalesce(
          (
            select public._economy_pac_hourly(e.level)
            from public.economy_pacs e
            where e.user_id = u.id
            limit 1
          ),
          0::numeric
        )
    )::numeric
    into v_hourly;

    v_rp_year_gross := round(greatest(0::numeric, coalesce(v_hourly, 0)) * v_rp_hours::numeric, 2);
    v_tax := round(public.fiscal_marginal_tax(v_rp_year_gross, v_brackets), 2);
    v_assessed_total := v_assessed_total + coalesce(v_tax, 0);

    insert into public.fiscal_tax_accounts (
      fiscal_year_id,
      user_id,
      assessed_tax,
      paid_amount,
      outstanding_amount,
      total_penalties,
      due_at,
      status,
      last_warning_scope,
      last_warning_at,
      penalty_applied_through_date,
      updated_at
    ) values (
      y.id,
      u.id,
      greatest(0::numeric, v_tax),
      0,
      greatest(0::numeric, v_tax),
      0,
      v_due,
      case when coalesce(v_tax, 0) <= 0 then 'paid' else 'pending' end,
      null,
      null,
      null,
      v_now
    )
    on conflict (fiscal_year_id, user_id) do update
    set
      assessed_tax = excluded.assessed_tax,
      paid_amount = 0,
      outstanding_amount = excluded.outstanding_amount,
      total_penalties = 0,
      due_at = excluded.due_at,
      status = excluded.status,
      last_warning_scope = null,
      last_warning_at = null,
      penalty_applied_through_date = null,
      updated_at = v_now;

    v_rows := v_rows + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y.id,
    'profiles_updated', v_rows,
    'sum_assessed_income_tax', round(v_assessed_total, 2),
    'rp_year_sim_hours', v_rp_hours
  );
end;
$$;

comment on function public.admin_fy4_apply_budget_tax_baseline() is
  'Staff (active FY4): sync enacted budget JSON, zero treasury + FY4 outlays + tax events, set paid=0 and assess each profile using marginal tax on (scheduled hourly role+PAC gross × 72 sim-hours), matching the federal bracket RP-year preview — not ledger YTD accruals.';

-- Economy / Treasury "tax preview": same RP-year scheduled basis (not cumulative ledger since FY start).
create or replace function public.fiscal_estimate_ytd_income_tax()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_started timestamptz;
  v_hourly numeric;
  v_rp_year_gross numeric;
  v_brackets jsonb;
  v_tax numeric;
  v_fy_id uuid;
  v_rp_hours int := 72;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select y.id, y.started_at into v_fy_id, v_started
  from public.rp_fiscal_years y
  where y.status = 'active'
  limit 1;

  if v_fy_id is null then
    return jsonb_build_object(
      'fiscal_year_id', null,
      'gross_inflows', 0,
      'estimated_tax', 0,
      'fy_started_at', null,
      'scheduled_hourly_gross', 0,
      'rp_year_sim_hours', v_rp_hours
    );
  end if;

  select coalesce(b.tax_brackets, '[]'::jsonb) into v_brackets
  from public.federal_budgets b
  where b.fiscal_year_id = v_fy_id
  limit 1;

  select (
    public._economy_hourly_from_roles(public._economy_effective_role_keys(v_uid))
    + coalesce(
        (
          select public._economy_pac_hourly(e.level)
          from public.economy_pacs e
          where e.user_id = v_uid
          limit 1
        ),
        0::numeric
      )
  )::numeric
  into v_hourly;

  v_rp_year_gross := round(greatest(0::numeric, coalesce(v_hourly, 0)) * v_rp_hours::numeric, 2);
  v_tax := round(public.fiscal_marginal_tax(v_rp_year_gross, v_brackets), 2);

  return jsonb_build_object(
    'fiscal_year_id', v_fy_id,
    'fy_started_at', v_started,
    'gross_inflows', v_rp_year_gross,
    'estimated_tax', v_tax,
    'scheduled_hourly_gross', round(coalesce(v_hourly, 0), 2),
    'rp_year_sim_hours', v_rp_hours
  );
end;
$$;

comment on function public.fiscal_estimate_ytd_income_tax() is
  'Marginal federal income tax on the signed-in user''s scheduled hourly gross (roles + PAC) annualized with ×72 sim-hours (RP-year planning slice), using the active FY federal budget brackets — matches federal workbook bracket preview; not cumulative ledger hourly_income since FY start.';

notify pgrst, 'reload schema';
