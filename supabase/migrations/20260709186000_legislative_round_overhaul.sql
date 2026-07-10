-- Legislative round overhaul: leadership only on congress turn 1, dual-bill docket,
-- congress issue templates, lower loyalty / flip limits, campaign president NPC.

alter table public.legislative_round_bills
  add column if not exists issue_key text,
  add column if not exists stance_key text,
  add column if not exists policy_value numeric,
  add column if not exists docket_order smallint not null default 1;

alter table public.legislative_rounds
  add column if not exists cross_aisle_flips smallint not null default 0,
  add column if not exists featured_issue_keys jsonb;

alter table public.simulation_settings
  add column if not exists campaign_president_sim_id uuid references public.sim_politicians (id) on delete set null;

alter table public.sim_politicians
  alter column whip_loyalty set default 50;

-- Reseed caucus loyalty: allies high, rivals much lower.
update public.sim_politicians sp
set whip_loyalty = case
  when sp.party = (select human_strategist_party from public.simulation_settings where id = 1 limit 1) then 78 + (random() * 10)::int
  else 38 + (random() * 14)::int
end
where exists (select 1 from public.campaign_caucus_members cm where cm.sim_politician_id = sp.id);

create or replace function public._campaign_is_leadership_turn(p_turn int)
returns boolean
language sql
immutable
as $$
  select coalesce(p_turn, 1) = 1;
$$;

create or replace function public._campaign_featured_issues(p_cycle int, p_turn int, p_count int default 4)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(issue_key order by ord), '[]'::jsonb)
  from (
    select bt.issue_key,
      row_number() over (order by md5(bt.issue_key || ':' || p_cycle::text || ':' || p_turn::text)) as ord
    from public.bill_templates bt
  ) sub
  where ord <= greatest(p_count, 1);
$$;

create or replace function public._ensure_campaign_president()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  pres_id uuid;
  pres_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_president_sim_id is not null then
    return sim.campaign_president_sim_id;
  end if;

  pres_party := public._president_control_party();

  select sp.id into pres_id
  from public.sim_politicians sp
  where sp.party = pres_party
  order by sp.political_capital desc, random()
  limit 1;

  if pres_id is null then
    select sp.id into pres_id
    from public.sim_politicians sp
    order by sp.political_capital desc, random()
    limit 1;
  end if;

  if pres_id is not null then
    update public.simulation_settings set campaign_president_sim_id = pres_id, updated_at = now() where id = 1;
    delete from public.sim_government_role_grants g where g.role_key = 'president';
    insert into public.sim_government_role_grants (sim_politician_id, role_key)
    values (pres_id, 'president')
    on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;
  end if;

  return pres_id;
end;
$$;

create or replace function public._campaign_president_party()
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
  if sim.campaign_president_sim_id is not null then
    select sp.party into party from public.sim_politicians sp where sp.id = sim.campaign_president_sim_id;
    if party in ('democrat', 'republican') then return party; end if;
  end if;
  return public._president_control_party();
end;
$$;

create or replace function public._pick_rival_round_stance(
  p_issue_key text,
  p_human_policy_value numeric,
  p_rival_party text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  stances jsonb;
  n int;
  idx int;
  chosen jsonb;
  roll numeric := random();
  i int;
  pv numeric;
  best_idx int := null;
  best_dist numeric := 999;
begin
  select bt.stances into stances from public.bill_templates bt where bt.issue_key = p_issue_key;
  if stances is null or jsonb_array_length(stances) = 0 then return null; end if;
  n := jsonb_array_length(stances);

  if roll < 0.30 then
    for i in 0..n - 1 loop
      if (stances->i->>'policy_value')::numeric = p_human_policy_value then
        return stances->i;
      end if;
    end loop;
  end if;

  if roll < 0.55 then
    idx := floor(random() * n)::int;
    return stances->idx;
  end if;

  for i in 0..n - 1 loop
    pv := (stances->i->>'policy_value')::numeric;
    if p_rival_party = 'republican' and pv <= 0 then
      if abs(pv - coalesce(p_human_policy_value, 0)) < best_dist then
        best_dist := abs(pv - coalesce(p_human_policy_value, 0));
        best_idx := i;
      end if;
    elsif p_rival_party = 'democrat' and pv >= 0 then
      if abs(pv - coalesce(p_human_policy_value, 0)) < best_dist then
        best_dist := abs(pv - coalesce(p_human_policy_value, 0));
        best_idx := i;
      end if;
    end if;
  end loop;

  if best_idx is not null then return stances->best_idx; end if;
  idx := floor(random() * n)::int;
  return stances->idx;
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
  human_bill record;
  sponsor uuid;
  bill_id uuid;
  rival_issue text;
  stance jsonb;
  roll numeric := random();
  title text;
  summary text;
  stance_key text;
  policy_val numeric;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into rnd from public.legislative_rounds where id = p_round;
  if rnd.rival_proposal_submitted then return null; end if;

  select * into human_bill
  from public.legislative_round_bills b
  where b.round_id = p_round and b.party = sim.human_strategist_party
  order by b.docket_order, b.created_at
  limit 1;

  select cm.sim_politician_id into sponsor
  from public.campaign_caucus_members cm
  join public.sim_politicians sp on sp.id = cm.sim_politician_id
  where cm.party = sim.rival_strategist_party and cm.chamber = 'house'
  order by sp.political_capital desc, random() limit 1;
  if sponsor is null then return null; end if;

  if human_bill.issue_key is not null and roll < 0.45 then
    rival_issue := human_bill.issue_key;
  else
    select bt.issue_key into rival_issue
    from public.bill_templates bt
    where human_bill.issue_key is null or bt.issue_key <> human_bill.issue_key
    order by md5(bt.issue_key || p_round::text || random()::text)
    limit 1;
  end if;

  if rival_issue is null then
    select bt.issue_key into rival_issue from public.bill_templates bt order by random() limit 1;
  end if;

  stance := public._pick_rival_round_stance(
    rival_issue,
    human_bill.policy_value,
    sim.rival_strategist_party
  );

  if stance is null then
    title := 'Counterpart Legislation Act';
    summary := 'Rival caucus priority measure.';
    stance_key := null;
    policy_val := null;
  else
    select bt.display_name into title from public.bill_templates bt where bt.issue_key = rival_issue;
    title := coalesce(title, rival_issue) || ' Act';
    summary := coalesce(stance->>'summary', 'Rival caucus bill.');
    stance_key := stance->>'stance_key';
    policy_val := (stance->>'policy_value')::numeric;
  end if;

  insert into public.legislative_round_bills (
    round_id, party, sponsor_sim_politician_id, title, summary, originating_chamber,
    issue_key, stance_key, policy_value, docket_order
  ) values (
    p_round, sim.rival_strategist_party, sponsor, title, summary, 'house',
    rival_issue, stance_key, policy_val, 2
  )
  returning id into bill_id;

  update public.legislative_rounds set rival_proposal_submitted = true, last_phase_at = now() where id = p_round;
  perform public._rival_strategist_log(
    'bill_filed', format('Rival proposed "%s".', title),
    jsonb_build_object('round_id', p_round, 'bill_id', bill_id, 'issue_key', rival_issue)
  );
  return bill_id;
end;
$$;

create or replace function public._next_docket_bill(p_round uuid, p_after_bill uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select b.id
  from public.legislative_round_bills b
  where b.round_id = p_round
    and b.docket_order > coalesce(
      (select b2.docket_order from public.legislative_round_bills b2 where b2.id = p_after_bill),
      0
    )
  order by b.docket_order, b.created_at
  limit 1;
$$;

create or replace function public._first_docket_bill(p_round uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select b.id
  from public.legislative_round_bills b
  where b.round_id = p_round
  order by b.docket_order, b.created_at
  limit 1;
$$;

create or replace function public._next_presidential_bill(p_round uuid, p_after_bill uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select b.id
  from public.legislative_round_bills b
  where b.round_id = p_round
    and b.house_passed and b.senate_passed
    and not b.signed and not b.vetoed
    and (p_after_bill is null or b.id <> p_after_bill)
  order by b.docket_order, b.created_at
  limit 1;
$$;

create or replace function public.bootstrap_campaign_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  human_party text;
begin
  select human_strategist_party into human_party from public.simulation_settings where id = 1;

  delete from public.campaign_caucus_members where true;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, sub.rn::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id, row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'democrat' order by d.code limit 5
  ) sub join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, (50 + sub.rn)::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id, row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'republican' order by d.code limit 5
  ) sub join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (100 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label, seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'democrat' order by seat.state_code, seat.senate_class limit 3
  ) sub join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (150 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label, seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'republican' order by seat.state_code, seat.senate_class limit 3
  ) sub join public.sim_politicians sp on sp.id = sub.sp_id;

  update public.sim_politicians sp
  set whip_loyalty = case
    when sp.party = coalesce(human_party, 'democrat') then 78 + (random() * 10)::int
    else 38 + (random() * 14)::int
  end
  where exists (select 1 from public.campaign_caucus_members cm where cm.sim_politician_id = sp.id);

  return jsonb_build_object('ok', true, 'members', (select count(*)::int from public.campaign_caucus_members));
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
  start_phase text;
  leadership_done boolean;
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

  leadership_done := not public._campaign_is_leadership_turn(sim.campaign_manager_turn);
  start_phase := case when leadership_done then 'proposals' else 'leadership' end;

  insert into public.legislative_rounds (
    cst_date, campaign_cycle, campaign_turn, phase, house_majority_party,
    leadership_resolved, featured_issue_keys, cross_aisle_flips
  )
  values (
    cst, sim.campaign_manager_cycle, sim.campaign_manager_turn, start_phase, maj,
    leadership_done,
    public._campaign_featured_issues(sim.campaign_manager_cycle, sim.campaign_manager_turn, 4),
    0
  )
  returning id into rnd_id;

  perform public._ensure_campaign_president();
  perform public._rival_strategist_log(
    'round_advance',
    case when leadership_done
      then 'Legislative round opened — file your caucus bill.'
      else 'New congress — nominate caucus leadership.'
    end,
    jsonb_build_object('round_id', rnd_id, 'cycle', sim.campaign_manager_cycle, 'turn', sim.campaign_manager_turn)
  );
  return jsonb_build_object('ok', true, 'round_id', rnd_id, 'phase', start_phase, 'leadership_required', not leadership_done);
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
  if rnd.human_proposal_submitted then raise exception 'You already proposed a bill this round'; end if;

  select * into mem from public.campaign_caucus_members where sim_politician_id = p_sponsor_sim;
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
    nullif(trim(coalesce(p_issue_key, '')), ''),
    nullif(trim(coalesce(p_stance_key, '')), ''),
    p_policy_value,
    1
  )
  returning id into v_bill_id;

  update public.legislative_rounds
  set human_proposal_submitted = true, active_bill_id = v_bill_id, last_phase_at = now()
  where id = rnd.id;

  perform public._apply_sim_politician_capital(p_sponsor_sim, 2, 'Filed round bill');
  perform public._rival_propose_round_bill(rnd.id);

  return jsonb_build_object('ok', true, 'bill_id', v_bill_id);
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
  sp record;
  v_bill_id uuid;
  vote text := lower(trim(coalesce(p_vote, '')));
  cost numeric := 3;
  my_cap numeric;
  max_flips int;
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
  select * into sp from public.sim_politicians where id = p_sim_politician_id;

  select coalesce(political_capital, 0) into my_cap from public.profiles where id = sim.human_strategist_user_id;
  if mem.party = sim.human_strategist_party then
    if my_cap < cost then raise exception 'Need % political capital to whip', cost; end if;
    update public.profiles set political_capital = political_capital - cost where id = sim.human_strategist_user_id;
  else
    cost := 15;
    max_flips := case when coalesce(sim.campaign_manager_cycle, 1) <= 1 then 1 else 2 end;
    if rnd.cross_aisle_flips >= max_flips then
      raise exception 'Cross-aisle limit reached this round (max % flip%s)', max_flips, case when max_flips = 1 then '' else 's' end;
    end if;
    if my_cap < cost then raise exception 'Need % political capital to flip a rival', cost; end if;
    if sp.political_capital > 14 then raise exception 'Target has too much capital to flip easily'; end if;
    if sp.whip_loyalty > 62 then raise exception 'Member is too loyal to flip with a whip — try a bribe later in the season'; end if;
    update public.profiles set political_capital = political_capital - cost where id = sim.human_strategist_user_id;
    update public.legislative_rounds set cross_aisle_flips = cross_aisle_flips + 1 where id = rnd.id;
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
  max_flips int;
  loyalty_gate numeric;
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

  max_flips := case when coalesce(sim.campaign_manager_cycle, 1) <= 1 then 1 else 2 end;
  if rnd.cross_aisle_flips >= max_flips then
    raise exception 'Cross-aisle limit reached this round (max % flip%s)', max_flips, case when max_flips = 1 then '' else 's' end;
  end if;

  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  loyalty_gate := 48 + coalesce(sim.campaign_manager_cycle, 1) * 4;
  if sp.whip_loyalty > loyalty_gate and sp.political_capital > (10 + coalesce(sim.campaign_manager_cycle, 1)) then
    raise exception 'Target is too loyal to bribe this early in the season';
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

  return jsonb_build_object('ok', true, 'amount', amt);
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
  my_cap numeric;
  pres_party text;
  cost numeric := greatest(coalesce(p_capital, 8), 5);
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where campaign_cycle = sim.campaign_manager_cycle
    and campaign_turn = sim.campaign_manager_turn
    and phase = 'presidential'
  order by created_at desc limit 1;
  if rnd.id is null then raise exception 'Not in presidential phase'; end if;

  select * into bill from public.legislative_round_bills where id = rnd.active_bill_id;
  if bill.id is null or not bill.house_passed or not bill.senate_passed then
    raise exception 'No bill awaiting presidential action';
  end if;
  if bill.party <> sim.human_strategist_party then
    raise exception 'Only lobby for your own caucus bill';
  end if;

  pres_party := public._campaign_president_party();
  if pres_party = sim.human_strategist_party then
    raise exception 'Your party holds the White House — advance to sign';
  end if;

  select coalesce(political_capital, 0) into my_cap from public.profiles where id = sim.human_strategist_user_id;
  if my_cap < cost then raise exception 'Need % political capital to lobby the president', cost; end if;

  update public.profiles set political_capital = political_capital - cost where id = sim.human_strategist_user_id;
  update public.legislative_round_bills
  set summary = bill.summary || ' [Oval Office pressure applied]'
  where id = bill.id;

  perform public._rival_strategist_log(
    'intel', 'Rival detected Oval Office lobbying.',
    jsonb_build_object('bill_id', bill.id, 'cost', cost)
  );

  return jsonb_build_object('ok', true, 'cost', cost, 'message', 'Presidential pressure logged — advance for sign/veto roll.');
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
    update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'completed', 'result', 'no_laws_enacted', 'senate', res);

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

    update public.legislative_rounds set phase = 'completed', completed_at = now() where id = rnd.id;
    return jsonb_build_object('ok', true, 'phase', 'completed', 'president_party', pres_party);

  else
    raise exception 'Round already completed';
  end if;
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
  pres record;
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

  select sp.id, sp.character_name, sp.party, sp.political_capital
  into pres
  from public.simulation_settings ss
  left join public.sim_politicians sp on sp.id = ss.campaign_president_sim_id
  where ss.id = 1;

  return jsonb_build_object(
    'season_active', coalesce(sim.campaign_manager_active, false),
    'cst_phase', public._campaign_manager_cst_phase(),
    'campaign_cycle', cycle,
    'campaign_turn', turn,
    'leadership_required', public._campaign_is_leadership_turn(turn),
    'featured_issue_keys', coalesce(rnd.featured_issue_keys, public._campaign_featured_issues(cycle, turn, 4)),
    'cross_aisle_flips', coalesce(rnd.cross_aisle_flips, 0),
    'cross_aisle_flip_limit', case when cycle <= 1 then 1 else 2 end,
    'round_id', rnd.id,
    'round_phase', rnd.phase,
    'active_bill_id', rnd.active_bill_id,
    'leadership_resolved', coalesce(rnd.leadership_resolved, false),
    'human_proposal_submitted', coalesce(rnd.human_proposal_submitted, false),
    'rival_proposal_submitted', coalesce(rnd.rival_proposal_submitted, false),
    'house_majority_party', rnd.house_majority_party,
    'my_political_capital', my_cap,
    'rival_political_capital', coalesce(sim.rival_strategist_political_capital, 0),
    'caucus_count', (select count(*)::int from public.campaign_caucus_members),
    'president_sim_id', pres.id,
    'president_name', pres.character_name,
    'president_party', pres.party,
    'president_capital', coalesce(pres.political_capital, 0)
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
    campaign_president_sim_id = null,
    last_rival_cycle_refill = 0,
    last_rival_strategist_tick_at = null,
    updated_at = now()
  where id = 1;

  out := public.bootstrap_campaign_caucus();
  perform public._ensure_campaign_president();
  return jsonb_build_object(
    'ok', true, 'human_party', p_human_party, 'rival_party', p_rival_party,
    'caucus', out, 'turn', 1, 'cycle', 1, 'phase', 'congress'
  );
end;
$$;

grant execute on function public.campaign_lobby_president(numeric) to authenticated;

notify pgrst, 'reload schema';
