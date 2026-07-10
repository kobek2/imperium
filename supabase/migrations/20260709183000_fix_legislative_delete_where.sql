-- Fix remaining PL/pgSQL column shadowing on DELETE/UPDATE (bill_id = bill_id, bare DELETE).

create or replace function public.bootstrap_campaign_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_caucus_members where true;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, sub.rn::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id,
      row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'democrat'
    order by d.code
    limit 5
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, (50 + sub.rn)::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id,
      row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'republican'
    order by d.code
    limit 5
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (100 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label,
      seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'democrat'
    order by seat.state_code, seat.senate_class
    limit 3
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (150 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label,
      seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'republican'
    order by seat.state_code, seat.senate_class
    limit 3
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  return jsonb_build_object('ok', true, 'members', (select count(*)::int from public.campaign_caucus_members));
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
  v_role_key text;
  winner uuid;
  win_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  perform public._rival_nominate_leadership(p_round);

  foreach v_role_key in array array['speaker', 'house_majority_leader', 'house_minority_leader'] loop
    winner := null;
    select lr.sim_politician_id, lr.party into winner, win_party
    from public.legislative_round_leadership lr
    join public.sim_politicians sp on sp.id = lr.sim_politician_id
    where lr.round_id = p_round and lr.role_key = v_role_key
    order by sp.political_capital desc, random() limit 1;

    if winner is null then continue; end if;

    update public.legislative_round_leadership lr set won = false
    where lr.round_id = p_round and lr.role_key = v_role_key;
    update public.legislative_round_leadership lr set won = true
    where lr.round_id = p_round and lr.role_key = v_role_key and lr.sim_politician_id = winner;

    perform public._apply_sim_politician_capital(winner, 5, 'Leadership win');
    delete from public.sim_government_role_grants g where g.role_key = v_role_key;
    insert into public.sim_government_role_grants (sim_politician_id, role_key)
    values (winner, v_role_key)
    on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

    if win_party = sim.human_strategist_party and sim.human_strategist_user_id is not null then
      perform public.apply_political_capital_once(
        sim.human_strategist_user_id, 3, 'Caucus leadership win',
        'leadership_round', p_round::text || ':' || v_role_key
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
  returning id into v_bill_id;

  update public.legislative_rounds
  set human_proposal_submitted = true, active_bill_id = v_bill_id, last_phase_at = now()
  where id = rnd.id;

  perform public._apply_sim_politician_capital(p_sponsor_sim, 2, 'Filed round bill');
  perform public._rival_propose_round_bill(rnd.id);

  return jsonb_build_object('ok', true, 'bill_id', v_bill_id);
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
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase <> 'completed' order by created_at desc limit 1;
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
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase = 'leadership' order by created_at desc limit 1;
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
