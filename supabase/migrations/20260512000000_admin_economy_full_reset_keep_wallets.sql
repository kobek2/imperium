-- Full simulation economy reset: personal wallet balances preserved; everything else fiscal/economy-ish starts clean at FY1.

create or replace function public.admin_economy_full_reset_keep_wallets()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fy1_id uuid;
  v_gdp numeric;
  v_wallet_count int;
  v_seed_brackets jsonb :=
    '[
      {"ceiling":20000,"rate":0},
      {"ceiling":50000,"rate":0.025},
      {"ceiling":100000,"rate":0.05},
      {"ceiling":200000,"rate":0.15},
      {"ceiling":null,"rate":0.405}
    ]'::jsonb;
  v_seed_lines jsonb :=
    '[
      {"key":"infrastructure","label":"Infrastructure and Transportation","minimum":600000,"allocated":600000},
      {"key":"education","label":"Education","minimum":500000,"allocated":500000},
      {"key":"healthcare","label":"Healthcare","minimum":700000,"allocated":700000},
      {"key":"defense","label":"Defense and National Security","minimum":650000,"allocated":650000},
      {"key":"social_welfare","label":"Social Welfare Programs","minimum":450000,"allocated":450000},
      {"key":"environment","label":"Environmental Protection","minimum":200000,"allocated":200000},
      {"key":"economic_development","label":"Economic Development and Job Creation","minimum":600000,"allocated":600000},
      {"key":"science_tech","label":"Science and Technology Research","minimum":200000,"allocated":200000},
      {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","minimum":100000,"allocated":100000},
      {"key":"relief","label":"Relief Funds","minimum":100000,"allocated":100000}
    ]'::jsonb;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff admins may run a full economy reset.';
  end if;

  select y.id into v_fy1_id
  from public.rp_fiscal_years y
  where y.year_index = 1
  order by y.started_at asc
  limit 1
  for update;

  if v_fy1_id is null then
    raise exception 'FY 1 (year_index = 1) does not exist.';
  end if;

  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.economy_pacs;
  truncate table public.economy_inventory;

  delete from public.party_treasury_election_grants;

  update public.party_organizations
  set treasury_balance = 0, updated_at = now()
  where party_key in ('democrat', 'republican');

  update public.federal_treasury
  set balance = 0
  where id = 1;

  delete from public.rp_fiscal_years where year_index > 1;

  delete from public.fiscal_tax_accounts where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_tax_settlements where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_year_close_summaries where fiscal_year_id = v_fy1_id;

  update public.economy_wallets
  set
    last_collected_at = now() - interval '1 hour',
    updated_at = now();

  insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
  select p.id, 0::numeric, now() - interval '1 hour', now()
  from public.profiles p
  where not exists (select 1 from public.economy_wallets w where w.user_id = p.id)
  on conflict (user_id) do nothing;

  select coalesce(sum(balance), 0), count(*) into v_gdp, v_wallet_count from public.economy_wallets;

  update public.rp_fiscal_years
  set
    status = 'active',
    label = 'FY 1',
    started_at = now(),
    closed_at = null,
    gdp_opening_total = v_gdp,
    gdp_closing_total = null,
    appropriations_act_bill_id = null,
    economy_activity_frozen = false,
    appropriation_deadline_at = now() + interval '24 hours',
    appropriation_clock_started_at = now()
  where id = v_fy1_id;

  delete from public.federal_budgets where fiscal_year_id = v_fy1_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    submitted_at,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  ) values (
    v_fy1_id,
    'submitted',
    now(),
    v_uid,
    v_seed_brackets,
    v_seed_lines,
    '{}'::jsonb,
    now()
  );

  delete from public.national_metrics where fiscal_year_id = v_fy1_id;

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
  ) values (
    v_fy1_id,
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
    now(),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', v_fy1_id,
    'gdp_opening_total', v_gdp,
    'wallet_rows', v_wallet_count
  );
end;
$$;

grant execute on function public.admin_economy_full_reset_keep_wallets() to authenticated;

notify pgrst, 'reload schema';
