-- Leadership elections: chamber-wide votes that decide who holds Speaker, Majority / Minority
-- Leader + Whip, and President Pro Tempore. These races look like regular elections but:
--
--   * No geographic slot (state / district / senate_class are all null).
--   * No primary phase — filing closes, and the general opens immediately.
--   * Winner selection is simple plurality of general_votes (no PVI, no campaign points).
--   * Role transition grants the leadership role_key WITHOUT revoking the winner's chamber
--     role (representative / senator). Losers keep their chamber role too; only the specific
--     leadership grant they were competing for is cleared from anyone who previously held it.
--
-- Ties: earliest filer wins, same tiebreak as the seat elections. Idempotent via
-- elections.roles_applied_at.

alter table public.elections
  add column if not exists leadership_role text,
  add column if not exists restricted_party text;

alter table public.elections
  drop constraint if exists elections_leadership_role_valid;
alter table public.elections
  add constraint elections_leadership_role_valid check (
    leadership_role is null
    or leadership_role in (
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip',
      'president_pro_tempore'
    )
  );

alter table public.elections
  drop constraint if exists elections_restricted_party_valid;
alter table public.elections
  add constraint elections_restricted_party_valid check (
    restricted_party is null or restricted_party in ('democrat', 'republican', 'independent')
  );

-- The original check enforced that seat elections carry geography. Leadership races don't,
-- so we widen the constraint to allow leadership rows when leadership_role is set.
alter table public.elections
  drop constraint if exists elections_office_valid;
alter table public.elections
  drop constraint if exists elections_check;
alter table public.elections
  drop constraint if exists elections_check1;

alter table public.elections
  add constraint elections_office_valid check (
    (
      leadership_role is not null
      and state is null and district_code is null and senate_class is null
      and office in ('house', 'senate')
    )
    or (
      leadership_role is null
      and (
        (office = 'house'     and district_code is not null and state is not null)
        or (office = 'senate' and state is not null and senate_class is not null and district_code is null)
        or (office = 'president' and state is null and district_code is null)
      )
    )
  );

-- ---------- Role transitions ----------
-- Rewrite to branch on leadership_role. The original behaviour for seat elections is
-- preserved verbatim; the new branch only grants/revokes the specific leadership role
-- and never touches chamber roles.

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
  select id, office, state, district_code, senate_class, phase, winner_user_id,
         roles_applied_at, leadership_role
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

  -- ---- Branch A: leadership race. Chamber roles are untouched; only the specific
  --       leadership grant we're electing for is reassigned.
  if race.leadership_role is not null then
    if race.winner_user_id is not null then
      -- Every non-winner candidate in this race loses THIS leadership role (if they
      -- held it previously). Non-candidates keep whatever they already have.
      delete from public.government_role_grants g
        using public.election_candidates ec
       where ec.election_id = e_election
         and ec.user_id = g.user_id
         and ec.user_id <> race.winner_user_id
         and g.role_key = race.leadership_role;

      -- Also clear any prior holder of this role who isn't in this race (e.g. someone who
      -- didn't file for re-election). They lose the specific leadership grant; chamber
      -- role is unaffected.
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role
         and g.user_id <> race.winner_user_id;

      -- Grant the leadership role_key to the winner. Upsert so re-election is a no-op.
      insert into public.government_role_grants (user_id, role_key)
        values (race.winner_user_id, race.leadership_role)
        on conflict (user_id, role_key) do nothing;
    else
      -- Race closed with no winner (e.g. no filers). Vacate the role.
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role;
    end if;

    update public.elections
      set roles_applied_at = now()
      where id = e_election;
    return;
  end if;

  -- ---- Branch B: regular seat race. Preserves the original 20260423 behaviour.
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

-- ---------- Auto-close ----------
-- Leadership races use plain plurality of general_votes. Seat races keep the existing 60/40
-- scoring with PVI lean (copied verbatim from 20260425).

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
  best_created timestamptz;
  best_is_set boolean := false;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
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

-- ---------- Phase scheduler ----------
-- Leadership races skip primary: when filing_closes_at passes they go straight to general.
-- Otherwise the scheduler matches the regular path.

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
    and filing_closes_at < now();

  -- Leadership races: filing -> general when filing closes (no primary).
  update public.elections
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
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

  -- General auto-close covers House/Senate (seat races) and every leadership race. Presidential
  -- seat races still require admin certification.
  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.general_closes_at is not null
      and e.general_closes_at < now()
      and (e.leadership_role is not null or e.office <> 'president')
  loop
    perform public._close_general_for_election(r.id);
  end loop;
end;
$$;

revoke all on function public._apply_election_role_transitions(uuid) from public;
revoke all on function public._close_general_for_election(uuid) from public;
revoke all on function public.advance_election_phases_by_schedule() from public;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated;

comment on function public.advance_election_phases_by_schedule() is
  'Seat races: filing->primary->general->closed with 60/40 scoring. Leadership races (elections.leadership_role set): filing->general->closed by plain plurality.';
