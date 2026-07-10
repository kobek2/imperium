-- Millbrook elections: NPC seeding, seat placeholders, campaign status aliases, boot helpers.

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
  turn int;
  cycle int;
  phase text;
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
    'council_window', phase = 'council',
    'congress_window', phase = 'council',
    'campaign_turn', turn,
    'campaign_cycle', cycle,
    'turn_in_phase', public._campaign_manager_turn_in_phase(turn),
    'council_turns', public._campaign_council_turns(),
    'congress_turns', public._campaign_council_turns(),
    'election_turns', public._campaign_election_turns(),
    'cycle_turns', public._campaign_cycle_turns()
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
    format('Council turn complete — now cycle %s, turn %s/%s (%s).', new_cycle, new_turn, public._campaign_cycle_turns(), new_phase),
    jsonb_build_object('cycle', new_cycle, 'turn', new_turn, 'phase', new_phase, 'auto', true)
  );

  return jsonb_build_object(
    'ok', true, 'turn_advanced', true, 'cycle', new_cycle, 'turn', new_turn, 'phase', new_phase
  );
end;
$$;

create or replace function public._npc_party_label(
  p_office text,
  p_state text,
  p_district text,
  p_party text,
  p_incumbent_party text,
  p_incumbent_name text,
  p_ward text default null
)
returns text
language plpgsql
immutable
as $$
begin
  if p_incumbent_party = p_party
     and p_incumbent_name is not null
     and trim(p_incumbent_name) <> ''
     and lower(trim(p_incumbent_name)) <> 'open seat' then
    return trim(p_incumbent_name);
  end if;

  if p_office = 'council_ward' and p_ward is not null then
    return p_ward || ' ' || case p_party when 'democrat' then 'Democrat' when 'republican' then 'Republican' else 'Independent' end;
  elsif p_office = 'mayor' then
    return case p_party when 'democrat' then 'Democratic Nominee' when 'republican' then 'Republican Nominee' else 'Independent Nominee' end;
  elsif p_office = 'house' and p_district is not null then
    return case p_party when 'democrat' then 'Democratic Nominee' when 'republican' then 'Republican Nominee' else 'Independent Nominee' end;
  end if;

  return case p_party when 'democrat' then 'Democratic Nominee' when 'republican' then 'Republican Nominee' else 'Independent Nominee' end;
end;
$$;

create or replace function public._npc_insert_party_placeholder(
  p_election_id uuid,
  p_party text,
  p_lean numeric,
  p_office text,
  p_state text,
  p_district text,
  p_incumbent_party text,
  p_incumbent_name text,
  p_incumbent_politician_id uuid default null,
  p_ward text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  npc_label text;
  npc_pts numeric;
  npc_votes numeric;
  new_id uuid;
  pol public.sim_politicians;
  race_senate_class smallint;
begin
  select ec.id into existing_id
  from public.election_candidates ec
  where ec.election_id = p_election_id and ec.party = p_party and coalesce(ec.is_npc, false) = true
  limit 1;
  if existing_id is not null then return existing_id; end if;

  select e.senate_class into race_senate_class from public.elections e where e.id = p_election_id;

  select * into pol from public._sim_politician_for_seat(
    p_office, p_district, p_state, race_senate_class, p_party, p_ward
  );

  npc_label := coalesce(
    pol.character_name,
    public._npc_party_label(p_office, p_state, p_district, p_party, p_incumbent_party, p_incumbent_name, p_ward)
  );
  npc_pts := public._npc_party_points(p_party, p_lean);
  npc_votes := greatest(10, 18 + abs(coalesce(p_lean, 0)) * 2);

  insert into public.election_candidates (
    election_id, user_id, party, is_npc, npc_name, sim_politician_id,
    npc_synthetic_votes, campaign_points_total, npc_base_campaign_points, primary_winner
  ) values (
    p_election_id, null, p_party, true, npc_label, pol.id,
    npc_votes, npc_pts, npc_pts, false
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.seed_election_npc_opponents(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  lean numeric := 0;
  incumbent_party text := null;
  incumbent_name text := null;
  incumbent_politician_id uuid := null;
  inserted boolean := false;
  office_text text;
  inc_pol public.sim_politicians;
begin
  select e.id, e.office, e.state, e.district_code, e.ward_code, e.senate_class, e.leadership_role, e.phase, e.npc_opponents_seeded
    into race from public.elections e where e.id = p_election_id;
  if not found then return false; end if;
  if race.leadership_role is not null then return false; end if;
  if race.phase not in ('filing', 'primary', 'general') then return false; end if;

  office_text := race.office::text;

  if race.office = 'council_ward' and race.ward_code is not null then
    select w.pvi, w.incumbent_party, w.incumbent_npc_name, w.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.wards w where w.code = race.ward_code;
    lean := coalesce(lean, 0);
  elsif race.office = 'mayor' then
    select 0, ms.incumbent_party, sp.character_name, ms.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.mayor_seat ms
    left join public.sim_politicians sp on sp.id = ms.incumbent_politician_id
    where ms.city_code = 'MB';
    lean := coalesce(lean, 0);
  elsif race.office = 'house' and race.district_code is not null then
    select d.pvi, d.incumbent_party, d.incumbent_npc_name, d.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.districts d where d.code = race.district_code;
    lean := coalesce(lean, 0);
  elsif race.office = 'senate' and race.state is not null and race.senate_class is not null then
    select coalesce(s.pvi, 0), seat.incumbent_party, sp.character_name, seat.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.states s
    left join public.senate_seats seat on seat.state_code = race.state and seat.senate_class = race.senate_class
    left join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where s.code = race.state;
    lean := coalesce(lean, 0);
  end if;

  select * into inc_pol from public._incumbent_politician_for_race(
    office_text, race.district_code, race.state, race.senate_class, race.ward_code
  );
  if found then
    incumbent_politician_id := inc_pol.id;
    incumbent_name := inc_pol.character_name;
    incumbent_party := case inc_pol.party when 'democrat' then 'D' when 'republican' then 'R' else incumbent_party end;
  end if;

  perform public._npc_insert_party_placeholder(
    p_election_id, 'democrat', lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id, race.ward_code
  );
  perform public._npc_insert_party_placeholder(
    p_election_id, 'republican', lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id, race.ward_code
  );

  inserted := true;
  update public.elections set npc_opponents_seeded = true where id = p_election_id;
  return inserted;
end;
$$;

create or replace function public._apply_npc_seat_placeholder(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  party_code char(1);
  npc_label text;
begin
  select e.winner_candidate_id, e.office, e.district_code, e.state, e.ward_code, e.senate_class
    into race from public.elections e where e.id = e_election;
  if race.winner_candidate_id is null then return; end if;

  select ec.is_npc, ec.npc_name, ec.party, ec.sim_politician_id
    into cand from public.election_candidates ec where ec.id = race.winner_candidate_id;
  if not found or not coalesce(cand.is_npc, false) then return; end if;

  party_code := public._party_to_incumbent_code(cand.party);
  npc_label := coalesce(nullif(trim(cand.npc_name), ''), 'Incumbent');

  if race.office = 'council_ward' and race.ward_code is not null then
    update public.wards w set
      incumbent_npc_name = npc_label,
      incumbent_party = party_code,
      incumbent_politician_id = cand.sim_politician_id,
      claimed_by = null
    where w.code = race.ward_code;
  elsif race.office = 'mayor' then
    insert into public.mayor_seat (city_code, incumbent_politician_id, incumbent_party)
    values ('MB', cand.sim_politician_id, party_code)
    on conflict (city_code) do update set
      incumbent_politician_id = excluded.incumbent_politician_id,
      incumbent_party = excluded.incumbent_party;
  elsif race.office = 'house' and race.district_code is not null then
    update public.districts d set
      incumbent_npc_name = npc_label, incumbent_party = party_code,
      incumbent_politician_id = cand.sim_politician_id, claimed_by = null
    where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null and race.senate_class is not null then
    insert into public.senate_seats (state_code, senate_class, incumbent_politician_id, incumbent_party)
    values (race.state, race.senate_class, cand.sim_politician_id, party_code)
    on conflict (state_code, senate_class) do update set
      incumbent_politician_id = excluded.incumbent_politician_id, incumbent_party = excluded.incumbent_party;
  end if;
end;
$$;

create or replace function public.campaign_propose_round_bill(
  p_sponsor_sim uuid,
  p_title text,
  p_summary text,
  p_issue_key text default null,
  p_stance_key text default null,
  p_policy_value numeric default null
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
  if rnd.human_proposal_submitted then raise exception 'You already proposed an ordinance this round'; end if;

  select * into mem from public.campaign_caucus_members
  where sim_politician_id = p_sponsor_sim and chamber = 'council';
  if mem.sim_politician_id is null or mem.party <> sim.human_strategist_party then
    raise exception 'Invalid sponsor';
  end if;
  if char_length(title) < 5 then raise exception 'Title too short'; end if;
  if char_length(body) < 10 then raise exception 'Summary too short'; end if;

  insert into public.legislative_round_bills (
    round_id, party, sponsor_sim_politician_id, title, summary, originating_chamber,
    issue_key, stance_key, policy_value, docket_order
  ) values (
    rnd.id, sim.human_strategist_party, p_sponsor_sim, title, body, 'house',
    p_issue_key, p_stance_key, p_policy_value, 1
  )
  returning id into v_bill_id;

  update public.legislative_rounds
  set human_proposal_submitted = true, active_bill_id = v_bill_id, last_phase_at = now()
  where id = rnd.id;

  perform public._apply_sim_politician_capital(p_sponsor_sim, 2, 'Filed round ordinance');
  perform public._rival_propose_round_bill(rnd.id);

  return jsonb_build_object('ok', true, 'bill_id', v_bill_id);
end;
$$;

-- Admin helper: create dormant Millbrook mayor + 7 ward election rows
create or replace function public.ensure_millbrook_election_templates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w record;
  created int := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  if not exists (
    select 1 from public.elections e
    where e.office = 'mayor' and e.state = 'MB' and e.phase <> 'closed'
  ) then
    insert into public.elections (
      office, state, phase, filing_opens_at, filing_closes_at,
      primary_closes_at, general_closes_at, primary_party_wide, filing_window_started_at
    ) values (
      'mayor', 'MB', 'filing', now(), now() + interval '7 days',
      now() + interval '14 days', now() + interval '21 days', true, null
    );
    created := created + 1;
  end if;

  for w in select code from public.wards where city_code = 'MB' order by code loop
    if not exists (
      select 1 from public.elections e
      where e.office = 'council_ward' and e.ward_code = w.code and e.phase <> 'closed'
    ) then
      insert into public.elections (
        office, state, ward_code, phase, filing_opens_at, filing_closes_at,
        primary_closes_at, general_closes_at, primary_party_wide, filing_window_started_at
      ) values (
        'council_ward', 'MB', w.code, 'filing', now(), now() + interval '7 days',
        now() + interval '14 days', now() + interval '21 days', true, null
      );
      created := created + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'created', created);
end;
$$;

create or replace function public.open_millbrook_election_filings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  e record;
  opened int := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;
  perform public.ensure_millbrook_election_templates();

  for e in
    select id from public.elections
    where office in ('mayor', 'council_ward')
      and state = 'MB'
      and phase = 'filing'
      and filing_window_started_at is null
  loop
    update public.elections set filing_window_started_at = now() where id = e.id;
    perform public.seed_election_npc_opponents(e.id);
    opened := opened + 1;
  end loop;

  return jsonb_build_object('ok', true, 'opened', opened);
end;
$$;

grant execute on function public.ensure_millbrook_election_templates() to authenticated;
grant execute on function public.open_millbrook_election_filings() to authenticated;

notify pgrst, 'reload schema';
