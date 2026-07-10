-- Seat races (House/Senate/city): winner from campaign points + lean only.
-- NPC synthetic votes were hidden in admin UI but counted for 40% of SQL closeout,
-- letting NPCs beat players with higher visible campaign points.

create or replace function public._election_lean_tie_priority(
  p_party text,
  p_signed_margin numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_party = 'democrat' then coalesce(p_signed_margin, 0)
    when p_party = 'republican' then -1 * coalesce(p_signed_margin, 0)
    else 0
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
  state_pvi numeric := 0;
  ward_pvi numeric := 0;
  signed_margin numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_id uuid := null;
  best_score numeric := -1;
  best_lean_priority numeric := -1e9;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  cand_lean_priority numeric;
  winner_user uuid := null;
  active_count numeric := 0;
  point_race boolean;
begin
  select e.office, e.district_code, e.state, e.ward_code
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  point_race := race.office in ('house', 'senate', 'council_ward', 'mayor');

  perform public.seed_election_npc_opponents(e_election);
  perform public.tick_npc_campaigns(e_election);

  if race.office = 'council_ward' and race.ward_code is not null then
    select coalesce(w.pvi, 0)::numeric into ward_pvi
      from public.wards w
      where w.code = race.ward_code;
    signed_margin := ward_pvi;
  elsif race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi
      from public.districts d
      where d.code = race.district_code;
    signed_margin := district_pvi;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into state_pvi
      from public.states s
      where s.code = race.state;
    signed_margin := state_pvi;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  if not has_primary then
    perform public.finalize_election_party_nominees(e_election);
    has_primary := true;
  end if;

  select count(*)::numeric into active_count
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true);

  if active_count < 1 then
    perform public.seed_election_npc_opponents(e_election);
    perform public.finalize_election_party_nominees(e_election);
    select count(*)::numeric into active_count
      from public.election_candidates ec
      where ec.election_id = e_election and ec.primary_winner is true;
  end if;

  if point_race then
    for cand in
      select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts
      from public.election_candidates ec
      where ec.election_id = e_election
        and (has_primary = false or ec.primary_winner is true)
    loop
      cand_lean := 0;
      if race.office = 'council_ward' then
        if cand.party = 'democrat' then cand_lean := ward_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
        end if;
      elsif race.office = 'house' then
        if cand.party = 'democrat' then cand_lean := district_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
        end if;
      elsif race.office = 'senate' then
        if cand.party = 'democrat' then cand_lean := state_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
        end if;
      end if;
      camp_total := camp_total + greatest(0, cand.pts + cand_lean);
    end loop;

    for cand in
      select ec.id, ec.user_id, ec.party, ec.is_npc,
             coalesce(ec.campaign_points_total, 0) as pts,
             ec.created_at
      from public.election_candidates ec
      where ec.election_id = e_election
        and (has_primary = false or ec.primary_winner is true)
      order by ec.created_at nulls last, ec.id
    loop
      cand_lean := 0;
      if race.office = 'council_ward' then
        if cand.party = 'democrat' then cand_lean := ward_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
        end if;
      elsif race.office = 'house' then
        if cand.party = 'democrat' then cand_lean := district_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
        end if;
      elsif race.office = 'senate' then
        if cand.party = 'democrat' then cand_lean := state_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
        end if;
      end if;

      cand_points := greatest(0, cand.pts + cand_lean);
      cand_score := case
        when camp_total > 0 then cand_points / camp_total
        else 1.0 / nullif(active_count, 0)
      end;
      cand_lean_priority := public._election_lean_tie_priority(cand.party, signed_margin);

      if cand_score > best_score
         or (
           cand_score = best_score
           and (
             cand_lean_priority > best_lean_priority
             or (cand_lean_priority = best_lean_priority and best_id is null)
           )
         ) then
        best_score := cand_score;
        best_lean_priority := cand_lean_priority;
        best_id := cand.id;
        if coalesce(cand.is_npc, false) then
          winner_user := null;
        else
          winner_user := cand.user_id;
        end if;
      end if;
    end loop;
  else
    for cand in
      select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts,
             coalesce(ec.npc_synthetic_votes, 0) as synth_votes
      from public.election_candidates ec
      where ec.election_id = e_election
        and (has_primary = false or ec.primary_winner is true)
    loop
      cand_lean := 0;
      if race.office = 'council_ward' then
        if cand.party = 'democrat' then cand_lean := ward_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
        end if;
      elsif race.office = 'house' then
        if cand.party = 'democrat' then cand_lean := district_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
        end if;
      elsif race.office = 'senate' then
        if cand.party = 'democrat' then cand_lean := state_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
        end if;
      end if;
      camp_total := camp_total + greatest(0, cand.pts + cand_lean);

      select coalesce(cand.synth_votes, 0) + count(*)::numeric into cand_votes
        from public.general_votes gv
        where gv.election_id = e_election and gv.candidate_id = cand.id;
      vote_total := vote_total + coalesce(cand_votes, 0);
    end loop;

    for cand in
      select ec.id, ec.user_id, ec.party, ec.is_npc,
             coalesce(ec.campaign_points_total, 0) as pts,
             coalesce(ec.npc_synthetic_votes, 0) as synth_votes,
             ec.created_at
      from public.election_candidates ec
      where ec.election_id = e_election
        and (has_primary = false or ec.primary_winner is true)
      order by ec.created_at nulls last, ec.id
    loop
      cand_lean := 0;
      if race.office = 'council_ward' then
        if cand.party = 'democrat' then cand_lean := ward_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
        end if;
      elsif race.office = 'house' then
        if cand.party = 'democrat' then cand_lean := district_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
        end if;
      elsif race.office = 'senate' then
        if cand.party = 'democrat' then cand_lean := state_pvi;
        elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
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

      if cand_score > best_score
         or (cand_score = best_score and best_id is null) then
        best_score := cand_score;
        best_id := cand.id;
        if coalesce(cand.is_npc, false) then
          winner_user := null;
        else
          winner_user := cand.user_id;
        end if;
      end if;
    end loop;
  end if;

  if best_id is null and active_count > 0 then
    select ec.id, ec.user_id, ec.is_npc
      into cand
      from public.election_candidates ec
      where ec.election_id = e_election
        and ec.primary_winner is true
      order by ec.created_at nulls last, ec.id
      limit 1;
    if found then
      best_id := cand.id;
      winner_user := case when coalesce(cand.is_npc, false) then null else cand.user_id end;
      best_score := 0;
    end if;
  end if;

  if best_id is not null then
    update public.election_candidates ec
      set final_score = best_score
      where ec.id = best_id;

    update public.elections
      set phase = 'closed'::public.election_phase,
          winner_user_id = winner_user,
          winner_candidate_id = best_id
      where id = e_election;

    perform public._apply_election_role_transitions(e_election);
  end if;
end;
$$;

grant execute on function public._election_lean_tie_priority(text, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
