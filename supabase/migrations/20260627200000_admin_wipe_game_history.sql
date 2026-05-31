-- Staff-only full reset: clears elections, congress, economy ledger, fiscal timeline, cabinet/diplomacy,
-- chat, and all role grants. Keeps auth users, profiles (character sheet), regions/districts, and template catalogs.

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

  -- Simulation events (keep templates)
  delete from public.simulation_event_assignments where true;
  delete from public.simulation_event_instances where true;

  -- Leadership caucus sessions
  delete from public.leadership_session_votes;
  delete from public.leadership_session_candidates;
  delete from public.leadership_sessions;

  -- Campaign activity
  delete from public.campaign_ads;
  delete from public.campaign_speeches;
  delete from public.campaign_rallies;
  delete from public.campaign_endorsements;

  -- Elections
  delete from public.general_votes;
  delete from public.primary_votes;
  delete from public.presidential_endorsement_allocations;
  delete from public.election_candidates;
  delete from public.elections;

  -- Congress / executive (before bills)
  delete from public.appointments;
  delete from public.executive_orders;
  delete from public.bill_approval_award_log;
  delete from public.bill_whip_instructions;
  delete from public.bill_amendments;
  delete from public.bill_versions;
  delete from public.bill_votes;
  delete from public.policy_status;
  delete from public.bills;

  -- Offices
  delete from public.government_role_grants;

  -- Economy (keep wallet rows; clear activity)
  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.economy_pacs;
  truncate table public.economy_inventory;

  delete from public.party_treasury_election_grants;
  delete from public.party_officer_votes;
  delete from public.party_officer_candidacies;
  delete from public.party_officers;
  delete from public.party_rule_votes;
  delete from public.party_rule_proposals;
  delete from public.party_national_board_members;

  -- Fiscal / metrics
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

  -- Inbox, calendar log, chat
  delete from public.inbox_items;
  delete from public.simulation_calendar_events;

  if to_regclass('public.world_chat_message_reactions') is not null then
    delete from public.world_chat_message_reactions;
  end if;
  delete from public.world_chat_messages;

  -- Cabinet / diplomacy / defense / court
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

revoke all on function public.admin_wipe_game_history() from public;
grant execute on function public.admin_wipe_game_history() to authenticated;

notify pgrst, 'reload schema';
