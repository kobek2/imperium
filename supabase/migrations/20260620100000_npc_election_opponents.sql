-- NPC opponents for otherwise-unopposed seat races (and presidential tickets).
-- NPCs appear on the general ballot with synthetic campaign strength; they cannot hold office.

alter table public.election_candidates
  add column if not exists is_npc boolean not null default false,
  add column if not exists npc_name text,
  add column if not exists npc_synthetic_votes numeric not null default 0;

alter table public.election_candidates
  alter column user_id drop not null;

alter table public.elections
  add column if not exists npc_opponents_seeded boolean not null default false;

-- One real player per race; many NPC rows allowed (different parties).
drop index if exists election_candidates_election_user_unique;
create unique index election_candidates_election_player_unique
  on public.election_candidates (election_id, user_id)
  where user_id is not null and coalesce(is_npc, false) = false;

create index if not exists election_candidates_npc_idx
  on public.election_candidates (election_id)
  where is_npc = true;

comment on column public.election_candidates.is_npc is 'Synthetic challenger; user_id null; cannot receive office grants.';
comment on column public.election_candidates.npc_synthetic_votes is 'Treated as general-vote count in 60/40 closeout when no community votes exist.';

-- Opposite-party helper for two-party races.
create or replace function public._npc_opponent_party(p_party text)
returns text
language sql
immutable
as $$
  select case
    when p_party = 'democrat' then 'republican'
    when p_party = 'republican' then 'democrat'
    else case when random() < 0.5 then 'democrat' else 'republican' end
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
    primary_winner
  ) values (
    p_election_id,
    null,
    opp_party,
    true,
    npc_label,
    npc_votes,
    npc_pts,
    case when has_primary then true else null end
  );

  update public.elections
  set npc_opponents_seeded = true
  where id = p_election_id;

  return true;
end;
$$;

-- After primary → general, ensure a general-election opponent exists.
create or replace function public._close_primary_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
  cand record;
  n bigint;
  best bigint;
  best_id uuid;
begin
  for p in select distinct ec.party from public.election_candidates ec where ec.election_id = e_election
  loop
    best := -1;
    best_id := null;
    for cand in
      select ec.id
      from public.election_candidates ec
      where ec.election_id = e_election and ec.party = p and coalesce(ec.is_npc, false) = false
      order by ec.created_at nulls last, ec.id
    loop
      select count(*)::bigint into n
      from public.primary_votes pv
      where pv.election_id = e_election and pv.candidate_id = cand.id;

      if n > best then
        best := n;
        best_id := cand.id;
      end if;
    end loop;

    if best <= 0 or best_id is null then
      select ec.id into best_id
      from public.election_candidates ec
      where ec.election_id = e_election and ec.party = p and coalesce(ec.is_npc, false) = false
      order by ec.created_at nulls last, ec.id
      limit 1;
    end if;

    if best_id is not null then
      update public.election_candidates ec
      set primary_winner = (ec.id = best_id)
      where ec.election_id = e_election and ec.party = p and coalesce(ec.is_npc, false) = false;
    end if;
  end loop;

  update public.elections e
  set phase = 'general'::public.election_phase
  where e.id = e_election;

  perform public.seed_election_npc_opponents(e_election);
end;
$$;

-- General closeout: include NPC synthetic votes; only players can win office.
create or replace function public._close_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  district_pvi numeric := 0;
  state_pvi numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_id uuid := null;
  best_score numeric := -1;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  winner_user uuid := null;
  active_count numeric := 0;
begin
  select e.office, e.district_code, e.state
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  if race.office = 'president' then
    return;
  end if;

  perform public.seed_election_npc_opponents(e_election);

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi
      from public.districts d
      where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into state_pvi
      from public.states s
      where s.code = race.state;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  select count(*)::numeric into active_count
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true);

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts,
           coalesce(ec.npc_synthetic_votes, 0) as synth_votes
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then
        cand_lean := district_pvi;
      elsif cand.party = 'republican' then
        cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then
        cand_lean := state_pvi;
      elsif cand.party = 'republican' then
        cand_lean := -1 * state_pvi;
      end if;
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);

    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;
    vote_total := vote_total + coalesce(cand_votes, 0) + coalesce(cand.synth_votes, 0);
  end loop;

  for cand in
    select ec.id, ec.user_id, ec.party, ec.is_npc,
           coalesce(ec.campaign_points_total, 0) as pts,
           coalesce(ec.npc_synthetic_votes, 0) as synth_votes
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
    order by ec.created_at nulls last, ec.id
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then
        cand_lean := district_pvi;
      elsif cand.party = 'republican' then
        cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then
        cand_lean := state_pvi;
      elsif cand.party = 'republican' then
        cand_lean := -1 * state_pvi;
      end if;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);

    select coalesce(cand.synth_votes, 0) + count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;

    cand_score :=
      0.6 * (case when camp_total > 0 then cand_points / camp_total
                  else 1.0 / nullif(active_count, 0) end)
      + 0.4 * (case when vote_total > 0 then cand_votes / vote_total
                    else 1.0 / nullif(active_count, 0) end);

    if cand_score > best_score then
      best_score := cand_score;
      best_id := cand.id;
      if coalesce(cand.is_npc, false) then
        winner_user := null;
      else
        winner_user := cand.user_id;
      end if;
    end if;
  end loop;

  update public.elections
  set phase = 'closed'::public.election_phase,
      winner_user_id = winner_user
  where id = e_election;

  if winner_user is not null then
    perform public._apply_election_role_transitions(e_election);
  end if;
end;
$$;

revoke all on function public.seed_election_npc_opponents(uuid) from public;
grant execute on function public.seed_election_npc_opponents(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
