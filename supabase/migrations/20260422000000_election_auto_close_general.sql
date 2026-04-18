-- Automatic closeout of general elections (House / Senate only) when general_closes_at passes.
-- Uses the same 60/40 campaign/community scoring as `finalizeHouseSenateGeneral` in
-- web/src/app/actions/elections.ts and the district PVI lean from public.districts.
-- Presidential races still require an admin to pick the winner; they stay in the `general`
-- phase until the admin calls finalize_president (we relax that action to also accept the
-- post-deadline state where phase='closed' but winner_user_id is null -- see action file).
--
-- Also backfills an `election_candidates.created_at` column so the admin dashboard can show
-- filing timestamps per candidate.

alter table public.election_candidates
  add column if not exists created_at timestamptz not null default now();

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
  best_id uuid := null;
  best_score numeric := -1;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  winner_user uuid := null;
begin
  select e.office, e.district_code
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  if race.office = 'president' then
    -- Presidential races require manual certification.
    return;
  end if;

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi
      from public.districts d
      where d.code = race.district_code;
    if district_pvi is null then
      district_pvi := 0;
    end if;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  -- Precompute totals for normalization.
  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts
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
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);

    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;
    vote_total := vote_total + cand_votes;
  end loop;

  for cand in
    select ec.id, ec.user_id, ec.party, coalesce(ec.campaign_points_total, 0) as pts
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
    order by ec.id
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then
        cand_lean := district_pvi;
      elsif cand.party = 'republican' then
        cand_lean := -1 * district_pvi;
      end if;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);
    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;

    cand_score :=
      0.6 * (case when camp_total > 0 then cand_points / camp_total
                  else 1.0 / nullif((select count(*)::numeric from public.election_candidates ec
                                     where ec.election_id = e_election
                                       and (has_primary = false or ec.primary_winner is true)), 0) end)
      + 0.4 * (case when vote_total > 0 then cand_votes / vote_total
                    else 1.0 / nullif((select count(*)::numeric from public.election_candidates ec
                                       where ec.election_id = e_election
                                         and (has_primary = false or ec.primary_winner is true)), 0) end);

    if cand_score > best_score then
      best_score := cand_score;
      best_id := cand.id;
      winner_user := cand.user_id;
    end if;
  end loop;

  if winner_user is null then
    update public.elections
      set phase = 'closed'::public.election_phase
      where id = e_election;
    return;
  end if;

  update public.elections
    set phase = 'closed'::public.election_phase,
        winner_user_id = winner_user
    where id = e_election;
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
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    perform public._close_primary_for_election(r.id);
  end loop;

  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.general_closes_at is not null
      and e.general_closes_at < now()
      and e.office <> 'president'
  loop
    perform public._close_general_for_election(r.id);
  end loop;
end;
$$;

revoke all on function public._close_general_for_election(uuid) FROM PUBLIC;
revoke all on function public.advance_election_phases_by_schedule() FROM PUBLIC;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated;

comment on function public.advance_election_phases_by_schedule() is
  'Runs scheduled phase transitions: filing->primary, primary->general (per-party plurality), and general->closed for House/Senate (60/40 campaign+vote). Presidential generals require admin finalize.';
