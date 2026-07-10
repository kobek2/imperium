-- Millbrook council legislative round: single-chamber council_vote + mayoral phases,
-- council caucus of 7, council spokesperson election with party-line NPC votes,
-- campaign phase renamed congress → council.

-- ---------- Extend constraints for council chamber ----------

alter table public.campaign_caucus_members drop constraint if exists campaign_caucus_members_chamber_check;
alter table public.campaign_caucus_members add constraint campaign_caucus_members_chamber_check
  check (chamber in ('house', 'senate', 'council'));

alter table public.legislative_rounds drop constraint if exists legislative_rounds_phase_check;
alter table public.legislative_rounds add constraint legislative_rounds_phase_check check (phase in (
  'leadership', 'proposals', 'council_vote', 'mayoral', 'completed',
  'house_vote', 'senate_vote', 'presidential'
));

alter table public.legislative_round_leadership drop constraint if exists legislative_round_leadership_role_key_check;
alter table public.legislative_round_leadership add constraint legislative_round_leadership_role_key_check check (
  role_key in ('council_spokesperson', 'speaker', 'house_majority_leader', 'house_minority_leader')
);

alter table public.legislative_round_roll_calls drop constraint if exists legislative_round_roll_calls_chamber_check;
alter table public.legislative_round_roll_calls add constraint legislative_round_roll_calls_chamber_check
  check (chamber in ('house', 'senate', 'council'));

-- ---------- Campaign phase: council instead of congress ----------

create or replace function public._campaign_congress_turns()
returns integer language sql immutable set search_path = public as $$ select 5; $$;

create or replace function public._campaign_council_turns()
returns integer language sql immutable set search_path = public as $$ select public._campaign_congress_turns(); $$;

create or replace function public._campaign_manager_phase_from_turn(p_turn integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_turn <= public._campaign_council_turns() then 'council'
    else 'elections'
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
  if public._campaign_manager_cst_phase() <> 'council' then
    raise exception 'Council session actions are only available during council turns';
  end if;
  return sim;
end;
$$;

-- ---------- Council caucus bootstrap (7 ward incumbents) ----------

create or replace function public.bootstrap_campaign_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_caucus_members where true;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'council', sp.party, w.code, row_number() over (order by w.code)::smallint
  from public.wards w
  join public.sim_politicians sp on sp.id = w.incumbent_politician_id
  where w.city_code = 'MB'
  order by w.code;

  if (select count(*) from public.campaign_caucus_members) < 7 then
    insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
    select sp.id, 'council', sp.party, w.code, (10 + row_number() over (order by w.code))::smallint
    from public.wards w
    join public.sim_politicians sp on sp.ward_code = w.code and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end
    where w.city_code = 'MB'
      and not exists (
        select 1 from public.campaign_caucus_members cm where cm.sim_politician_id = sp.id
      )
    order by w.code;
  end if;

  return jsonb_build_object('ok', true, 'members', (select count(*)::int from public.campaign_caucus_members));
end;
$$;

-- ---------- Campaign mayor NPC (replaces president for city sim) ----------

create or replace function public._ensure_campaign_mayor()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  mayor_id uuid;
  mayor_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_mayor_sim_id is not null then return sim.campaign_mayor_sim_id; end if;

  select ms.incumbent_politician_id, case ms.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end
    into mayor_id, mayor_party
  from public.mayor_seat ms where ms.city_code = 'MB';

  if mayor_id is null then
    select sp.id, sp.party into mayor_id, mayor_party
    from public.sim_politicians sp where sp.office = 'mayor' order by sp.political_capital desc limit 1;
  end if;

  if mayor_id is not null then
    update public.simulation_settings set campaign_mayor_sim_id = mayor_id, updated_at = now() where id = 1;
    delete from public.sim_government_role_grants g where g.role_key = 'mayor';
    insert into public.sim_government_role_grants (sim_politician_id, role_key)
    values (mayor_id, 'mayor')
    on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;
  end if;

  return mayor_id;
end;
$$;

create or replace function public._campaign_mayor_party()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sim record;
  party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_mayor_sim_id is not null then
    select sp.party into party from public.sim_politicians sp where sp.id = sim.campaign_mayor_sim_id;
    if party in ('democrat', 'republican') then return party; end if;
  end if;
  select case ms.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' else 'democrat' end
    into party from public.mayor_seat ms where ms.city_code = 'MB';
  return coalesce(party, 'democrat');
end;
$$;

-- ---------- Council spokesperson leadership (party-line vote) ----------

create or replace function public._rival_nominate_leadership(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  pick uuid;
begin
  select * into sim from public.simulation_settings where id = 1;

  if exists (
    select 1 from public.legislative_round_leadership lr
    where lr.round_id = p_round and lr.role_key = 'council_spokesperson' and lr.party = sim.rival_strategist_party
  ) then return; end if;

  select cm.sim_politician_id into pick
  from public.campaign_caucus_members cm
  join public.sim_politicians sp on sp.id = cm.sim_politician_id
  where cm.chamber = 'council' and cm.party = sim.rival_strategist_party
  order by sp.political_capital desc, random() limit 1;

  if pick is not null then
    insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
    values (p_round, 'council_spokesperson', pick, sim.rival_strategist_party);
  end if;
end;
$$;

create or replace function public._resolve_council_spokesperson_votes(p_round uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mem record;
  nom record;
  vote_counts jsonb := '{}'::jsonb;
  winner_id uuid;
  winner_votes int := 0;
  v int;
  nom_party text;
begin
  for mem in
    select cm.sim_politician_id, sp.party as voter_party
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = 'council'
    order by cm.sort_order
  loop
    select lr.sim_politician_id, lr.party into nom
    from public.legislative_round_leadership lr
    where lr.round_id = p_round and lr.role_key = 'council_spokesperson' and lr.party = mem.voter_party
    limit 1;

    if nom.sim_politician_id is null then continue; end if;
    if public._npc_party_line_vote(mem.voter_party, null, nom.party) <> 'yea' then continue; end if;

    v := coalesce((vote_counts->>nom.sim_politician_id::text)::int, 0) + 1;
    vote_counts := vote_counts || jsonb_build_object(nom.sim_politician_id::text, v);
    if v > winner_votes then
      winner_votes := v;
      winner_id := nom.sim_politician_id;
      nom_party := nom.party;
    elsif v = winner_votes and winner_id is not null then
      select sp.id into winner_id
      from public.sim_politicians sp
      where sp.id in (winner_id, nom.sim_politician_id)
      order by sp.political_capital desc, random() limit 1;
    end if;
  end loop;

  if winner_id is null then
    select lr.sim_politician_id into winner_id
    from public.legislative_round_leadership lr
    join public.sim_politicians sp on sp.id = lr.sim_politician_id
    where lr.round_id = p_round and lr.role_key = 'council_spokesperson'
    order by sp.political_capital desc, random() limit 1;
  end if;

  return winner_id;
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
  winner uuid;
  win_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  perform public._rival_nominate_leadership(p_round);

  winner := public._resolve_council_spokesperson_votes(p_round);
  if winner is null then
    update public.legislative_rounds set leadership_resolved = true, phase = 'proposals', last_phase_at = now()
    where id = p_round;
    return;
  end if;

  select party into win_party from public.sim_politicians where id = winner;

  update public.legislative_round_leadership lr set won = false
  where lr.round_id = p_round and lr.role_key = 'council_spokesperson';
  update public.legislative_round_leadership lr set won = true
  where lr.round_id = p_round and lr.role_key = 'council_spokesperson' and lr.sim_politician_id = winner;

  perform public._apply_sim_politician_capital(winner, 5, 'Council Spokesperson win');
  delete from public.sim_government_role_grants g where g.role_key = 'council_spokesperson';
  insert into public.sim_government_role_grants (sim_politician_id, role_key)
  values (winner, 'council_spokesperson')
  on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

  if win_party = sim.human_strategist_party and sim.human_strategist_user_id is not null then
    perform public.apply_political_capital_once(
      sim.human_strategist_user_id, 3, 'Council spokesperson win',
      'leadership_round', p_round::text || ':council_spokesperson'
    );
  elsif win_party = sim.rival_strategist_party then
    update public.simulation_settings
    set rival_strategist_political_capital = rival_strategist_political_capital + 3, updated_at = now()
    where id = 1;
  end if;

  update public.legislative_rounds
  set leadership_resolved = true, phase = 'proposals', last_phase_at = now()
  where id = p_round;
end;
$$;

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
  if v_role_key not in ('council_spokesperson', 'speaker', 'house_majority_leader', 'house_minority_leader') then
    raise exception 'Invalid leadership role';
  end if;
  v_role_key := 'council_spokesperson';

  select * into mem from public.campaign_caucus_members
  where sim_politician_id = p_sim_politician_id and chamber = 'council';
  if mem.sim_politician_id is null then raise exception 'Not a council caucus member'; end if;
  if mem.party <> sim.human_strategist_party then raise exception 'Nominee must be from your party'; end if;

  delete from public.legislative_round_leadership lr
  where lr.round_id = rnd.id and lr.role_key = v_role_key and lr.party = sim.human_strategist_party;
  insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
  values (rnd.id, v_role_key, p_sim_politician_id, sim.human_strategist_party);
  return jsonb_build_object('ok', true, 'role', v_role_key);
end;
$$;

-- ---------- Chamber vote resolution (council) ----------

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
  effective_chamber text := case when p_chamber in ('house', 'council') then coalesce(nullif(p_chamber, 'house'), 'council') else p_chamber end;
begin
  if p_chamber = 'house' then effective_chamber := 'council'; end if;

  select * into bill from public.legislative_round_bills where id = p_bill and round_id = p_round;
  if bill.id is null then raise exception 'Bill not found'; end if;

  delete from public.legislative_round_roll_calls rc
  where rc.round_id = p_round and rc.bill_id = p_bill and rc.chamber = effective_chamber;

  for mem in
    select cm.sim_politician_id, cm.chamber, sp.party as npc_party, sp.character_name
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = 'council'
    order by cm.sort_order
  loop
    select vo.vote, vo.method into vote_val, vote_method
    from public.legislative_round_vote_overrides vo
    where vo.round_id = p_round and vo.bill_id = p_bill and vo.sim_politician_id = mem.sim_politician_id;

    if vote_val is null then
      vote_val := public._npc_party_line_vote(mem.npc_party, bill.party);
      vote_method := 'caucus_line';
    elsif vote_method = 'whip' then vote_method := 'assigned';
    elsif vote_method = 'bribe' then vote_method := 'convince';
    else vote_method := coalesce(vote_method, 'assigned');
    end if;

    insert into public.legislative_round_roll_calls (
      round_id, bill_id, chamber, sim_politician_id, vote, method
    ) values (p_round, p_bill, effective_chamber, mem.sim_politician_id, vote_val, vote_method);

    roll := roll || jsonb_build_object(
      'sim_id', mem.sim_politician_id, 'name', mem.character_name,
      'party', mem.npc_party, 'vote', vote_val, 'method', vote_method
    );

    if vote_val = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
  end loop;

  update public.legislative_round_bills
  set house_yeas = yeas, house_nays = nays, house_passed = (yeas > nays),
      senate_yeas = yeas, senate_nays = nays, senate_passed = (yeas > nays)
  where id = p_bill;

  return jsonb_build_object('yeas', yeas, 'nays', nays, 'passed', yeas > nays, 'chamber', effective_chamber, 'roll_call', roll);
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
  vote_val text;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into bill from public.legislative_round_bills where id = p_bill;
  if bill.id is null then return; end if;

  for mem in
    select cm.sim_politician_id, sp.party
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = 'council' and cm.party = sim.rival_strategist_party
  loop
    vote_val := public._npc_party_line_vote(mem.party, bill.party);
    insert into public.legislative_round_vote_overrides (round_id, bill_id, sim_politician_id, vote, method)
    values (p_round, p_bill, mem.sim_politician_id, vote_val, 'rival_whip')
    on conflict (round_id, bill_id, sim_politician_id)
    do update set vote = excluded.vote, method = excluded.method;
  end loop;
end;
$$;

-- ---------- Start round + advance (council_vote / mayoral) ----------

create or replace function public.campaign_start_legislative_round()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd_id uuid;
  dem_c int;
  rep_c int;
  maj text;
  leadership_required boolean;
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
    count(*) filter (where party = 'democrat'),
    count(*) filter (where party = 'republican')
  into dem_c, rep_c
  from public.campaign_caucus_members where chamber = 'council';

  maj := case when dem_c > rep_c then 'democrat' when rep_c > dem_c then 'republican' else null end;
  leadership_required := public._campaign_is_leadership_turn(sim.campaign_manager_turn);

  insert into public.legislative_rounds (
    cst_date, phase, house_majority_party, campaign_cycle, campaign_turn, featured_issue_keys
  ) values (
    public._campaign_cst_today(),
    case when leadership_required then 'leadership' else 'proposals' end,
    maj,
    sim.campaign_manager_cycle,
    sim.campaign_manager_turn,
    public._campaign_featured_issues(sim.campaign_manager_cycle, sim.campaign_manager_turn)
  )
  returning id into rnd_id;

  perform public._ensure_campaign_mayor();
  perform public._rival_strategist_log(
    'round_advance',
    case when leadership_required
      then 'Council session opened — nominate Council Spokesperson.'
      else 'Council session opened — file your caucus ordinance.'
    end,
    jsonb_build_object('round_id', rnd_id)
  );

  return jsonb_build_object(
    'ok', true, 'round_id', rnd_id,
    'phase', case when leadership_required then 'leadership' else 'proposals' end,
    'leadership_required', leadership_required
  );
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
  mayor_party text;
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
    if not rnd.human_proposal_submitted then raise exception 'Propose your ordinance first'; end if;
    if not rnd.rival_proposal_submitted then perform public._rival_propose_round_bill(rnd.id); end if;
    v_bill_id := public._first_docket_bill(rnd.id);
    if v_bill_id is null then raise exception 'No ordinances on docket'; end if;
    update public.legislative_rounds set active_bill_id = v_bill_id, last_phase_at = now() where id = rnd.id;
    delete from public.legislative_round_vote_overrides vo where vo.round_id = rnd.id and vo.bill_id = v_bill_id;
    perform public._rival_whip_caucus(rnd.id, v_bill_id, 'council');
    update public.legislative_rounds set phase = 'council_vote', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'council_vote', 'bill_id', v_bill_id);

  elsif rnd.phase = 'council_vote' then
    res := public._resolve_chamber_votes(rnd.id, v_bill_id, 'council');
    if not (res->>'passed')::boolean then
      finish := public._campaign_finish_legislative_round(rnd.id);
      return finish || jsonb_build_object('council', res, 'result', 'council_failed');
    end if;
    update public.legislative_rounds set phase = 'mayoral', last_phase_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'mayoral', 'council', res);

  elsif rnd.phase = 'mayoral' then
    select * into bill from public.legislative_round_bills where id = v_bill_id;
    mayor_party := public._campaign_mayor_party();
    lobbied := bill.summary like '%[Mayor''s Office pressure applied]%';

    if bill.house_passed then
      if mayor_party = bill.party or (lobbied and random() < 0.35) then
        update public.legislative_round_bills set signed = true where id = v_bill_id;
        perform public._apply_sim_politician_capital(bill.sponsor_sim_politician_id, 8, 'Ordinance enacted');
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

    v_next_bill := public._next_docket_bill(rnd.id, v_bill_id);
    if v_next_bill is not null then
      update public.legislative_rounds set active_bill_id = v_next_bill, phase = 'council_vote', last_phase_at = now() where id = rnd.id;
      delete from public.legislative_round_vote_overrides vo where vo.round_id = rnd.id and vo.bill_id = v_next_bill;
      perform public._rival_whip_caucus(rnd.id, v_next_bill, 'council');
      return jsonb_build_object('ok', true, 'phase', 'council_vote', 'next_bill', v_next_bill);
    end if;

    finish := public._campaign_finish_legislative_round(rnd.id);
    return finish || jsonb_build_object('mayor_party', mayor_party);

  -- Legacy federal phases (no-op redirect)
  elsif rnd.phase in ('house_vote', 'senate_vote', 'presidential') then
    finish := public._campaign_finish_legislative_round(rnd.id);
    return finish || jsonb_build_object('result', 'legacy_round_closed');

  else
    raise exception 'Round already completed';
  end if;
end;
$$;

-- Whip / assign / bribe: council_vote phase

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
    and phase in ('council_vote', 'house_vote', 'senate_vote')
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  v_bill_id := coalesce(p_bill_id, rnd.active_bill_id);
  if v_bill_id is null then raise exception 'No active bill'; end if;

  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sim_politician_id;
  if mem.sim_politician_id is null then raise exception 'Not in caucus'; end if;
  if mem.party <> sim.human_strategist_party then
    raise exception 'You control your own caucus for free — use PAC payments to convince rival members';
  end if;

  insert into public.legislative_round_vote_overrides (round_id, bill_id, sim_politician_id, vote, method)
  values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'whip')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  return jsonb_build_object('ok', true, 'vote', vote, 'cost', 0);
end;
$$;

create or replace function public.campaign_assign_all_caucus(p_vote text, p_bill_id uuid default null)
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
begin
  sim := public._require_human_strategist();
  if vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase in ('council_vote', 'house_vote', 'senate_vote')
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in a floor vote phase'; end if;

  v_bill_id := coalesce(p_bill_id, rnd.active_bill_id);

  for mem in
    select cm.sim_politician_id
    from public.campaign_caucus_members cm
    where cm.party = sim.human_strategist_party and cm.chamber = 'council'
  loop
    insert into public.legislative_round_vote_overrides (round_id, bill_id, sim_politician_id, vote, method)
    values (rnd.id, v_bill_id, mem.sim_politician_id, vote, 'whip')
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
    and phase in ('council_vote', 'house_vote', 'senate_vote')
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

  insert into public.legislative_round_vote_overrides (round_id, bill_id, sim_politician_id, vote, method)
  values (rnd.id, v_bill_id, p_sim_politician_id, vote, 'bribe')
  on conflict (round_id, bill_id, sim_politician_id)
  do update set vote = excluded.vote, method = excluded.method;

  perform public._rival_strategist_log(
    'bribe', format('Rival detected a $%s cross-aisle contact.', to_char(amt, 'FM999,999,999')),
    jsonb_build_object('amount', amt, 'sim_id', p_sim_politician_id)
  );

  return jsonb_build_object('ok', true, 'amount', amt, 'vote', vote);
end;
$$;

create or replace function public.campaign_lobby_president(p_capital numeric default 8)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  bill record;
  cap numeric := greatest(coalesce(p_capital, 0), 0);
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase = 'mayoral'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in mayoral action phase'; end if;
  select * into bill from public.legislative_round_bills where id = rnd.active_bill_id;
  if bill.id is null then raise exception 'No active ordinance'; end if;

  perform public.apply_political_capital_once(
    sim.human_strategist_user_id, -cap, 'Lobby Mayor', 'lobby_mayor', rnd.id::text
  );

  update public.legislative_round_bills
  set summary = bill.summary || E'\n\n[Mayor''s Office pressure applied]'
  where id = bill.id;

  return jsonb_build_object('ok', true, 'capital_spent', cap);
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
  cst date := public._campaign_cst_today();
  my_cap numeric := 0;
  mayor record;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then return jsonb_build_object('active', false); end if;
  if v_uid is not null then
    select coalesce(political_capital, 0) into my_cap from public.profiles where id = v_uid;
  end if;

  select * into rnd from public.legislative_rounds r
  where r.campaign_cycle = sim.campaign_manager_cycle
    and r.campaign_turn = sim.campaign_manager_turn
    and r.phase <> 'completed'
  order by r.created_at desc limit 1;

  select sp.id, sp.character_name, sp.party, sp.political_capital
    into mayor
  from public.sim_politicians sp
  where sp.id = public._ensure_campaign_mayor();

  return jsonb_build_object(
    'season_active', coalesce(sim.campaign_manager_active, false),
    'cst_phase', public._campaign_manager_cst_phase(),
    'cst_date', cst,
    'campaign_cycle', sim.campaign_manager_cycle,
    'campaign_turn', sim.campaign_manager_turn,
    'leadership_required', public._campaign_is_leadership_turn(sim.campaign_manager_turn),
    'featured_issue_keys', coalesce(rnd.featured_issue_keys, public._campaign_featured_issues(sim.campaign_manager_cycle, sim.campaign_manager_turn)),
    'cross_aisle_flips', coalesce(rnd.cross_aisle_flips, 0),
    'cross_aisle_flip_limit', case when coalesce(sim.campaign_manager_cycle, 1) <= 1 then 1 else 2 end,
    'round_id', rnd.id,
    'round_phase', rnd.phase,
    'active_bill_id', rnd.active_bill_id,
    'leadership_resolved', coalesce(rnd.leadership_resolved, false),
    'human_proposal_submitted', coalesce(rnd.human_proposal_submitted, false),
    'rival_proposal_submitted', coalesce(rnd.rival_proposal_submitted, false),
    'house_majority_party', rnd.house_majority_party,
    'council_majority_party', rnd.house_majority_party,
    'my_political_capital', my_cap,
    'rival_political_capital', coalesce(sim.rival_strategist_political_capital, 0),
    'caucus_count', (select count(*)::int from public.campaign_caucus_members where chamber = 'council'),
    'mayor_sim_id', mayor.id,
    'mayor_name', mayor.character_name,
    'mayor_party', mayor.party,
    'mayor_capital', coalesce(mayor.political_capital, 0),
    'president_sim_id', mayor.id,
    'president_name', mayor.character_name,
    'president_party', mayor.party,
    'president_capital', coalesce(mayor.political_capital, 0)
  );
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
    campaign_president_sim_id = null,
    campaign_mayor_sim_id = null,
    last_rival_cycle_refill = 0,
    last_rival_strategist_tick_at = null,
    updated_at = now()
  where id = 1;

  out := public.bootstrap_campaign_caucus();
  perform public._ensure_campaign_mayor();
  return jsonb_build_object(
    'ok', true, 'human_party', p_human_party, 'rival_party', p_rival_party,
    'caucus', out, 'turn', 1, 'cycle', 1, 'phase', 'council'
  );
end;
$$;

notify pgrst, 'reload schema';
