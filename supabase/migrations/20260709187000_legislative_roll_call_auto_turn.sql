-- Roll call persistence, caucus vote assignment (free) vs PAC convince (rivals),
-- auto-advance campaign turn when a legislative round completes.

create table if not exists public.legislative_round_roll_calls (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.legislative_rounds (id) on delete cascade,
  bill_id uuid not null references public.legislative_round_bills (id) on delete cascade,
  chamber text not null check (chamber in ('house', 'senate')),
  sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  vote text not null check (vote in ('yea', 'nay')),
  method text not null check (method in ('caucus_line', 'assigned', 'convince', 'rival_whip')),
  created_at timestamptz not null default now(),
  unique (round_id, bill_id, chamber, sim_politician_id)
);

alter table public.legislative_round_roll_calls enable row level security;
drop policy if exists "legislative_round_roll_calls read" on public.legislative_round_roll_calls;
create policy "legislative_round_roll_calls read" on public.legislative_round_roll_calls
  for select to authenticated using (true);

create index if not exists legislative_round_roll_calls_round_bill_idx
  on public.legislative_round_roll_calls (round_id, bill_id, chamber);

create or replace function public._resolve_chamber_votes(
  p_round uuid,
  p_bill uuid,
  p_chamber text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bill record;
  mem record;
  vote_val text;
  vote_method text;
  yeas int := 0;
  nays int := 0;
  roll jsonb := '[]'::jsonb;
begin
  select * into bill from public.legislative_round_bills where id = p_bill and round_id = p_round;
  if bill.id is null then raise exception 'Bill not found'; end if;

  delete from public.legislative_round_roll_calls rc
  where rc.round_id = p_round and rc.bill_id = p_bill and rc.chamber = p_chamber;

  for mem in
    select cm.sim_politician_id, cm.chamber, sp.party as npc_party, sp.character_name
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = p_chamber
    order by cm.sort_order
  loop
    select vo.vote, vo.method into vote_val, vote_method
    from public.legislative_round_vote_overrides vo
    where vo.round_id = p_round and vo.bill_id = p_bill and vo.sim_politician_id = mem.sim_politician_id;

    if vote_val is null then
      if mem.npc_party = bill.party then
        vote_val := 'yea';
        vote_method := 'caucus_line';
      else
        vote_val := 'nay';
        vote_method := 'caucus_line';
      end if;
    elsif vote_method = 'whip' then
      vote_method := 'assigned';
    elsif vote_method = 'bribe' then
      vote_method := 'convince';
    elsif vote_method = 'rival_whip' then
      vote_method := 'rival_whip';
    else
      vote_method := coalesce(vote_method, 'assigned');
    end if;

    insert into public.legislative_round_roll_calls (
      round_id, bill_id, chamber, sim_politician_id, vote, method
    ) values (p_round, p_bill, p_chamber, mem.sim_politician_id, vote_val, vote_method);

    roll := roll || jsonb_build_object(
      'sim_id', mem.sim_politician_id,
      'name', mem.character_name,
      'party', mem.npc_party,
      'vote', vote_val,
      'method', vote_method
    );

    if vote_val = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
  end loop;

  if p_chamber = 'house' then
    update public.legislative_round_bills
    set house_yeas = yeas, house_nays = nays, house_passed = (yeas > nays)
    where id = p_bill;
  else
    update public.legislative_round_bills
    set senate_yeas = yeas, senate_nays = nays, senate_passed = (yeas > nays)
    where id = p_bill;
  end if;

  return jsonb_build_object(
    'yeas', yeas,
    'nays', nays,
    'passed', yeas > nays,
    'chamber', p_chamber,
    'roll_call', roll
  );
end;
$$;

create or replace function public._campaign_auto_advance_turn_internal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  old_turn int;
  old_phase text;
  new_turn int;
  new_cycle int;
  new_phase text;
begin
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.id is null or sim.campaign_manager_active is not true then
    return jsonb_build_object('ok', false, 'skipped', true);
  end if;

  old_turn := sim.campaign_manager_turn;
  old_phase := public._campaign_manager_phase_from_turn(old_turn);

  new_turn := old_turn + 1;
  new_cycle := sim.campaign_manager_cycle;
  if new_turn > public._campaign_cycle_turns() then
    new_turn := 1;
    new_cycle := new_cycle + 1;
  end if;
  new_phase := public._campaign_manager_phase_from_turn(new_turn);

  update public.simulation_settings
  set campaign_manager_turn = new_turn, campaign_manager_cycle = new_cycle, updated_at = now()
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
    format('Congress turn complete — now cycle %s, turn %s/%s (%s).', new_cycle, new_turn, public._campaign_cycle_turns(), new_phase),
    jsonb_build_object('cycle', new_cycle, 'turn', new_turn, 'phase', new_phase, 'auto', true)
  );

  return jsonb_build_object(
    'ok', true,
    'turn_advanced', true,
    'cycle', new_cycle,
    'turn', new_turn,
    'phase', new_phase
  );
end;
$$;

create or replace function public._campaign_finish_legislative_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  turn_out jsonb;
begin
  update public.legislative_rounds
  set phase = 'completed', completed_at = now(), last_phase_at = now()
  where id = p_round_id;

  turn_out := public._campaign_auto_advance_turn_internal();
  return jsonb_build_object('ok', true, 'phase', 'completed', 'turn', turn_out);
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
  if mem.party <> sim.human_strategist_party then
    raise exception 'You control your own caucus for free — use PAC payments to convince rival members';
  end if;

  insert into public.legislative_round_vote_overrides (
    round_id, bill_id, sim_politician_id, vote, method
  ) values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'whip')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  return jsonb_build_object('ok', true, 'vote', vote, 'cost', 0);
end;
$$;

create or replace function public.campaign_assign_all_caucus(
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
  assigned int := 0;
  vote_chamber text;
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
  vote_chamber := case when rnd.phase = 'senate_vote' then 'senate' else 'house' end;

  for mem in
    select cm.sim_politician_id
    from public.campaign_caucus_members cm
    where cm.party = sim.human_strategist_party and cm.chamber = vote_chamber
  loop
    insert into public.legislative_round_vote_overrides (
      round_id, bill_id, sim_politician_id, vote, method
    ) values (rnd.id, v_bill_id, mem.sim_politician_id, vote, 'whip')
    on conflict (round_id, bill_id, sim_politician_id)
    do update set vote = excluded.vote, method = excluded.method;
    assigned := assigned + 1;
  end loop;

  return jsonb_build_object('ok', true, 'assigned', assigned, 'vote', vote);
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
  max_flips int;
  loyalty_gate numeric;
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;
  if amt < 500000 then raise exception 'Minimum PAC payment is $500,000 to convince a rival member'; end if;

  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase in ('house_vote', 'senate_vote')
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  v_bill_id := coalesce(p_bill_id, rnd.active_bill_id);
  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sim_politician_id;
  if mem.sim_politician_id is null then raise exception 'Not in caucus'; end if;
  if mem.party = sim.human_strategist_party then
    raise exception 'Your caucus votes are free to assign — use Assign vote instead';
  end if;

  max_flips := case when coalesce(sim.campaign_manager_cycle, 1) <= 1 then 1 else 2 end;
  if rnd.cross_aisle_flips >= max_flips then
    raise exception 'Cross-aisle convince limit reached this round (max %)', max_flips;
  end if;

  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  loyalty_gate := 48 + coalesce(sim.campaign_manager_cycle, 1) * 4;
  if sp.whip_loyalty > loyalty_gate and sp.political_capital > (10 + coalesce(sim.campaign_manager_cycle, 1)) then
    raise exception 'Target is too loyal — try a different member or wait until later in the season';
  end if;

  select * into pac_row from public.economy_pacs where user_id = sim.human_strategist_user_id for update;
  if pac_row.treasury_balance < amt then raise exception 'Insufficient PAC treasury'; end if;

  update public.economy_pacs set treasury_balance = treasury_balance - amt, updated_at = now()
  where user_id = sim.human_strategist_user_id;

  update public.legislative_rounds set cross_aisle_flips = cross_aisle_flips + 1 where id = rnd.id;

  insert into public.legislative_round_vote_overrides (
    round_id, bill_id, sim_politician_id, vote, method
  ) values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'bribe')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  perform public._rival_strategist_log(
    'bribe', format('Rival detected a $%s cross-aisle contact.', to_char(amt, 'FM999,999,999')),
    jsonb_build_object('amount', amt, 'sim_id', p_sim_politician_id)
  );

  return jsonb_build_object('ok', true, 'amount', amt, 'vote', vote);
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
  v_next_bill uuid;
  res jsonb;
  pres_party text;
  bill record;
  lobbied boolean;
  finish jsonb;
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
    v_bill_id := public._first_docket_bill(rnd.id);
    if v_bill_id is null then raise exception 'No bills on docket'; end if;
    update public.legislative_rounds set active_bill_id = v_bill_id, last_phase_at = now() where id = rnd.id;
    delete from public.legislative_round_vote_overrides vo where vo.round_id = rnd.id and vo.bill_id = v_bill_id;
    perform public._rival_whip_caucus(rnd.id, v_bill_id, 'house');
    update public.legislative_rounds set phase = 'house_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'house_vote', 'bill_id', v_bill_id);

  elsif rnd.phase = 'house_vote' then
    res := public._resolve_chamber_votes(rnd.id, v_bill_id, 'house');
    delete from public.legislative_round_vote_overrides vo where vo.round_id = rnd.id and vo.bill_id = v_bill_id;
    perform public._rival_whip_caucus(rnd.id, v_bill_id, 'senate');
    update public.legislative_rounds set phase = 'senate_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'senate_vote', 'house', res);

  elsif rnd.phase = 'senate_vote' then
    res := public._resolve_chamber_votes(rnd.id, v_bill_id, 'senate');
    v_next_bill := public._next_docket_bill(rnd.id, v_bill_id);
    if v_next_bill is not null then
      update public.legislative_rounds set active_bill_id = v_next_bill, phase = 'house_vote', last_phase_at = now() where id = rnd.id;
      delete from public.legislative_round_vote_overrides vo where vo.round_id = rnd.id and vo.bill_id = v_next_bill;
      perform public._rival_whip_caucus(rnd.id, v_next_bill, 'house');
      return jsonb_build_object('ok', true, 'phase', 'house_vote', 'senate', res, 'next_bill', v_next_bill);
    end if;
    v_next_bill := public._next_presidential_bill(rnd.id, null);
    if v_next_bill is not null then
      update public.legislative_rounds set active_bill_id = v_next_bill, phase = 'presidential', last_phase_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'presidential', 'senate', res);
    end if;
    finish := public._campaign_finish_legislative_round(rnd.id);
    return finish || jsonb_build_object('senate', res, 'result', 'no_laws_enacted');

  elsif rnd.phase = 'presidential' then
    select * into bill from public.legislative_round_bills where id = v_bill_id;
    pres_party := public._campaign_president_party();
    lobbied := bill.summary like '%[Oval Office pressure applied]%';

    if bill.house_passed and bill.senate_passed then
      if pres_party = bill.party or (lobbied and random() < 0.35) then
        update public.legislative_round_bills set signed = true where id = v_bill_id;
        perform public._apply_sim_politician_capital(bill.sponsor_sim_politician_id, 8, 'Law enacted');
        if bill.party = sim.human_strategist_party then
          perform public.apply_political_capital_once(
            sim.human_strategist_user_id, 10, 'Enacted ' || bill.title, 'round_law', v_bill_id::text
          );
        else
          update public.simulation_settings set rival_strategist_political_capital = rival_strategist_political_capital + 10 where id = 1;
        end if;
        perform public._rival_strategist_log('law_signed', format('"%s" signed into law.', bill.title), jsonb_build_object('bill_id', v_bill_id));
      else
        update public.legislative_round_bills set vetoed = true where id = v_bill_id;
        perform public._rival_strategist_log('law_vetoed', format('"%s" vetoed.', bill.title), jsonb_build_object('bill_id', v_bill_id));
      end if;
    end if;

    v_next_bill := public._next_presidential_bill(rnd.id, v_bill_id);
    if v_next_bill is not null then
      update public.legislative_rounds set active_bill_id = v_next_bill, last_phase_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'presidential', 'next_bill', v_next_bill);
    end if;

    finish := public._campaign_finish_legislative_round(rnd.id);
    return finish || jsonb_build_object('president_party', pres_party);

  else
    raise exception 'Round already completed';
  end if;
end;
$$;

grant execute on function public.campaign_assign_all_caucus(text, uuid) to authenticated;

notify pgrst, 'reload schema';
