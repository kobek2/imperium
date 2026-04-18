-- Automatic role transitions when an election closes.
--
-- Rules (mirrors app intent):
--   * Winner of house   -> grant representative; revoke senator, president, vice_president, and all congressional leadership keys.
--   * Winner of senate  -> grant senator;        revoke representative, president, vice_president, and all congressional leadership keys.
--   * Winner of pres    -> grant president;      revoke representative, senator, vice_president, and all congressional leadership keys.
--   * Losers whose current seat is up for the same office (House in same district, Senate in same state, or President) lose that office role.
--   * Anyone affected by a closed race also drops congressional leadership keys (new congress = leadership reset).
--   * Profiles.office_role (legacy single-role) is kept in sync with the winner role and cleared for seat-losers.
--
-- The function is called from _close_general_for_election (auto-close) and from the RPC wrapper used by
-- finalizeHouseSenateGeneral / finalizePresident in app/actions/elections.ts. roles_applied_at ensures we never
-- double-apply transitions even if the RPC fires twice.

alter table public.elections
  add column if not exists roles_applied_at timestamptz;

create or replace function public._apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  winner_role text;
  incompat text[];
  leadership text[];
begin
  select id, office, state, district_code, senate_class, phase, winner_user_id, roles_applied_at
    into race
    from public.elections
    where id = e_election;
  if not found then
    return;
  end if;
  if race.phase <> 'closed'::public.election_phase then
    return;
  end if;
  if race.roles_applied_at is not null then
    return;
  end if;

  leadership := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president'];
  end if;

  -- Winner transitions.
  if race.winner_user_id is not null then
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    update public.profiles p
      set office_role = winner_role,
          updated_at = now()
      where p.id = race.winner_user_id
        and (
          p.office_role is null
          or p.office_role = 'citizen'
          or p.office_role = winner_role
          or p.office_role = any(incompat)
          or p.office_role = any(leadership)
        );
  end if;

  -- Loser transitions: drop the office role only if their own seat was what they ran for and lost.
  for cand in
    select ec.user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'house' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.district_code, '')) then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';
    end if;

    -- New congress implicitly resets leadership for anyone in the race.
    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p
      set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  update public.elections
    set roles_applied_at = now()
    where id = e_election;
end;
$$;

-- Public wrapper callable from app server actions (admin-only).
create or replace function public.apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'apply_election_role_transitions requires admin';
  end if;
  perform public._apply_election_role_transitions(e_election);
end;
$$;

revoke all on function public._apply_election_role_transitions(uuid) from public;
revoke all on function public.apply_election_role_transitions(uuid) from public;
grant execute on function public.apply_election_role_transitions(uuid) to authenticated;

-- Extend the auto-close helper to apply transitions after finalizing the winner.
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
  active_count numeric;
begin
  select e.office, e.district_code
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  if race.office = 'president' then
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
    perform public._apply_election_role_transitions(e_election);
    return;
  end if;

  update public.elections
    set phase = 'closed'::public.election_phase,
        winner_user_id = winner_user
    where id = e_election;

  perform public._apply_election_role_transitions(e_election);
end;
$$;

comment on function public.apply_election_role_transitions(uuid) is
  'Admin-only: grants winner role / revokes seat from losers whose seat was up / resets leadership. Idempotent via elections.roles_applied_at.';
