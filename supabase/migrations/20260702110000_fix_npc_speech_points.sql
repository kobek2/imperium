-- Reconcile NPC campaign_points_total with logged speech actions (idempotent).

alter table public.election_candidates
  add column if not exists npc_base_campaign_points numeric;

-- Base points at seed: current total minus speech deltas, unless that would undercut typical seed floor.
update public.election_candidates ec
set npc_base_campaign_points = case
  when coalesce(ec.campaign_points_total, 0) - coalesce(sp.speech_pts, 0) < 25
    then coalesce(ec.campaign_points_total, 0)
  else coalesce(ec.campaign_points_total, 0) - coalesce(sp.speech_pts, 0)
end
from (
  select npc_candidate_id, sum(points_delta) as speech_pts
  from public.npc_campaign_actions
  where action_type = 'speech' and succeeded
  group by npc_candidate_id
) sp
where coalesce(ec.is_npc, false) and ec.id = sp.npc_candidate_id;

update public.election_candidates ec
set npc_base_campaign_points = coalesce(ec.campaign_points_total, 0)
where coalesce(ec.is_npc, false)
  and ec.npc_base_campaign_points is null;

update public.election_candidates ec
set campaign_points_total = coalesce(ec.npc_base_campaign_points, 0) + coalesce(sp.speech_pts, 0)
from (
  select npc_candidate_id, sum(points_delta) as speech_pts
  from public.npc_campaign_actions
  where action_type = 'speech' and succeeded
  group by npc_candidate_id
) sp
where ec.id = sp.npc_candidate_id
  and coalesce(ec.is_npc, false);

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
  select ec.id, ec.election_id, ec.npc_name, ec.npc_last_speech_at, ec.is_npc,
         ec.npc_base_campaign_points, ec.campaign_points_total
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

  insert into public.npc_campaign_actions (
    election_id, npc_candidate_id, action_type, succeeded, points_delta, message
  ) values (
    npc.election_id,
    p_npc_candidate,
    'speech',
    true,
    speech_pts,
    npc_label || ' held a press tour and sharpened their message (+' || speech_pts::text || ' pts).'
  );

  update public.election_candidates
  set campaign_points_total = coalesce(npc_base_campaign_points, campaign_points_total) + (
      select coalesce(sum(points_delta), 0)
      from public.npc_campaign_actions
      where npc_candidate_id = p_npc_candidate
        and action_type = 'speech'
        and succeeded
    ),
      npc_last_speech_at = now()
  where id = p_npc_candidate;

  return true;
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
    npc_base_campaign_points,
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

notify pgrst, 'reload schema';
