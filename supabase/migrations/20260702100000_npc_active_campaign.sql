-- Active NPC campaigning: speeches every 3 hours, reactive counter-attacks, probabilistic player attack ads.

alter table public.election_candidates
  add column if not exists npc_last_speech_at timestamptz,
  add column if not exists npc_last_counter_at timestamptz;

create table if not exists public.npc_campaign_actions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  npc_candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  target_candidate_id uuid references public.election_candidates (id) on delete set null,
  action_type text not null check (action_type in ('speech', 'counter_attack')),
  succeeded boolean not null default true,
  points_delta numeric not null default 0,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists npc_campaign_actions_election_time_idx
  on public.npc_campaign_actions (election_id, created_at desc);

alter table public.npc_campaign_actions enable row level security;
drop policy if exists "npc_campaign_actions read authed" on public.npc_campaign_actions;
create policy "npc_campaign_actions read authed"
  on public.npc_campaign_actions for select to authenticated using (true);

-- Find the NPC opponent facing a player nominee in general.
create or replace function public._npc_opponent_for_player(
  p_election uuid,
  p_player_candidate uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ec.id
  from public.election_candidates ec
  where ec.election_id = p_election
    and coalesce(ec.is_npc, false) = true
    and ec.id <> p_player_candidate
    and (
      not exists (
        select 1 from public.election_candidates x
        where x.election_id = p_election and x.primary_winner is true
      )
      or ec.primary_winner is true
    )
  order by ec.created_at nulls last, ec.id
  limit 1;
$$;

create or replace function public._npc_deliver_scheduled_speech(p_npc_candidate uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  npc record;
  race record;
  speech_pts numeric := 4;
  npc_label text;
begin
  select ec.id, ec.election_id, ec.npc_name, ec.npc_last_speech_at, ec.is_npc
    into npc
    from public.election_candidates ec
    where ec.id = p_npc_candidate
    for update;
  if npc.id is null or not coalesce(npc.is_npc, false) then
    return false;
  end if;

  select e.id, e.phase, e.general_closes_at, e.district_code, e.state
    into race
    from public.elections e
    where e.id = npc.election_id;
  if race.phase <> 'general' or (race.general_closes_at is not null and now() > race.general_closes_at) then
    return false;
  end if;

  if npc.npc_last_speech_at is not null
     and now() < npc.npc_last_speech_at + interval '3 hours' then
    return false;
  end if;

  npc_label := coalesce(nullif(trim(npc.npc_name), ''), 'Opponent');

  update public.election_candidates
  set campaign_points_total = coalesce(campaign_points_total, 0) + speech_pts,
      npc_last_speech_at = now()
  where id = npc.id;

  insert into public.npc_campaign_actions (
    election_id, npc_candidate_id, action_type, succeeded, points_delta, message
  ) values (
    npc.election_id,
    npc.id,
    'speech',
    true,
    speech_pts,
    npc_label || ' held a press tour and sharpened their message (+' || speech_pts::text || ' pts).'
  );

  return true;
end;
$$;

create or replace function public._npc_reactive_counter_attack(
  p_election uuid,
  p_player_candidate uuid,
  p_trigger text default 'campaign'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  npc record;
  player record;
  race record;
  hit boolean;
  penalty numeric := 3;
  npc_label text;
begin
  select e.phase, e.general_closes_at into race
    from public.elections e where e.id = p_election;
  if race.phase <> 'general' or (race.general_closes_at is not null and now() > race.general_closes_at) then
    return false;
  end if;

  select ec.id, ec.user_id, ec.campaign_points_total into player
    from public.election_candidates ec
    where ec.id = p_player_candidate and ec.election_id = p_election;
  if player.id is null or coalesce((select is_npc from public.election_candidates where id = player.id), false) then
    return false;
  end if;

  npc_id := public._npc_opponent_for_player(p_election, p_player_candidate);
  if npc_id is null then return false; end if;

  select ec.id, ec.npc_name, ec.npc_last_counter_at into npc
    from public.election_candidates ec
    where ec.id = npc_id
    for update;

  -- ~40% chance to launch a counter spot after player activity.
  hit := random() < 0.40;
  if not hit then
    return false;
  end if;

  npc_label := coalesce(nullif(trim(npc.npc_name), ''), 'Opponent');

  update public.election_candidates
  set campaign_points_total = greatest(0, coalesce(campaign_points_total, 0) - penalty)
  where id = p_player_candidate;

  update public.election_candidates
  set npc_last_counter_at = now()
  where id = npc_id;

  insert into public.npc_campaign_actions (
    election_id, npc_candidate_id, target_candidate_id, action_type, succeeded, points_delta, message
  ) values (
    p_election,
    npc_id,
    p_player_candidate,
    'counter_attack',
    true,
    -penalty,
    npc_label || ' ran a reactive attack ad after your ' || coalesce(nullif(trim(p_trigger), ''), 'campaign') || ' (−' || penalty::text || ' pts).'
  );

  return true;
end;
$$;

-- Speech timer + optional reactive follow-up when a player campaigns.
create or replace function public.election_npc_campaign_pulse(
  p_election_id uuid,
  p_player_candidate_id uuid default null,
  p_trigger text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  spoke boolean := false;
  countered boolean := false;
begin
  for npc_id in
    select ec.id
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = true
      and e.phase = 'general'
      and (e.general_closes_at is null or now() <= e.general_closes_at)
  loop
    if public._npc_deliver_scheduled_speech(npc_id) then
      spoke := true;
    end if;
  end loop;

  if p_player_candidate_id is not null then
    countered := public._npc_reactive_counter_attack(
      p_election_id,
      p_player_candidate_id,
      coalesce(p_trigger, 'campaign')
    );
  end if;

  return jsonb_build_object('speech', spoke, 'counter_attack', countered);
end;
$$;

create or replace function public.tick_npc_campaigns(p_election_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  n int := 0;
  res jsonb;
begin
  for npc_id in
    select ec.id
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where coalesce(ec.is_npc, false) = true
      and e.phase = 'general'
      and (e.general_closes_at is null or now() <= e.general_closes_at)
      and (p_election_id is null or e.id = p_election_id)
  loop
    if public._npc_deliver_scheduled_speech(npc_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Initialize speech timer when NPC is seeded.
create or replace function public.seed_election_npc_opponents(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  district_row record;
  state_row record;
  has_primary boolean;
  player_count int;
  nominee record;
  opp_party text;
  npc_label text;
  lean numeric := 0;
  npc_pts numeric;
  npc_votes numeric;
  inserted boolean := false;
  new_npc_id uuid;
begin
  select e.id, e.office, e.state, e.district_code, e.leadership_role, e.phase, e.npc_opponents_seeded
    into race
    from public.elections e
    where e.id = p_election_id;
  if not found or race.npc_opponents_seeded then
    return false;
  end if;
  if race.leadership_role is not null then
    return false;
  end if;
  if race.phase not in ('primary', 'general') then
    return false;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = p_election_id and ec.primary_winner is true
  ) into has_primary;

  select count(*)::int into player_count
  from public.election_candidates ec
  where ec.election_id = p_election_id
    and coalesce(ec.is_npc, false) = false
    and (has_primary = false or ec.primary_winner is true);

  if player_count <> 1 then
    return false;
  end if;

  select ec.id, ec.party, ec.user_id
    into nominee
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = false
      and (has_primary = false or ec.primary_winner is true)
    order by ec.id
    limit 1;

  if exists (
    select 1 from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = true
      and (has_primary = false or ec.primary_winner is true)
  ) then
    update public.elections set npc_opponents_seeded = true where id = p_election_id;
    return false;
  end if;

  opp_party := public._npc_opponent_party(nominee.party);
  npc_label := 'Challenger';

  if race.office = 'house' and race.district_code is not null then
    select d.pvi, d.incumbent_party, d.incumbent_npc_name
      into district_row
      from public.districts d
      where d.code = race.district_code;
    lean := coalesce(district_row.pvi, 0);
    if district_row.incumbent_npc_name is not null
       and trim(district_row.incumbent_npc_name) <> ''
       and (
         district_row.incumbent_party is null
         or district_row.incumbent_party = opp_party
       ) then
      npc_label := district_row.incumbent_npc_name;
      if district_row.incumbent_party in ('democrat', 'republican') then
        opp_party := district_row.incumbent_party;
      end if;
    end if;
  elsif race.office = 'senate' and race.state is not null then
    select s.pvi into state_row from public.states s where s.code = race.state;
    lean := coalesce(state_row.pvi, 0);
    select d.incumbent_npc_name
      into npc_label
      from public.districts d
      where d.state = race.state
        and d.incumbent_npc_name is not null
        and trim(d.incumbent_npc_name) <> ''
      order by abs(d.pvi) desc nulls last
      limit 1;
    if npc_label is null or trim(npc_label) = '' then
      npc_label := race.state || ' Challenger';
    end if;
  elsif race.office = 'president' then
    npc_label := case opp_party
      when 'democrat' then 'Democratic Nominee'
      when 'republican' then 'Republican Nominee'
      else 'Opposition Nominee'
    end;
    lean := 0;
  end if;

  npc_pts := greatest(25, 30 + abs(lean) * 4);
  if (opp_party = 'democrat' and lean > 0) or (opp_party = 'republican' and lean < 0) then
    npc_pts := npc_pts + 15;
  end if;
  npc_votes := greatest(10, 18 + abs(lean) * 2);

  insert into public.election_candidates (
    election_id,
    user_id,
    party,
    is_npc,
    npc_name,
    npc_synthetic_votes,
    campaign_points_total,
    primary_winner,
    npc_last_speech_at
  ) values (
    p_election_id,
    null,
    opp_party,
    true,
    npc_label,
    npc_votes,
    npc_pts,
    case when has_primary then true else null end,
    now() - interval '3 hours'
  )
  returning id into new_npc_id;

  update public.elections
  set npc_opponents_seeded = true
  where id = p_election_id;

  perform public._npc_deliver_scheduled_speech(new_npc_id);

  return true;
end;
$$;

-- Player attack ads: 65% hit; miss backfires −1 pt. Pulse NPC after any ad.
create or replace function public.economy_use_campaign_ad(
  p_election uuid,
  p_candidate uuid,
  p_target_state text default null,
  p_qty int default 1,
  p_ad_type text default 'persuasion',
  p_target_candidate uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cand record;
  tgt record;
  tgt_user_id uuid := null;
  use_state char(2);
  use_district text;
  w record;
  new_bal numeric;
  ad_kind text := lower(trim(coalesce(p_ad_type, 'persuasion')));
  cost numeric;
  pts numeric := 0;
  penalty numeric := 0;
  pac_row record;
  new_exposure numeric;
  exposure_add numeric := 0;
  attack_hit boolean := true;
  outcome text := 'success';
  pulse jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  cost := case ad_kind
    when 'persuasion' then 1000000
    when 'attack' then 1500000
    when 'dark_money' then 2000000
    when 'suppression' then 3000000
    else null
  end;
  if cost is null then raise exception 'Invalid ad type'; end if;

  pts := case ad_kind
    when 'persuasion' then 3
    when 'dark_money' then 5
    else 0
  end;
  penalty := case ad_kind when 'attack' then 4 else 0 end;
  exposure_add := case ad_kind when 'dark_money' then 10 when 'suppression' then 20 else 0 end;

  select ec.id, ec.user_id, ec.running_mate_user_id, ec.election_id, ec.campaign_points_total,
    e.office, e.phase, e.general_closes_at, e.state, e.district_code
  into cand
  from public.election_candidates ec join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Campaign ads only during general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then raise exception 'General election closed'; end if;

  if cand.office = 'president' then
    if cand.user_id <> v_uid and cand.running_mate_user_id <> v_uid then
      raise exception 'Ads are for your own ticket only';
    end if;
    use_state := null; use_district := null;
  else
    if cand.user_id <> v_uid then raise exception 'Ads are for your own candidacy only'; end if;
    use_state := cand.state; use_district := cand.district_code;
  end if;

  if ad_kind = 'attack' then
    if p_target_candidate is null then raise exception 'Attack ads require a target candidate'; end if;
    select ec.id, ec.user_id, ec.campaign_points_total into tgt
    from public.election_candidates ec where ec.id = p_target_candidate and ec.election_id = p_election;
    if tgt.id is null then raise exception 'Target candidate not found'; end if;
    if tgt.id = p_candidate then raise exception 'Cannot attack yourself'; end if;
    tgt_user_id := tgt.user_id;
    attack_hit := random() < 0.65;
    if attack_hit then
      outcome := 'attack_hit';
    else
      outcome := 'attack_miss';
      penalty := 0;
    end if;
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance ($% required)', cost; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  if pts > 0 then
    update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + pts where id = p_candidate;
  end if;

  if ad_kind = 'attack' and attack_hit and p_target_candidate is not null then
    update public.election_candidates
    set campaign_points_total = greatest(0, coalesce(campaign_points_total, 0) - 4)
    where id = p_target_candidate;
  elsif ad_kind = 'attack' and not attack_hit then
    update public.election_candidates
    set campaign_points_total = greatest(0, coalesce(campaign_points_total, 0) - 1)
    where id = p_candidate;
    exposure_add := exposure_add + 5;
  end if;

  insert into public.campaign_ads (election_id, candidate_id, actor_id, target_state, target_district, points, ad_type, target_candidate_id, cost)
  values (p_election, p_candidate, v_uid, use_state, use_district, greatest(pts, 1), ad_kind, p_target_candidate, cost);

  if exposure_add > 0 then
    select * into pac_row from public.economy_pacs where user_id = v_uid for update;
    if pac_row.user_id is not null then
      new_exposure := least(100, pac_row.exposure_risk + exposure_add);
      update public.economy_pacs set exposure_risk = new_exposure where user_id = v_uid;
    end if;
    if ad_kind in ('dark_money', 'suppression') then
      insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
      values (
        v_uid,
        null,
        case when ad_kind = 'suppression' then 'suppression_ad' else 'dark_money' end,
        cost,
        p_election,
        jsonb_build_object('candidate_id', p_candidate, 'target_candidate_id', p_target_candidate, 'ad_type', ad_kind, 'outcome', outcome)
      );
    end if;
  elsif ad_kind = 'attack' then
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (v_uid, tgt_user_id, 'attack_ad', cost, p_election, jsonb_build_object('from_candidate', p_candidate, 'outcome', outcome));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'campaign_ad', jsonb_build_object('ad_type', ad_kind, 'election_id', p_election, 'points', pts, 'outcome', outcome));

  pulse := public.election_npc_campaign_pulse(p_election, p_candidate, ad_kind || ' ad');

  return jsonb_build_object(
    'ok', true,
    'balance', new_bal,
    'ad_type', ad_kind,
    'points', pts,
    'cost', cost,
    'outcome', outcome,
    'npc_counter_attack', coalesce((pulse->>'counter_attack')::boolean, false),
    'npc_speech', coalesce((pulse->>'speech')::boolean, false)
  );
end;
$$;

-- Backfill: existing NPCs can speak soon after migration.
update public.election_candidates ec
set npc_last_speech_at = coalesce(ec.npc_last_speech_at, now() - interval '3 hours')
from public.elections e
where e.id = ec.election_id
  and coalesce(ec.is_npc, false) = true
  and e.phase = 'general';

revoke all on function public.election_npc_campaign_pulse(uuid, uuid, text) from public;
grant execute on function public.election_npc_campaign_pulse(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.tick_npc_campaigns(uuid) from public;
grant execute on function public.tick_npc_campaigns(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
