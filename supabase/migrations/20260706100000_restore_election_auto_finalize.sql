-- Restore automatic election phase advancement when deadlines elapse.
-- Simplified sim (20260627100000) made advance_election_phases_by_schedule a no-op, leaving
-- races stuck at "finalizing…" after general_closes_at until an admin visited the console.

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

create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Seat races: filing -> primary when filing closes.
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  -- Leadership races: filing -> general (no primary).
  update public.elections
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.filing_window_started_at is not null
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    perform public._close_primary_for_election(r.id);
  end loop;

  -- Auto-close every general race (House, Senate, President, leadership) once the timer elapses.
  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
  loop
    perform public._close_general_for_election(r.id);
  end loop;
end;
$$;

revoke all on function public._close_general_for_election(uuid) from public;
revoke all on function public.advance_election_phases_by_schedule() from public;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated, service_role;

comment on function public.advance_election_phases_by_schedule() is
  'Advances election phases when filing/primary/general deadlines pass. Skips dormant races (filing_window_started_at IS NULL).';

notify pgrst, 'reload schema';
