-- When House/Senate general-election candidates tie on the 60/40 blended score, pick the
-- winner whose party aligns best with the seat's partisan lean (districts.pvi /
-- states.pvi: signed 2024 presidential margin). Matches web/src/app/actions/elections.ts
-- and per-state presidential EC resolution in web/src/lib/presidential-scoring.ts.

create or replace function public._close_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  partisan_lean numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_user uuid := null;
  best_score numeric;
  best_lean_priority numeric;
  best_created timestamptz;
  best_is_set boolean := false;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  cand_lean_priority numeric;
  active_count numeric;
begin
  select e.office, e.district_code, e.state, e.leadership_role
    into race
    from public.elections e
    where e.id = e_election;
  if not found then return; end if;

  -- Leadership: pure plurality, earliest-filer tiebreak.
  if race.leadership_role is not null then
    for cand in
      select ec.id, ec.user_id, ec.created_at
      from public.election_candidates ec
      where ec.election_id = e_election
      order by ec.created_at nulls last, ec.id
    loop
      select count(*)::numeric into cand_votes
        from public.general_votes gv
        where gv.election_id = e_election and gv.candidate_id = cand.id;

      if not best_is_set
         or cand_votes > best_score
         or (cand_votes = best_score and (best_created is null or cand.created_at < best_created))
      then
        best_score := cand_votes;
        best_user := cand.user_id;
        best_created := cand.created_at;
        best_is_set := true;
      end if;
    end loop;

    update public.elections
      set phase = 'closed'::public.election_phase,
          winner_user_id = best_user
      where id = e_election;

    perform public._apply_election_role_transitions(e_election);
    return;
  end if;

  if race.office = 'president' then return; end if;

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into partisan_lean
      from public.districts d
      where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into partisan_lean
      from public.states s
      where s.code = race.state;
  end if;
  if partisan_lean is null then partisan_lean := 0; end if;

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
    if cand.party = 'democrat' then cand_lean := partisan_lean;
    elsif cand.party = 'republican' then cand_lean := -1 * partisan_lean;
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
    if cand.party = 'democrat' then cand_lean := partisan_lean;
    elsif cand.party = 'republican' then cand_lean := -1 * partisan_lean;
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

    cand_lean_priority := 0;
    if cand.party = 'democrat' then cand_lean_priority := partisan_lean;
    elsif cand.party = 'republican' then cand_lean_priority := -1 * partisan_lean;
    end if;

    if not best_is_set
       or cand_score > best_score
       or (cand_score = best_score and cand_lean_priority > best_lean_priority)
       or (cand_score = best_score and cand_lean_priority = best_lean_priority
           and (best_created is null or cand.created_at < best_created))
    then
      best_score := cand_score;
      best_lean_priority := cand_lean_priority;
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
