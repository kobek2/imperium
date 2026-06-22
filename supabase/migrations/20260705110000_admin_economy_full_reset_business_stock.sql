-- Economy activity wipe helper + fix admin_economy_full_reset_keep_wallets (broken refs to dropped pac_organizations).

create or replace function public._admin_truncate_economy_market_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.bills') is not null then
    update public.bills set lobby_offer_id = null where lobby_offer_id is not null;
  end if;

  if to_regclass('public.pac_coordinations') is not null then
    truncate table public.pac_coordinations;
  end if;
  if to_regclass('public.pac_contributions') is not null then
    truncate table public.pac_contributions;
  end if;
  if to_regclass('public.corruption_deals') is not null then
    truncate table public.corruption_deals;
  end if;
  if to_regclass('public.blackmail_demands') is not null then
    truncate table public.blackmail_demands;
  end if;
  if to_regclass('public.corruption_ledger') is not null then
    truncate table public.corruption_ledger;
  end if;
  if to_regclass('public.investigation_cooldowns') is not null then
    truncate table public.investigation_cooldowns;
  end if;
  if to_regclass('public.npc_campaign_actions') is not null then
    truncate table public.npc_campaign_actions;
  end if;
  if to_regclass('public.campaign_ads') is not null then
    truncate table public.campaign_ads;
  end if;
  if to_regclass('public.company_bill_positions') is not null then
    truncate table public.company_bill_positions;
  end if;
  if to_regclass('public.company_lobby_offers') is not null then
    truncate table public.company_lobby_offers;
  end if;
  if to_regclass('public.market_event_companies') is not null then
    truncate table public.market_event_companies;
  end if;
  if to_regclass('public.stock_trade_history') is not null then
    truncate table public.stock_trade_history;
  end if;
  if to_regclass('public.stock_trades') is not null then
    truncate table public.stock_trades;
  end if;
  if to_regclass('public.stock_holdings') is not null then
    truncate table public.stock_holdings;
  end if;
  if to_regclass('public.business_price_history') is not null then
    truncate table public.business_price_history;
  end if;
  if to_regclass('public.businesses') is not null then
    truncate table public.businesses;
  end if;
  if to_regclass('public.market_events') is not null then
    truncate table public.market_events;
  end if;
  if to_regclass('public.sector_market_stats') is not null then
    truncate table public.sector_market_stats;
  end if;

  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.economy_pacs;
  truncate table public.economy_inventory;
end;
$$;

revoke all on function public._admin_truncate_economy_market_state() from public;

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

  perform public._admin_truncate_economy_market_state();

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

-- FY4 scripted reset: same market/PAC wipe, preserve enacted-bill seeding.
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

  perform public._admin_truncate_economy_market_state();

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

grant execute on function public.admin_reset_economy_fy4_keep_wallets_from_enacted_bill(uuid) to authenticated;

create or replace function public.admin_wipe_game_history()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may wipe game history.';
  end if;

  delete from public.simulation_event_assignments where true;
  delete from public.simulation_event_instances where true;

  delete from public.leadership_session_votes;
  delete from public.leadership_session_candidates;
  delete from public.leadership_sessions;

  delete from public.campaign_speeches;
  delete from public.campaign_rallies;
  delete from public.campaign_endorsements;

  delete from public.general_votes;
  delete from public.primary_votes;
  delete from public.presidential_endorsement_allocations;
  delete from public.election_candidates;
  delete from public.elections;

  delete from public.appointments;
  delete from public.executive_orders;
  delete from public.bill_approval_award_log;
  delete from public.bill_whip_instructions;
  delete from public.bill_amendments;
  delete from public.bill_versions;
  delete from public.bill_votes;
  delete from public.policy_status;
  delete from public.bills;

  delete from public.government_role_grants;

  perform public._admin_truncate_economy_market_state();

  delete from public.party_treasury_election_grants;
  delete from public.party_officer_votes;
  delete from public.party_officer_candidacies;
  delete from public.party_officers;
  delete from public.party_rule_votes;
  delete from public.party_rule_proposals;
  delete from public.party_national_board_members;

  delete from public.fiscal_tax_events;
  delete from public.fiscal_tax_accounts;
  delete from public.fiscal_year_close_summaries;
  delete from public.fiscal_tax_settlements;
  delete from public.federal_budgets;
  delete from public.national_metrics_change_log;
  delete from public.national_metrics;

  if to_regclass('public.federal_treasury_outlays') is not null then
    delete from public.federal_treasury_outlays;
  end if;

  delete from public.rp_fiscal_years;

  update public.federal_treasury set balance = 0 where id = 1;

  delete from public.inbox_items;
  delete from public.simulation_calendar_events;

  if to_regclass('public.world_chat_message_reactions') is not null then
    delete from public.world_chat_message_reactions;
  end if;
  delete from public.world_chat_messages;

  if to_regclass('public.rp_diplomatic_sessions') is not null then
    delete from public.rp_diplomatic_sessions;
  end if;
  if to_regclass('public.rp_court_cases') is not null then
    delete from public.rp_court_cases;
  end if;
  if to_regclass('public.cabinet_daily_hours') is not null then
    delete from public.cabinet_daily_hours;
  end if;
  if to_regclass('public.cabinet_weekly_hours') is not null then
    delete from public.cabinet_weekly_hours;
  end if;
  if to_regclass('public.rp_cabinet_department_metrics') is not null then
    delete from public.rp_cabinet_department_metrics;
  end if;
  if to_regclass('public.rp_defense_procurement_obligations') is not null then
    delete from public.rp_defense_procurement_obligations;
  end if;
  if to_regclass('public.rp_defense_theater_posture') is not null then
    delete from public.rp_defense_theater_posture;
  end if;
  if to_regclass('public.rp_foreign_nations') is not null then
    delete from public.rp_foreign_nations;
  end if;
  if to_regclass('public.rp_daily_counters') is not null then
    delete from public.rp_daily_counters;
  end if;

  if to_regclass('public.hall_of_fame_entries') is not null then
    delete from public.hall_of_fame_entries;
  end if;

  update public.districts set claimed_by = null where claimed_by is not null;

  update public.party_organizations
  set treasury_balance = 0, updated_at = v_now
  where party_key in ('democrat', 'republican');

  update public.profiles
  set
    office_role = null,
    approval_rating = 50,
    approval_history = '[]'::jsonb,
    former_positions = null,
    updated_at = v_now;

  update public.economy_wallets
  set balance = 0, last_collected_at = v_now - interval '1 hour', updated_at = v_now;

  insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
  select p.id, 0, v_now - interval '1 hour', v_now
  from public.profiles p
  on conflict (user_id) do nothing;

  update public.simulation_settings
  set
    calendar_is_active = false,
    calendar_auto_congress_elections = false,
    updated_at = v_now
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'wiped_at', v_now,
    'message', 'All game history wiped. Characters and regions remain; offices, elections, bills, ledger, and fiscal years cleared.'
  );
end;
$$;

notify pgrst, 'reload schema';
