-- Campaign Manager: turn-based cycle (5 congress turns + 10 election turns) replaces CST 12h blocks.

alter table public.simulation_settings
  add column if not exists campaign_manager_turn smallint not null default 1
    check (campaign_manager_turn between 1 and 15),
  add column if not exists campaign_manager_cycle integer not null default 1
    check (campaign_manager_cycle >= 1),
  add column if not exists last_rival_cycle_refill integer not null default 0;

alter table public.legislative_rounds
  add column if not exists campaign_cycle integer,
  add column if not exists campaign_turn smallint;

update public.legislative_rounds r
set
  campaign_cycle = coalesce(r.campaign_cycle, 1),
  campaign_turn = coalesce(r.campaign_turn, (select campaign_manager_turn from public.simulation_settings where id = 1))
where r.campaign_cycle is null or r.campaign_turn is null;

drop index if exists public.legislative_rounds_one_active_cst_date;
create unique index if not exists legislative_rounds_one_active_per_turn
  on public.legislative_rounds (campaign_cycle, campaign_turn)
  where phase <> 'completed';

create or replace function public._campaign_congress_turns()
returns integer
language sql
immutable
set search_path = public
as $$ select 5; $$;

create or replace function public._campaign_election_turns()
returns integer
language sql
immutable
set search_path = public
as $$ select 10; $$;

create or replace function public._campaign_cycle_turns()
returns integer
language sql
immutable
set search_path = public
as $$ select public._campaign_congress_turns() + public._campaign_election_turns(); $$;

create or replace function public._campaign_manager_phase_from_turn(p_turn integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_turn <= public._campaign_congress_turns() then 'congress'
    else 'elections'
  end;
$$;

create or replace function public._campaign_manager_cst_phase()
returns text
language sql
stable
set search_path = public
as $$
  select public._campaign_manager_phase_from_turn(
    coalesce((select campaign_manager_turn from public.simulation_settings where id = 1), 1)
  );
$$;

create or replace function public._campaign_manager_turn_in_phase(p_turn integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_turn <= public._campaign_congress_turns() then p_turn
    else p_turn - public._campaign_congress_turns()
  end;
$$;

create or replace function public._campaign_manager_cycle_refill()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  floor_amt numeric;
  allowance numeric;
  new_treasury numeric;
begin
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then return; end if;
  if sim.last_rival_cycle_refill >= sim.campaign_manager_cycle then return; end if;

  floor_amt := case sim.rival_strategist_difficulty
    when 'passive' then 15000000
    when 'aggressive' then 35000000
    else 25000000
  end;
  allowance := coalesce(sim.rival_daily_treasury_allowance, 5000000) * 3;

  new_treasury := greatest(coalesce(sim.rival_strategist_treasury, 0), floor_amt * 0.4) + allowance;

  update public.simulation_settings
  set
    rival_strategist_treasury = new_treasury,
    last_rival_cycle_refill = sim.campaign_manager_cycle,
    updated_at = now()
  where id = 1;

  perform public._rival_strategist_log(
    'daily_refill',
    format('Rival war chest replenished to $%s for cycle %s.', to_char(new_treasury, 'FM999,999,999,990'), sim.campaign_manager_cycle),
    jsonb_build_object('treasury', new_treasury, 'allowance', allowance, 'cycle', sim.campaign_manager_cycle)
  );
end;
$$;

create or replace function public._campaign_manager_daily_refill()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._campaign_manager_cycle_refill();
end;
$$;

create or replace function public._require_human_strategist()
returns public.simulation_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_manager_active is not true then raise exception 'Campaign Manager season is not active'; end if;
  if sim.human_strategist_user_id is distinct from v_uid then
    raise exception 'Only the enrolled party strategist may act';
  end if;
  if public._campaign_manager_cst_phase() <> 'congress' then
    raise exception 'Congress actions are only available during congress turns (1–% of each cycle)', public._campaign_congress_turns();
  end if;
  return sim;
end;
$$;

create or replace function public.campaign_advance_turn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  v_uid uuid := auth.uid();
  old_turn int;
  old_phase text;
  new_turn int;
  new_cycle int;
  new_phase text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true then raise exception 'Campaign Manager season is not active'; end if;
  if sim.human_strategist_user_id is distinct from v_uid then
    raise exception 'Only the enrolled party strategist may advance the turn';
  end if;

  old_turn := sim.campaign_manager_turn;
  old_phase := public._campaign_manager_phase_from_turn(old_turn);

  if old_phase = 'congress' and exists (
    select 1 from public.legislative_rounds r
    where r.campaign_cycle = sim.campaign_manager_cycle
      and r.campaign_turn = sim.campaign_manager_turn
      and r.phase <> 'completed'
  ) then
    raise exception 'Complete the legislative round for this congress turn before advancing';
  end if;

  new_turn := old_turn + 1;
  new_cycle := sim.campaign_manager_cycle;
  if new_turn > public._campaign_cycle_turns() then
    new_turn := 1;
    new_cycle := new_cycle + 1;
  end if;
  new_phase := public._campaign_manager_phase_from_turn(new_turn);

  update public.simulation_settings
  set
    campaign_manager_turn = new_turn,
    campaign_manager_cycle = new_cycle,
    updated_at = now()
  where id = 1;

  if new_cycle > sim.campaign_manager_cycle then
    perform public._campaign_manager_cycle_refill();
  end if;

  if old_phase = 'elections' then
    perform public._rival_strategist_election_tick(false);
  else
    perform public._rival_strategist_congress_tick();
  end if;

  perform public._rival_strategist_log(
    'round_advance',
    format(
      'Turn advanced — cycle %s, turn %s/%s (%s).',
      new_cycle, new_turn, public._campaign_cycle_turns(), new_phase
    ),
    jsonb_build_object('cycle', new_cycle, 'turn', new_turn, 'phase', new_phase)
  );

  return jsonb_build_object(
    'ok', true,
    'cycle', new_cycle,
    'turn', new_turn,
    'phase', new_phase,
    'turn_in_phase', public._campaign_manager_turn_in_phase(new_turn),
    'turns_in_phase', case when new_phase = 'congress' then public._campaign_congress_turns() else public._campaign_election_turns() end
  );
end;
$$;

create or replace function public.campaign_manager_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  pac_row record;
  is_human boolean := false;
  phase text;
  turn int;
  cycle int;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then return jsonb_build_object('active', false); end if;

  is_human := v_uid is not null and sim.human_strategist_user_id = v_uid;
  turn := coalesce(sim.campaign_manager_turn, 1);
  cycle := coalesce(sim.campaign_manager_cycle, 1);
  phase := public._campaign_manager_phase_from_turn(turn);

  if v_uid is not null then
    select * into pac_row from public.economy_pacs where user_id = v_uid;
  end if;

  return jsonb_build_object(
    'active', coalesce(sim.campaign_manager_active, false),
    'human_party', sim.human_strategist_party,
    'human_strategist_user_id', sim.human_strategist_user_id,
    'is_human_strategist', is_human,
    'rival_enabled', coalesce(sim.rival_strategist_enabled, false),
    'rival_party', sim.rival_strategist_party,
    'rival_treasury', coalesce(sim.rival_strategist_treasury, 0),
    'rival_label', sim.rival_strategist_label,
    'rival_difficulty', sim.rival_strategist_difficulty,
    'starter_grant', coalesce(sim.campaign_manager_starter_pac_grant, 0),
    'my_pac_treasury', coalesce(pac_row.treasury_balance, 0),
    'my_pac_name', pac_row.pac_name,
    'cst_phase', phase,
    'election_window', phase = 'elections',
    'congress_window', phase = 'congress',
    'campaign_turn', turn,
    'campaign_cycle', cycle,
    'turn_in_phase', public._campaign_manager_turn_in_phase(turn),
    'congress_turns', public._campaign_congress_turns(),
    'election_turns', public._campaign_election_turns(),
    'cycle_turns', public._campaign_cycle_turns()
  );
end;
$$;

create or replace function public.campaign_legislative_round_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  rnd record;
  my_cap numeric := 0;
  turn int;
  cycle int;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then return jsonb_build_object('active', false); end if;
  turn := coalesce(sim.campaign_manager_turn, 1);
  cycle := coalesce(sim.campaign_manager_cycle, 1);
  if v_uid is not null then
    select coalesce(political_capital, 0) into my_cap from public.profiles where id = v_uid;
  end if;
  select * into rnd from public.legislative_rounds r
  where r.campaign_cycle = cycle and r.campaign_turn = turn and r.phase <> 'completed'
  order by r.created_at desc limit 1;

  return jsonb_build_object(
    'season_active', coalesce(sim.campaign_manager_active, false),
    'cst_phase', public._campaign_manager_cst_phase(),
    'campaign_cycle', cycle,
    'campaign_turn', turn,
    'round_id', rnd.id,
    'round_phase', rnd.phase,
    'active_bill_id', rnd.active_bill_id,
    'leadership_resolved', coalesce(rnd.leadership_resolved, false),
    'human_proposal_submitted', coalesce(rnd.human_proposal_submitted, false),
    'rival_proposal_submitted', coalesce(rnd.rival_proposal_submitted, false),
    'house_majority_party', rnd.house_majority_party,
    'my_political_capital', my_cap,
    'rival_political_capital', coalesce(sim.rival_strategist_political_capital, 0),
    'caucus_count', (select count(*)::int from public.campaign_caucus_members)
  );
end;
$$;

create or replace function public.campaign_start_legislative_round()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd_id uuid;
  dem_h int;
  rep_h int;
  maj text;
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  if (select count(*) from public.campaign_caucus_members) < 4 then
    perform public.bootstrap_campaign_caucus();
  end if;
  if exists (
    select 1 from public.legislative_rounds r
    where r.campaign_cycle = sim.campaign_manager_cycle
      and r.campaign_turn = sim.campaign_manager_turn
      and r.phase <> 'completed'
  ) then
    raise exception 'A legislative round is already in progress this turn';
  end if;

  select
    count(*) filter (where party = sim.human_strategist_party),
    count(*) filter (where party = sim.rival_strategist_party)
  into dem_h, rep_h
  from public.campaign_caucus_members where chamber = 'house';

  if sim.human_strategist_party = 'democrat' then
    maj := case when dem_h > rep_h then 'democrat' when rep_h > dem_h then 'republican' else null end;
  else
    maj := case when rep_h > dem_h then 'republican' when dem_h > rep_h then 'democrat' else null end;
  end if;

  insert into public.legislative_rounds (cst_date, campaign_cycle, campaign_turn, phase, house_majority_party)
  values (cst, sim.campaign_manager_cycle, sim.campaign_manager_turn, 'leadership', maj)
  returning id into rnd_id;

  perform public._rival_strategist_log(
    'round_advance', 'Legislative round opened — nominate caucus leadership.',
    jsonb_build_object('round_id', rnd_id, 'cycle', sim.campaign_manager_cycle, 'turn', sim.campaign_manager_turn)
  );
  return jsonb_build_object('ok', true, 'round_id', rnd_id, 'phase', 'leadership');
end;
$$;

create or replace function public.campaign_manager_boot_season(
  p_human_party text default 'democrat',
  p_rival_party text default 'republican',
  p_starter_grant numeric default 25000000,
  p_rival_treasury numeric default 25000000,
  p_difficulty text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  out jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;
  if p_human_party not in ('democrat', 'republican') then raise exception 'Invalid human party'; end if;
  if p_rival_party not in ('democrat', 'republican') then raise exception 'Invalid rival party'; end if;
  if p_human_party = p_rival_party then raise exception 'Parties must differ'; end if;

  update public.simulation_settings set
    campaign_manager_active = true,
    human_strategist_party = p_human_party,
    human_strategist_user_id = null,
    rival_strategist_enabled = true,
    rival_strategist_party = p_rival_party,
    rival_strategist_treasury = greatest(coalesce(p_rival_treasury, 0), 0),
    rival_strategist_political_capital = 25,
    rival_strategist_difficulty = p_difficulty,
    rival_strategist_label = case p_rival_party when 'democrat' then 'Democratic War Room (AI)' else 'Republican War Room (AI)' end,
    campaign_manager_starter_pac_grant = greatest(coalesce(p_starter_grant, 0), 0),
    campaign_manager_turn = 1,
    campaign_manager_cycle = 1,
    last_rival_cycle_refill = 0,
    last_rival_strategist_tick_at = null,
    updated_at = now()
  where id = 1;

  out := public.bootstrap_campaign_caucus();
  return jsonb_build_object(
    'ok', true, 'human_party', p_human_party, 'rival_party', p_rival_party,
    'caucus', out, 'turn', 1, 'cycle', 1, 'phase', 'congress'
  );
end;
$$;

-- Patch legislative RPCs to key rounds by campaign cycle + turn (not CST date).

create or replace function public.campaign_nominate_leadership(p_sim_politician_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  v_role_key text := lower(trim(coalesce(p_role, '')));
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase = 'leadership'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No round in leadership phase'; end if;
  if v_role_key not in ('speaker', 'house_majority_leader', 'house_minority_leader') then
    raise exception 'Invalid leadership role';
  end if;
  select * into mem from public.campaign_caucus_members
  where sim_politician_id = p_sim_politician_id and chamber = 'house';
  if mem.sim_politician_id is null then raise exception 'Not a house caucus member'; end if;
  if mem.party <> sim.human_strategist_party then raise exception 'Nominee must be from your party'; end if;
  if v_role_key = 'house_majority_leader' and rnd.house_majority_party is distinct from sim.human_strategist_party then
    raise exception 'Your party is not the House majority';
  end if;
  if v_role_key = 'house_minority_leader' and rnd.house_majority_party = sim.human_strategist_party then
    raise exception 'Your party is not the House minority';
  end if;

  delete from public.legislative_round_leadership lr
  where lr.round_id = rnd.id and lr.role_key = v_role_key and lr.party = sim.human_strategist_party;
  insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
  values (rnd.id, v_role_key, p_sim_politician_id, sim.human_strategist_party);
  return jsonb_build_object('ok', true, 'role', v_role_key);
end;
$$;

create or replace function public.campaign_propose_round_bill(
  p_sponsor_sim uuid,
  p_title text,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  v_bill_id uuid;
  title text := trim(coalesce(p_title, ''));
  body text := trim(coalesce(p_summary, ''));
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase = 'proposals'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No round in proposals phase'; end if;
  if rnd.human_proposal_submitted then raise exception 'You already proposed a bill this round'; end if;

  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sponsor_sim;
  if mem.sim_politician_id is null or mem.party <> sim.human_strategist_party then
    raise exception 'Invalid sponsor';
  end if;
  if char_length(title) < 5 then raise exception 'Title too short'; end if;
  if char_length(body) < 10 then raise exception 'Summary too short'; end if;

  insert into public.legislative_round_bills (
    round_id, party, sponsor_sim_politician_id, title, summary, originating_chamber
  ) values (rnd.id, sim.human_strategist_party, p_sponsor_sim, title, body, 'house')
  returning id into v_bill_id;

  update public.legislative_rounds
  set human_proposal_submitted = true, active_bill_id = v_bill_id, last_phase_at = now()
  where id = rnd.id;

  perform public._apply_sim_politician_capital(p_sponsor_sim, 2, 'Filed round bill');
  perform public._rival_propose_round_bill(rnd.id);

  return jsonb_build_object('ok', true, 'bill_id', v_bill_id);
end;
$$;

create or replace function public.campaign_set_active_round_bill(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  bill record;
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase = 'proposals'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in proposals phase'; end if;

  select * into bill from public.legislative_round_bills
  where id = p_bill_id and round_id = rnd.id;
  if bill.id is null then raise exception 'Bill not found in this round'; end if;

  update public.legislative_rounds set active_bill_id = p_bill_id, last_phase_at = now() where id = rnd.id;
  return jsonb_build_object('ok', true, 'bill_id', p_bill_id);
end;
$$;

create or replace function public.campaign_whip_npc(
  p_sim_politician_id uuid,
  p_vote text,
  p_bill_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  v_bill_id uuid;
  vote text := lower(trim(coalesce(p_vote, '')));
  cost numeric := 3;
  my_cap numeric;
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase in ('house_vote', 'senate_vote')
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  v_bill_id := coalesce(p_bill_id, rnd.active_bill_id);
  if v_bill_id is null then raise exception 'No active bill'; end if;

  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sim_politician_id;
  if mem.sim_politician_id is null then raise exception 'Not in caucus'; end if;

  select coalesce(political_capital, 0) into my_cap from public.profiles where id = sim.human_strategist_user_id;
  if mem.party = sim.human_strategist_party then
    if my_cap < cost then raise exception 'Need % political capital to whip', cost; end if;
    update public.profiles set political_capital = political_capital - cost where id = sim.human_strategist_user_id;
  else
    cost := 12;
    if my_cap < cost then raise exception 'Need % political capital to flip a rival', cost; end if;
    if (select political_capital from public.sim_politicians where id = p_sim_politician_id) > 15 then
      raise exception 'Target has too much capital to flip easily';
    end if;
    update public.profiles set political_capital = political_capital - cost where id = sim.human_strategist_user_id;
  end if;

  insert into public.legislative_round_vote_overrides (
    round_id, bill_id, sim_politician_id, vote, method
  ) values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'whip')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  perform public._rival_strategist_log(
    'whip', 'Rival intel: you whipped a caucus member.',
    jsonb_build_object('sim_id', p_sim_politician_id, 'vote', vote)
  );

  return jsonb_build_object('ok', true, 'cost', cost);
end;
$$;

create or replace function public.campaign_bribe_npc(
  p_sim_politician_id uuid,
  p_vote text,
  p_amount numeric,
  p_bill_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  sp record;
  v_bill_id uuid;
  vote text := lower(trim(coalesce(p_vote, '')));
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  pac_row record;
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;
  if amt < 500000 then raise exception 'Minimum bribe is $500,000 from PAC treasury'; end if;

  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase in ('house_vote', 'senate_vote')
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  v_bill_id := coalesce(p_bill_id, rnd.active_bill_id);
  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sim_politician_id;
  if mem.sim_politician_id is null then raise exception 'Not in caucus'; end if;
  if mem.party = sim.human_strategist_party then raise exception 'Use whip on your own caucus'; end if;

  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.whip_loyalty > 85 and sp.political_capital > 12 then
    raise exception 'Target is too loyal to bribe';
  end if;

  select * into pac_row from public.economy_pacs where user_id = sim.human_strategist_user_id for update;
  if pac_row.treasury_balance < amt then raise exception 'Insufficient PAC treasury'; end if;

  update public.economy_pacs set treasury_balance = treasury_balance - amt, updated_at = now()
  where user_id = sim.human_strategist_user_id;

  insert into public.legislative_round_vote_overrides (
    round_id, bill_id, sim_politician_id, vote, method
  ) values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'bribe')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  perform public._rival_strategist_log(
    'bribe', format('Rival detected a $%s cross-aisle contact.', to_char(amt, 'FM999,999,999')),
    jsonb_build_object('amount', amt, 'sim_id', p_sim_politician_id)
  );

  return jsonb_build_object('ok', true, 'amount', amt);
end;
$$;

create or replace function public.campaign_advance_legislative_round()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  v_bill_id uuid;
  res jsonb;
  pres_party text;
  bill record;
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase <> 'completed'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No active legislative round'; end if;

  v_bill_id := rnd.active_bill_id;

  if rnd.phase = 'leadership' then
    perform public._resolve_legislative_leadership(rnd.id);
    return jsonb_build_object('ok', true, 'phase', 'proposals');

  elsif rnd.phase = 'proposals' then
    if not rnd.human_proposal_submitted then raise exception 'Propose your bill first'; end if;
    if not rnd.rival_proposal_submitted then perform public._rival_propose_round_bill(rnd.id); end if;
    if v_bill_id is null then raise exception 'Select an active bill'; end if;
    delete from public.legislative_round_vote_overrides vo
    where vo.round_id = rnd.id and vo.bill_id = v_bill_id;
    perform public._rival_whip_caucus(rnd.id, v_bill_id, 'house');
    update public.legislative_rounds set phase = 'house_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'house_vote');

  elsif rnd.phase = 'house_vote' then
    res := public._resolve_chamber_votes(rnd.id, v_bill_id, 'house');
    if not (res->>'passed')::boolean then
      update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'completed', 'result', 'failed_house', 'tally', res);
    end if;
    delete from public.legislative_round_vote_overrides vo
    where vo.round_id = rnd.id and vo.bill_id = v_bill_id;
    perform public._rival_whip_caucus(rnd.id, v_bill_id, 'senate');
    update public.legislative_rounds set phase = 'senate_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'senate_vote', 'house', res);

  elsif rnd.phase = 'senate_vote' then
    res := public._resolve_chamber_votes(rnd.id, v_bill_id, 'senate');
    if not (res->>'passed')::boolean then
      update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'completed', 'result', 'failed_senate', 'tally', res);
    end if;
    update public.legislative_rounds set phase = 'presidential', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'presidential', 'senate', res);

  elsif rnd.phase = 'presidential' then
    select * into bill from public.legislative_round_bills where id = v_bill_id;
    pres_party := public._president_control_party();
    if pres_party = bill.party then
      update public.legislative_round_bills set signed = true where id = v_bill_id;
      perform public._apply_sim_politician_capital(bill.sponsor_sim_politician_id, 8, 'Law enacted');
      if bill.party = sim.human_strategist_party then
        perform public.apply_political_capital_once(
          sim.human_strategist_user_id, 10, 'Enacted ' || bill.title,
          'round_law', v_bill_id::text
        );
      else
        update public.simulation_settings set rival_strategist_political_capital = rival_strategist_political_capital + 10 where id = 1;
      end if;
      perform public._rival_strategist_log('law_signed', format('"%s" signed into law.', bill.title), jsonb_build_object('bill_id', v_bill_id));
    else
      update public.legislative_round_bills set vetoed = true where id = v_bill_id;
      perform public._rival_strategist_log('law_vetoed', format('"%s" vetoed.', bill.title), jsonb_build_object('bill_id', v_bill_id));
    end if;
    update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'completed', 'president_party', pres_party, 'signed', pres_party = bill.party);

  else
    raise exception 'Round already completed';
  end if;
end;
$$;

create or replace function public.campaign_manager_file_bill(
  p_title text,
  p_content_md text,
  p_chamber text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  title text := trim(coalesce(p_title, ''));
  body text := trim(coalesce(p_content_md, ''));
  chamber public.bill_chamber;
  new_id uuid;
  sponsor text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public._campaign_manager_cst_phase() <> 'congress' then
    raise exception 'Strategist legislation is only available during congress turns (1–% of each cycle)', public._campaign_congress_turns();
  end if;

  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_manager_active is not true then raise exception 'Campaign Manager season is not active'; end if;
  if sim.human_strategist_user_id is distinct from v_uid then
    raise exception 'Only the enrolled party strategist may file war-room legislation';
  end if;
  if (select party from public.profiles where id = v_uid) is distinct from sim.human_strategist_party then
    raise exception 'Party mismatch';
  end if;

  if title = '' or char_length(title) < 5 then raise exception 'Title must be at least 5 characters'; end if;
  if body = '' or char_length(body) < 20 then raise exception 'Bill text must be at least 20 characters'; end if;

  if lower(trim(p_chamber)) = 'house' then chamber := 'house';
  elsif lower(trim(p_chamber)) = 'senate' then chamber := 'senate';
  else raise exception 'Invalid chamber';
  end if;

  select sp.character_name into sponsor
  from public.campaign_caucus_members cm
  join public.sim_politicians sp on sp.id = cm.sim_politician_id
  where cm.party = sim.human_strategist_party and cm.chamber = 'house'
  order by sp.political_capital desc limit 1;

  insert into public.bills (
    title, content_md, originating_chamber, status,
    filed_by_party_strategist, strategist_party, strategist_sponsor_label
  ) values (
    title, body, chamber, 'introduced',
    true, sim.human_strategist_party,
    coalesce(sponsor, 'Democratic Caucus') || ' (D)'
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'bill_id', new_id);
end;
$$;

grant execute on function public.campaign_advance_turn() to authenticated;
