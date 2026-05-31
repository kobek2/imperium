-- Supabase SQL editor / safety policies require WHERE on DELETE (and sometimes UPDATE).

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

  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.economy_pacs;
  truncate table public.economy_inventory;

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
    updated_at = v_now
  where true;

  update public.economy_wallets
  set balance = 0, last_collected_at = v_now - interval '1 hour', updated_at = v_now
  where true;

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
