-- Legislative round RPCs part 2: rival AI, votes, advance phase, boot hook.

create or replace function public._rival_nominate_leadership(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  rnd record;
  role_key text;
  pick uuid;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into rnd from public.legislative_rounds where id = p_round;

  foreach role_key in array array['speaker', 'house_majority_leader', 'house_minority_leader'] loop
    if exists (
      select 1 from public.legislative_round_leadership lr
      where lr.round_id = p_round and lr.role_key = role_key and lr.party = sim.rival_strategist_party
    ) then continue; end if;
    if role_key = 'house_majority_leader' and rnd.house_majority_party is distinct from sim.rival_strategist_party then continue; end if;
    if role_key = 'house_minority_leader' and rnd.house_majority_party = sim.rival_strategist_party then continue; end if;

    select cm.sim_politician_id into pick
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = 'house' and cm.party = sim.rival_strategist_party
    order by sp.political_capital desc, random() limit 1;

    if pick is not null then
      insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
      values (p_round, role_key, pick, sim.rival_strategist_party);
    end if;
  end loop;
end;
$$;

create or replace function public._resolve_legislative_leadership(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  role_key text;
  winner uuid;
  win_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  perform public._rival_nominate_leadership(p_round);

  foreach role_key in array array['speaker', 'house_majority_leader', 'house_minority_leader'] loop
    winner := null;
    select lr.sim_politician_id, lr.party into winner, win_party
    from public.legislative_round_leadership lr
    join public.sim_politicians sp on sp.id = lr.sim_politician_id
    where lr.round_id = p_round and lr.role_key = role_key
    order by sp.political_capital desc, random() limit 1;

    if winner is null then continue; end if;

    update public.legislative_round_leadership set won = false
    where round_id = p_round and role_key = role_key;
    update public.legislative_round_leadership set won = true
    where round_id = p_round and role_key = role_key and sim_politician_id = winner;

    perform public._apply_sim_politician_capital(winner, 5, 'Leadership win');
    delete from public.sim_government_role_grants where role_key = role_key;
    insert into public.sim_government_role_grants (sim_politician_id, role_key)
    values (winner, role_key)
    on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

    if win_party = sim.human_strategist_party and sim.human_strategist_user_id is not null then
      perform public.apply_political_capital_once(
        sim.human_strategist_user_id, 3, 'Caucus leadership win',
        'leadership_round', p_round::text || ':' || role_key
      );
    elsif win_party = sim.rival_strategist_party then
      update public.simulation_settings
      set rival_strategist_political_capital = rival_strategist_political_capital + 3, updated_at = now()
      where id = 1;
    end if;
  end loop;

  update public.legislative_rounds
  set leadership_resolved = true, phase = 'proposals', last_phase_at = now()
  where id = p_round;
end;
$$;

create or replace function public._rival_propose_round_bill(p_round uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  rnd record;
  sponsor uuid;
  bill_id uuid;
  titles text[] := array['Border Security Act', 'Energy Independence Act', 'Tax Relief Act'];
  bodies text[] := array[
    'Border enforcement surge funding.',
    'Domestic energy permit acceleration.',
    'Middle-class tax bracket adjustment.'
  ];
  idx int;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into rnd from public.legislative_rounds where id = p_round;
  if rnd.rival_proposal_submitted then return null; end if;

  select cm.sim_politician_id into sponsor
  from public.campaign_caucus_members cm
  join public.sim_politicians sp on sp.id = cm.sim_politician_id
  where cm.party = sim.rival_strategist_party and cm.chamber = 'house'
  order by sp.political_capital desc, random() limit 1;
  if sponsor is null then return null; end if;

  idx := 1 + floor(random() * array_length(titles, 1))::int;
  insert into public.legislative_round_bills (
    round_id, party, sponsor_sim_politician_id, title, summary, originating_chamber
  ) values (p_round, sim.rival_strategist_party, sponsor, titles[idx], bodies[idx], 'house')
  returning id into bill_id;

  update public.legislative_rounds set rival_proposal_submitted = true, last_phase_at = now() where id = p_round;
  perform public._rival_strategist_log(
    'bill_filed', format('Rival proposed "%s".', titles[idx]),
    jsonb_build_object('round_id', p_round, 'bill_id', bill_id)
  );
  return bill_id;
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
  bill_id uuid;
  title text := trim(coalesce(p_title, ''));
  body text := trim(coalesce(p_summary, ''));
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase = 'proposals' order by created_at desc limit 1;
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
  returning id into bill_id;

  update public.legislative_rounds
  set human_proposal_submitted = true, active_bill_id = bill_id, last_phase_at = now()
  where id = rnd.id;

  perform public._apply_sim_politician_capital(p_sponsor_sim, 2, 'Filed round bill');
  perform public._rival_propose_round_bill(rnd.id);

  return jsonb_build_object('ok', true, 'bill_id', bill_id);
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
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase = 'proposals' order by created_at desc limit 1;
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
  bill_id uuid;
  vote text := lower(trim(coalesce(p_vote, '')));
  cost numeric := 3;
  my_cap numeric;
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase in ('house_vote', 'senate_vote') order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  bill_id := coalesce(p_bill_id, rnd.active_bill_id);
  if bill_id is null then raise exception 'No active bill'; end if;

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
  ) values (rnd.id, bill_id, p_sim_politician_id, vote, 'whip')
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
  bill_id uuid;
  vote text := lower(trim(coalesce(p_vote, '')));
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  pac_row record;
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;
  if amt < 500000 then raise exception 'Minimum bribe is $500,000 from PAC treasury'; end if;

  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase in ('house_vote', 'senate_vote') order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  bill_id := coalesce(p_bill_id, rnd.active_bill_id);
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
  ) values (rnd.id, bill_id, p_sim_politician_id, vote, 'bribe')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  perform public._rival_strategist_log(
    'bribe', format('Rival detected a $%s cross-aisle contact.', to_char(amt, 'FM999,999,999')),
    jsonb_build_object('amount', amt, 'sim_id', p_sim_politician_id)
  );

  return jsonb_build_object('ok', true, 'amount', amt);
end;
$$;

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
  yeas int := 0;
  nays int := 0;
begin
  select * into bill from public.legislative_round_bills where id = p_bill and round_id = p_round;
  if bill.id is null then raise exception 'Bill not found'; end if;

  for mem in
    select cm.*, sp.party as npc_party
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = p_chamber
  loop
    select vo.vote into vote_val
    from public.legislative_round_vote_overrides vo
    where vo.round_id = p_round and vo.bill_id = p_bill and vo.sim_politician_id = mem.sim_politician_id;

    if vote_val is null then
      if mem.npc_party = bill.party then vote_val := 'yea'; else vote_val := 'nay'; end if;
    end if;

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

  return jsonb_build_object('yeas', yeas, 'nays', nays, 'passed', yeas > nays);
end;
$$;

create or replace function public._rival_whip_caucus(p_round uuid, p_bill uuid, p_chamber text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  bill record;
  mem record;
  target_vote text;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into bill from public.legislative_round_bills where id = p_bill;
  if bill.party = sim.rival_strategist_party then target_vote := 'nay'; else target_vote := 'yea'; end if;

  for mem in
    select cm.sim_politician_id
    from public.campaign_caucus_members cm
    where cm.chamber = p_chamber and cm.party = sim.rival_strategist_party
  loop
    insert into public.legislative_round_vote_overrides (
      round_id, bill_id, sim_politician_id, vote, method
    ) values (p_round, p_bill, mem.sim_politician_id, target_vote, 'rival_whip')
    on conflict (round_id, bill_id, sim_politician_id)
    do update set vote = excluded.vote, method = excluded.method;
  end loop;

  update public.simulation_settings
  set rival_strategist_political_capital = greatest(0, rival_strategist_political_capital - 2), updated_at = now()
  where id = 1;
end;
$$;

create or replace function public._president_control_party()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sim record;
  win_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  select ec.party into win_party
  from public.elections e
  join public.election_candidates ec on ec.election_id = e.id and ec.user_id = e.winner_user_id
  where e.office = 'president' and e.phase = 'closed' and e.winner_user_id is not null
  order by e.general_closes_at desc nulls last limit 1;
  if win_party in ('democrat', 'republican') then return win_party; end if;
  return sim.rival_strategist_party;
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
  bill_id uuid;
  res jsonb;
  pres_party text;
  bill record;
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase <> 'completed' order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No active legislative round'; end if;

  bill_id := rnd.active_bill_id;

  if rnd.phase = 'leadership' then
    perform public._resolve_legislative_leadership(rnd.id);
    return jsonb_build_object('ok', true, 'phase', 'proposals');

  elsif rnd.phase = 'proposals' then
    if not rnd.human_proposal_submitted then raise exception 'Propose your bill first'; end if;
    if not rnd.rival_proposal_submitted then perform public._rival_propose_round_bill(rnd.id); end if;
    if bill_id is null then raise exception 'Select an active bill'; end if;
    delete from public.legislative_round_vote_overrides where round_id = rnd.id and bill_id = bill_id;
    perform public._rival_whip_caucus(rnd.id, bill_id, 'house');
    update public.legislative_rounds set phase = 'house_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'house_vote');

  elsif rnd.phase = 'house_vote' then
    res := public._resolve_chamber_votes(rnd.id, bill_id, 'house');
    if not (res->>'passed')::boolean then
      update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'completed', 'result', 'failed_house', 'tally', res);
    end if;
    delete from public.legislative_round_vote_overrides where round_id = rnd.id and bill_id = bill_id;
    perform public._rival_whip_caucus(rnd.id, bill_id, 'senate');
    update public.legislative_rounds set phase = 'senate_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'senate_vote', 'house', res);

  elsif rnd.phase = 'senate_vote' then
    res := public._resolve_chamber_votes(rnd.id, bill_id, 'senate');
    if not (res->>'passed')::boolean then
      update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
      return jsonb_build_object('ok', true, 'phase', 'completed', 'result', 'failed_senate', 'tally', res);
    end if;
    update public.legislative_rounds set phase = 'presidential', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'presidential', 'senate', res);

  elsif rnd.phase = 'presidential' then
    select * into bill from public.legislative_round_bills where id = bill_id;
    pres_party := public._president_control_party();
    if pres_party = bill.party then
      update public.legislative_round_bills set signed = true where id = bill_id;
      perform public._apply_sim_politician_capital(bill.sponsor_sim_politician_id, 8, 'Law enacted');
      if bill.party = sim.human_strategist_party then
        perform public.apply_political_capital_once(
          sim.human_strategist_user_id, 10, 'Enacted ' || bill.title,
          'round_law', bill_id::text
        );
      else
        update public.simulation_settings set rival_strategist_political_capital = rival_strategist_political_capital + 10 where id = 1;
      end if;
      perform public._rival_strategist_log('law_signed', format('"%s" signed into law.', bill.title), jsonb_build_object('bill_id', bill_id));
    else
      update public.legislative_round_bills set vetoed = true where id = bill_id;
      perform public._rival_strategist_log('law_vetoed', format('"%s" vetoed.', bill.title), jsonb_build_object('bill_id', bill_id));
    end if;
    update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'completed', 'president_party', pres_party, 'signed', pres_party = bill.party);

  else
    raise exception 'Round already completed';
  end if;
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
    last_rival_strategist_tick_at = null,
    updated_at = now()
  where id = 1;

  out := public.bootstrap_campaign_caucus();
  return jsonb_build_object(
    'ok', true, 'human_party', p_human_party, 'rival_party', p_rival_party,
    'caucus', out
  );
end;
$$;

grant execute on function public.bootstrap_campaign_caucus() to authenticated;
grant execute on function public.campaign_legislative_round_status() to authenticated;
grant execute on function public.campaign_start_legislative_round() to authenticated;
grant execute on function public.campaign_nominate_leadership(uuid, text) to authenticated;
grant execute on function public.campaign_propose_round_bill(uuid, text, text) to authenticated;
grant execute on function public.campaign_set_active_round_bill(uuid) to authenticated;
grant execute on function public.campaign_whip_npc(uuid, text, uuid) to authenticated;
grant execute on function public.campaign_bribe_npc(uuid, text, numeric, uuid) to authenticated;
grant execute on function public.campaign_advance_legislative_round() to authenticated;

notify pgrst, 'reload schema';
