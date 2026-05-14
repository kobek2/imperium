-- Staff: wipe transactional economy + all fiscal years (cascades), keep personal wallet balances,
-- then open a single FY 4 with federal budget = enacted FY4 appropriations law (tax brackets + line table)
-- and link that bill + profiles to the new year. Default bill id matches local dev enrolled act.

create or replace function public.admin_reset_economy_fy4_keep_wallets_from_enacted_bill(p_bill_id uuid default '946f2195-3cb6-409a-83c3-edcddb201a6c'::uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bill_id uuid := coalesce(p_bill_id, '946f2195-3cb6-409a-83c3-edcddb201a6c'::uuid);
  b record;
  v_now timestamptz := now();
  v_wallet_sum numeric;
  v_wallet_count int;
  v_fy_id uuid;
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
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may run this reset.';
  end if;

  select * into b
  from public.bills
  where id = v_bill_id
    and coalesce(is_federal_appropriations, false)
    and status = 'law'::public.bill_status
  limit 1;

  if not found then
    raise exception
      'Bill % must exist, be marked federal appropriations, and be signed into law before running this reset.',
      v_bill_id;
  end if;

  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.economy_pacs;
  truncate table public.economy_inventory;

  delete from public.party_treasury_election_grants;

  update public.party_organizations
  set treasury_balance = 0, updated_at = v_now
  where party_key in ('democrat', 'republican');

  update public.federal_treasury
  set balance = 0
  where id = 1;

  delete from public.rp_fiscal_years where status = 'pending_activation';
  delete from public.rp_fiscal_years;

  update public.economy_wallets
  set last_collected_at = v_now - interval '1 hour', updated_at = v_now;

  insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
  select p.id, 0::numeric, v_now - interval '1 hour', v_now
  from public.profiles p
  where not exists (select 1 from public.economy_wallets w where w.user_id = p.id)
  on conflict (user_id) do nothing;

  select coalesce(sum(balance), 0), count(*) into v_wallet_sum, v_wallet_count from public.economy_wallets;

  insert into public.rp_fiscal_years (
    year_index,
    label,
    status,
    started_at,
    closed_at,
    gdp_opening_total,
    gdp_closing_total,
    appropriation_deadline_at,
    appropriations_act_bill_id,
    appropriation_clock_started_at,
    appropriation_window_hours,
    budget_initial_window_ends_at,
    budget_initial_window_missed_at,
    budget_cycle_rp_key,
    tax_due_days_after_close,
    tax_penalty_daily_rate,
    tax_warning_lead_days,
    economy_activity_frozen,
    pending_parent_fiscal_year_id
  )
  values (
    4,
    'FY 4',
    'active',
    v_now,
    null,
    v_wallet_sum,
    null,
    null,
    v_bill_id,
    null,
    24,
    null,
    null,
    null,
    7,
    0.05::numeric,
    2,
    false,
    null
  )
  returning id into v_fy_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    submitted_at,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  )
  values (
    v_fy_id,
    'submitted',
    v_now,
    v_uid,
    v_brackets,
    v_lines,
    '{}'::jsonb,
    v_now
  );

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
    updated_at,
    updated_by
  )
  values (
    v_fy_id,
    null,
    12.3,
    56567,
    0,
    7.6,
    11.7,
    51.9,
    12.3,
    6.4,
    710199,
    87.6,
    80.16,
    42460370,
    1767742,
    70.4,
    41.9,
    v_now,
    v_uid
  );

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
    v_fy_id,
    p.id,
    0,
    0,
    0,
    0,
    v_now + make_interval(days => 7),
    'pending'
  from public.profiles p;

  update public.bills
  set linked_fiscal_year_id = v_fy_id
  where id = v_bill_id;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', v_fy_id,
    'bill_id', v_bill_id,
    'gdp_opening_total', round(v_wallet_sum, 2),
    'wallet_rows', v_wallet_count
  );
end;
$$;

comment on function public.admin_reset_economy_fy4_keep_wallets_from_enacted_bill(uuid) is
  'Staff: truncate economy ledgers/inventory/PACs (not wallet balances), clear party treasuries and federal treasury cash, replace all fiscal years with one active FY4 linked to the enacted appropriations bill, seed federal budget brackets/lines from that law, zero national debt, seed empty income-tax ledger rows.';

grant execute on function public.admin_reset_economy_fy4_keep_wallets_from_enacted_bill(uuid) to authenticated;

notify pgrst, 'reload schema';
