-- Primary and general closeouts now tiebreak by filing order:
--   1. Most votes (primary_votes / general_votes count)
--   2. Earliest election_candidates.created_at
--   3. Lexicographically smallest election_candidates.id
-- This matches the Next.js server actions (app/actions/elections.ts) so manual admin overrides and the
-- scheduled RPC agree. Zero-vote edge cases: a solo candidate wins, and on ties the first filer wins.

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
  best_created timestamptz;
  best_is_set boolean;
begin
  for p in select distinct ec.party from public.election_candidates ec where ec.election_id = e_election
  loop
    best := null;
    best_id := null;
    best_created := null;
    best_is_set := false;

    for cand in
      select ec.id, ec.created_at
      from public.election_candidates ec
      where ec.election_id = e_election and ec.party = p
      order by ec.created_at nulls last, ec.id
    loop
      select count(*)::bigint into n
      from public.primary_votes pv
      where pv.election_id = e_election and pv.candidate_id = cand.id;

      if not best_is_set
         or n > best
         or (n = best and (best_created is null or cand.created_at < best_created))
      then
        best := n;
        best_id := cand.id;
        best_created := cand.created_at;
        best_is_set := true;
      end if;
    end loop;

    update public.election_candidates ec
    set primary_winner = (ec.id = best_id)
    where ec.election_id = e_election and ec.party = p;
  end loop;

  update public.elections e
  set phase = 'general'::public.election_phase
  where e.id = e_election;
end;
$$;

create or replace function public._close_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  district_pvi numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_user uuid := null;
  best_score numeric;
  best_created timestamptz;
  best_is_set boolean := false;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  active_count numeric;
begin
  select e.office, e.district_code
    into race
    from public.elections e
    where e.id = e_election;
  if not found then return; end if;
  if race.office = 'president' then return; end if;

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi
      from public.districts d
      where d.code = race.district_code;
    if district_pvi is null then district_pvi := 0; end if;
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
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);

    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;
    vote_total := vote_total + cand_votes;
  end loop;

  for cand in
    select ec.id, ec.user_id, ec.party, ec.created_at, coalesce(ec.campaign_points_total, 0) as pts
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
    order by ec.created_at nulls last, ec.id
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);
    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;

    cand_score :=
      0.6 * (case
              when camp_total > 0 then cand_points / camp_total
              when active_count > 0 then 1.0 / active_count
              else 0
            end)
      + 0.4 * (case
              when vote_total > 0 then cand_votes / vote_total
              when active_count > 0 then 1.0 / active_count
              else 0
            end);

    if not best_is_set
       or cand_score > best_score
       or (cand_score = best_score and (best_created is null or cand.created_at < best_created))
    then
      best_score := cand_score;
      best_user := cand.user_id;
      best_created := cand.created_at;
      best_is_set := true;
    end if;
  end loop;

  if best_user is null then
    update public.elections
      set phase = 'closed'::public.election_phase
      where id = e_election;
    perform public._apply_election_role_transitions(e_election);
    return;
  end if;

  update public.elections
    set phase = 'closed'::public.election_phase,
        winner_user_id = best_user
    where id = e_election;

  perform public._apply_election_role_transitions(e_election);
end;
$$;
