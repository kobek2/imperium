-- Political capital: cumulative career influence from election wins and enacted legislation.

alter table public.profiles
  add column if not exists political_capital numeric not null default 0 check (political_capital >= 0);

alter table public.profiles
  add column if not exists political_capital_history jsonb not null default '[]'::jsonb;

comment on column public.profiles.political_capital is
  'Cumulative career influence earned from election wins, leadership victories, and bills signed into law.';
comment on column public.profiles.political_capital_history is
  'JSON array of {date, delta, reason, new_value, source_kind, source_id}.';

create table if not exists public.political_capital_award_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  points numeric not null check (points > 0),
  reason text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, source_kind, source_id)
);

create index if not exists political_capital_award_log_user_idx
  on public.political_capital_award_log (user_id, awarded_at desc);

alter table public.political_capital_award_log enable row level security;

drop policy if exists "political_capital_award_log read authed" on public.political_capital_award_log;
create policy "political_capital_award_log read authed"
  on public.political_capital_award_log for select to authenticated using (true);

create or replace function public.apply_political_capital_once(
  p_user_id uuid,
  p_points numeric,
  p_reason text,
  p_source_kind text,
  p_source_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pts numeric := round(greatest(coalesce(p_points, 0), 0), 2);
  cur numeric;
  newv numeric;
  hist jsonb;
  inserted int;
begin
  if p_user_id is null or pts <= 0 then
    return false;
  end if;

  insert into public.political_capital_award_log (user_id, source_kind, source_id, points, reason)
  values (p_user_id, p_source_kind, p_source_id, pts, left(coalesce(p_reason, ''), 500))
  on conflict do nothing;

  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;
  end if;

  select coalesce(political_capital, 0), coalesce(political_capital_history, '[]'::jsonb)
  into cur, hist
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  newv := cur + pts;
  hist := hist || jsonb_build_array(
    jsonb_build_object(
      'date', to_jsonb(now()),
      'delta', pts,
      'reason', left(coalesce(p_reason, ''), 500),
      'new_value', newv,
      'source_kind', p_source_kind,
      'source_id', p_source_id
    )
  );

  update public.profiles
  set political_capital = newv,
      political_capital_history = hist,
      updated_at = now()
  where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.apply_political_capital_once(uuid, numeric, text, text, text) from public;
grant execute on function public.apply_political_capital_once(uuid, numeric, text, text, text) to authenticated, service_role;

create or replace function public._award_political_capital_for_election(p_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  mate uuid;
  pts numeric;
  seat_label text;
begin
  select id, office, state, district_code, phase, winner_user_id, leadership_role
  into race
  from public.elections
  where id = p_election;

  if not found or race.phase <> 'closed'::public.election_phase or race.winner_user_id is null then
    return;
  end if;

  if race.leadership_role is not null then
    perform public.apply_political_capital_once(
      race.winner_user_id,
      20,
      'Won ' || replace(race.leadership_role, '_', ' ') || ' leadership election',
      'election_win',
      p_election::text || ':leadership'
    );
    return;
  end if;

  case race.office
    when 'house' then
      pts := 15;
      seat_label := coalesce(race.district_code, race.state, 'House seat');
    when 'senate' then
      pts := 25;
      seat_label := coalesce(race.state, 'Senate seat');
    else
      pts := 50;
      seat_label := 'Presidency';
  end case;

  perform public.apply_political_capital_once(
    race.winner_user_id,
    pts,
    'Won ' || seat_label || ' (' || race.office || ')',
    'election_win',
    p_election::text || ':' || race.office
  );

  if race.office = 'president' then
    select ec.running_mate_user_id into mate
    from public.election_candidates ec
    where ec.election_id = p_election
      and ec.user_id = race.winner_user_id
    limit 1;

    if mate is not null then
      perform public.apply_political_capital_once(
        mate,
        30,
        'Elected Vice President',
        'election_win',
        p_election::text || ':vice_president'
      );
    end if;
  end if;
end;
$$;

create or replace function public._trg_award_political_capital_election()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.roles_applied_at is null and new.roles_applied_at is not null then
    perform public._award_political_capital_for_election(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists award_political_capital_on_election_roles_applied on public.elections;
create trigger award_political_capital_on_election_roles_applied
  after update of roles_applied_at on public.elections
  for each row
  execute function public._trg_award_political_capital_election();

create or replace function public._trg_award_political_capital_bill_law()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pts numeric;
begin
  if new.status is distinct from 'law'::public.bill_status then
    return new;
  end if;
  if old.status = 'law'::public.bill_status then
    return new;
  end if;
  if new.author_id is null then
    return new;
  end if;

  pts := case when coalesce(new.is_federal_appropriations, false) then 15 else 10 end;

  perform public.apply_political_capital_once(
    new.author_id,
    pts,
    'Bill signed into law: ' || left(coalesce(new.title, 'Untitled'), 200),
    'bill_law',
    new.id::text
  );

  return new;
end;
$$;

drop trigger if exists award_political_capital_on_bill_law on public.bills;
create trigger award_political_capital_on_bill_law
  after update of status on public.bills
  for each row
  execute function public._trg_award_political_capital_bill_law();

-- Backfill closed elections that already had roles applied.
do $$
declare
  eid uuid;
begin
  for eid in
    select e.id
    from public.elections e
    where e.phase = 'closed'::public.election_phase
      and e.roles_applied_at is not null
      and e.winner_user_id is not null
  loop
    perform public._award_political_capital_for_election(eid);
  end loop;
end $$;

-- Backfill enacted bills.
do $$
declare
  bid uuid;
  auth uuid;
  pts numeric;
begin
  for bid, auth, pts in
    select b.id, b.author_id,
      case when coalesce(b.is_federal_appropriations, false) then 15 else 10 end
    from public.bills b
    where b.status = 'law'::public.bill_status
      and b.author_id is not null
  loop
    perform public.apply_political_capital_once(
      auth,
      pts,
      'Bill signed into law (backfill)',
      'bill_law',
      bid::text
    );
  end loop;
end $$;

-- Reset political capital on full game wipe.
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
