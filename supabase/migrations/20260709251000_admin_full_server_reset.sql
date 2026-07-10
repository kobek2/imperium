-- Full server reset: wipe all game history, reset NYC city sim to biennium 1 / sign-ups,
-- re-anchor RP calendar to January 2032 at reset time, and bootstrap wave-1 elections.

create or replace function public._admin_reset_city_game_state(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  elections_created int := 0;
  budget_id uuid;
begin
  if to_regclass('public.city_ordinance_member_votes') is not null then
    delete from public.city_ordinance_member_votes where true;
  end if;
  if to_regclass('public.city_ordinance_roll_calls') is not null then
    delete from public.city_ordinance_roll_calls where true;
  end if;
  if to_regclass('public.city_ordinance_proposals') is not null then
    delete from public.city_ordinance_proposals where true;
  end if;

  if to_regclass('public.city_budget_member_votes') is not null then
    delete from public.city_budget_member_votes where true;
  end if;
  if to_regclass('public.city_budget_roll_calls') is not null then
    delete from public.city_budget_roll_calls where true;
  end if;
  if to_regclass('public.city_budget_lines') is not null then
    delete from public.city_budget_lines where true;
  end if;
  if to_regclass('public.city_budgets') is not null then
    delete from public.city_budgets where true;
  end if;

  if to_regclass('public.city_mayor_executive_orders') is not null then
    delete from public.city_mayor_executive_orders where true;
  end if;
  if to_regclass('public.city_mayor_public_statements') is not null then
    delete from public.city_mayor_public_statements where true;
  end if;
  if to_regclass('public.city_mayor_department_tasks') is not null then
    delete from public.city_mayor_department_tasks where true;
  end if;
  if to_regclass('public.city_department_reports') is not null then
    delete from public.city_department_reports where true;
  end if;
  if to_regclass('public.city_office_salary_ledger') is not null then
    delete from public.city_office_salary_ledger where true;
  end if;
  if to_regclass('public.city_sim_effect_events') is not null then
    delete from public.city_sim_effect_events where true;
  end if;
  if to_regclass('public.city_metric_history') is not null then
    delete from public.city_metric_history where true;
  end if;

  if to_regclass('public.legislative_round_vote_overrides') is not null then
    delete from public.legislative_round_vote_overrides where true;
  end if;
  if to_regclass('public.legislative_round_bills') is not null then
    delete from public.legislative_round_bills where true;
  end if;
  if to_regclass('public.legislative_rounds') is not null then
    delete from public.legislative_rounds where true;
  end if;

  if to_regclass('public.rival_strategist_actions') is not null then
    delete from public.rival_strategist_actions where true;
  end if;

  update public.wards w
  set
    claimed_by = null,
    incumbent_politician_id = sp.id,
    incumbent_npc_name = sp.character_name
  from public.sim_politicians sp
  where w.city_code = p_city_code
    and sp.office = 'council'
    and sp.ward_code = w.code
    and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end;

  update public.mayor_seat
  set
    incumbent_politician_id = (select id from public.sim_politicians where slug = 'mayor-dem'),
    incumbent_party = 'D'
  where city_code = p_city_code;

  if to_regclass('public.city_department_heads') is not null then
    update public.city_department_heads
    set appointed_by = null, appointed_at = null;

    update public.city_department_heads set sim_politician_id = (select id from public.sim_politicians where slug = 'dept-finance-powell')
      where department_key = 'finance';
    update public.city_department_heads set sim_politician_id = (select id from public.sim_politicians where slug = 'dept-parks-knope')
      where department_key = 'parks';
    update public.city_department_heads set sim_politician_id = (select id from public.sim_politicians where slug = 'dept-planning-mccord')
      where department_key = 'planning';
    update public.city_department_heads set sim_politician_id = (select id from public.sim_politicians where slug = 'dept-police-pope')
      where department_key = 'police';
    update public.city_department_heads set sim_politician_id = (select id from public.sim_politicians where slug = 'dept-public-works-clinton')
      where department_key = 'public_works';
  end if;

  if to_regclass('public.city_fiscal_metrics') is not null then
    update public.city_fiscal_metrics
    set
      population = 0,
      avg_household_income = 0,
      economy_index = 100,
      property_tax_rate_pct = 1.2,
      income_tax_enabled = true,
      income_tax_flat = true,
      income_tax_low_pct = 2.0,
      income_tax_mid_pct = 3.5,
      income_tax_high_pct = 4.5,
      intergovernmental_aid_millions = 0,
      business_tax_rate_pct = 1.5,
      treasury_balance = 0,
      fiscal_year = 1,
      education_quality = 46,
      public_safety = 48,
      housing_affordability = 42,
      mayor_approval = 54,
      public_health = 50,
      infrastructure_quality = 47,
      environment_score = 49,
      sim_tick = 0,
      updated_at = v_now
    where city_code = p_city_code;
  end if;

  if to_regclass('public.city_fiscal_department_allocations') is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = case department_key
      when 'finance' then 0.005
      when 'police' then 0.021
      when 'public_works' then 0.017
      when 'parks' then 0.011
      when 'planning' then 0.007
      else amount_millions
    end
    where city_code = p_city_code;
  end if;

  if to_regclass('public.city_sim_engine_state') is not null then
    insert into public.city_sim_engine_state (
      city_code, sim_tick, sim_year, sim_week, turn_phase, epoch_started_at,
      seed, variables, metrics, effect_queue, pressure_log, shock_cooldowns, recent_shocks, updated_at
    ) values (
      p_city_code,
      0,
      1,
      1,
      'sign_ups_open',
      v_now,
      2864434397,
      jsonb_build_object(
        'school_funding', 50,
        'police_funding', 52,
        'health_clinic_funding', 48,
        'housing_subsidy', 45,
        'infrastructure_capital', 50,
        'environmental_enforcement', 47,
        'business_regulation', 50,
        'community_programs', 48,
        'tax_burden', 50
      ),
      jsonb_build_object(
        'education', 46,
        'crime', 48,
        'economy', 51,
        'public_health', 50,
        'housing', 42,
        'public_trust', 54,
        'infrastructure', 47,
        'environment', 49
      ),
      '[]'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb,
      v_now
    )
    on conflict (city_code) do update set
      sim_tick = 0,
      sim_year = 1,
      sim_week = 1,
      turn_phase = 'sign_ups_open',
      epoch_started_at = v_now,
      variables = excluded.variables,
      metrics = excluded.metrics,
      effect_queue = '[]'::jsonb,
      pressure_log = '{}'::jsonb,
      shock_cooldowns = '{}'::jsonb,
      recent_shocks = '[]'::jsonb,
      updated_at = v_now;
  end if;

  if to_regclass('public._city_open_election_cycle') is not null then
    elections_created := public._city_open_election_cycle(p_city_code, 1, v_now);
  end if;

  if to_regclass('public._rescale_city_budget_to_player_revenue') is not null then
    perform public._rescale_city_budget_to_player_revenue(p_city_code);
  end if;

  if to_regclass('public._city_restore_treasury_from_canonical_budget') is not null then
    budget_id := public._city_restore_treasury_from_canonical_budget(p_city_code);
  end if;

  if to_regclass('public._sync_city_office_salary_pool_column') is not null then
    perform public._sync_city_office_salary_pool_column(p_city_code);
  end if;

  return jsonb_build_object(
    'ok', true,
    'city_code', p_city_code,
    'elections_created', elections_created,
    'canonical_budget_id', budget_id
  );
end;
$$;

revoke all on function public._admin_reset_city_game_state(char) from public;

create or replace function public._admin_full_server_reset_core()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  city_reset jsonb;
begin
  delete from public.simulation_event_assignments where true;
  delete from public.simulation_event_instances where true;

  delete from public.leadership_session_votes where true;
  delete from public.leadership_session_candidates where true;
  delete from public.leadership_sessions where true;

  delete from public.campaign_ads where true;
  delete from public.campaign_speeches where true;
  delete from public.campaign_rallies where true;
  delete from public.campaign_endorsements where true;

  delete from public.general_votes where true;
  delete from public.primary_votes where true;
  delete from public.presidential_endorsement_allocations where true;
  delete from public.election_candidates where true;
  delete from public.elections where true;

  delete from public.appointments where true;
  delete from public.executive_orders where true;
  delete from public.bill_approval_award_log where true;
  delete from public.bill_whip_instructions where true;
  delete from public.bill_amendments where true;
  delete from public.bill_versions where true;
  delete from public.bill_votes where true;
  delete from public.policy_status where true;
  delete from public.bills where true;

  delete from public.government_role_grants where true;

  perform public._admin_truncate_economy_market_state();

  delete from public.party_treasury_election_grants where true;
  delete from public.party_officer_votes where true;
  delete from public.party_officer_candidacies where true;
  delete from public.party_officers where true;
  delete from public.party_rule_votes where true;
  delete from public.party_rule_proposals where true;
  delete from public.party_national_board_members where true;

  delete from public.fiscal_tax_events where true;
  delete from public.fiscal_tax_accounts where true;
  delete from public.fiscal_year_close_summaries where true;
  delete from public.fiscal_tax_settlements where true;
  delete from public.federal_budgets where true;
  delete from public.national_metrics_change_log where true;
  delete from public.national_metrics where true;

  if to_regclass('public.federal_treasury_outlays') is not null then
    execute 'delete from public.federal_treasury_outlays where true';
  end if;

  delete from public.rp_fiscal_years where true;

  update public.federal_treasury set balance = 0 where id = 1;

  delete from public.inbox_items where true;
  delete from public.simulation_calendar_events where true;

  if to_regclass('public.world_chat_message_reactions') is not null then
    execute 'delete from public.world_chat_message_reactions where true';
  end if;
  delete from public.world_chat_messages where true;

  if to_regclass('public.rp_diplomatic_sessions') is not null then
    execute 'delete from public.rp_diplomatic_sessions where true';
  end if;
  if to_regclass('public.rp_court_cases') is not null then
    execute 'delete from public.rp_court_cases where true';
  end if;
  if to_regclass('public.cabinet_daily_hours') is not null then
    execute 'delete from public.cabinet_daily_hours where true';
  end if;
  if to_regclass('public.cabinet_weekly_hours') is not null then
    execute 'delete from public.cabinet_weekly_hours where true';
  end if;
  if to_regclass('public.rp_cabinet_department_metrics') is not null then
    execute 'delete from public.rp_cabinet_department_metrics where true';
  end if;
  if to_regclass('public.rp_defense_procurement_obligations') is not null then
    execute 'delete from public.rp_defense_procurement_obligations where true';
  end if;
  if to_regclass('public.rp_defense_theater_posture') is not null then
    execute 'delete from public.rp_defense_theater_posture where true';
  end if;
  if to_regclass('public.rp_foreign_nations') is not null then
    execute 'delete from public.rp_foreign_nations where true';
  end if;
  if to_regclass('public.rp_daily_counters') is not null then
    execute 'delete from public.rp_daily_counters where true';
  end if;

  if to_regclass('public.hall_of_fame_entries') is not null then
    execute 'delete from public.hall_of_fame_entries where true';
  end if;

  if to_regclass('public.political_capital_award_log') is not null then
    delete from public.political_capital_award_log where true;
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
    political_capital = 0,
    political_capital_history = '[]'::jsonb,
    former_positions = null,
    updated_at = v_now
  where true;

  update public.economy_wallets
  set balance = 0, last_collected_at = v_now - interval '1 hour', updated_at = v_now
  where true;

  insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
  select p.id, 0, v_now - interval '1 hour', v_now
  from public.profiles p
  on conflict (user_id) do nothing;

  city_reset := public._admin_reset_city_game_state('MB');

  perform public.bootstrap_campaign_caucus();
  perform public.sync_campaign_council_caucus();

  update public.simulation_settings
  set
    simulation_start_at = v_now,
    calendar_seat_cycle_freeze_rp_year = null,
    calendar_seat_cycle_freeze_rp_month = null,
    calendar_is_active = true,
    calendar_auto_congress_elections = false,
    auto_open_filings_in_rp_january = false,
    campaign_manager_turn = 1,
    campaign_manager_cycle = 1,
    last_rival_cycle_refill = 0,
    last_rival_election_tick_at = null,
    last_rival_congress_tick_at = null,
    last_rival_daily_refill_cst_date = null,
    rival_strategist_treasury = 25000000,
    rival_strategist_political_capital = 0,
    updated_at = v_now
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'wiped_at', v_now,
    'rp_calendar_start', v_now,
    'city', city_reset,
    'message',
      'Full server reset complete. All game history cleared; NYC city sim at Year 1 / sign-ups open; RP calendar re-anchored to January 2032 and active.'
  );
end;
$$;

revoke all on function public._admin_full_server_reset_core() from public;

create or replace function public.admin_wipe_game_history()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may wipe game history.';
  end if;

  return public._admin_full_server_reset_core();
end;
$$;

grant execute on function public.admin_wipe_game_history() to authenticated;

-- Fresh season launch: apply reset when this migration ships.
select public._admin_full_server_reset_core();

notify pgrst, 'reload schema';
