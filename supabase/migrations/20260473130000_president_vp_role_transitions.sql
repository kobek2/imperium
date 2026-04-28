-- When a presidential election closes: grant vice_president to the winning ticket's running_mate,
-- and strip vice_president from losing tickets' running mates. (President was already granted to
-- winner_user_id; running mates were never handled.)
--
-- Also adds admin_reapply_presidential_role_transitions for races that already ran the old logic
-- (roles_applied_at set) so staff can re-run transitions once after deploying this migration.

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
  winner_mate uuid;
  incompat_mate text[];
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

  if race.leadership_role is not null then
    if race.winner_user_id is not null then
      delete from public.government_role_grants g
        using public.election_candidates ec
       where ec.election_id = e_election
         and ec.user_id = g.user_id
         and ec.user_id <> race.winner_user_id
         and g.role_key = race.leadership_role;

      delete from public.government_role_grants g
       where g.role_key = race.leadership_role
         and g.user_id <> race.winner_user_id;

      insert into public.government_role_grants (user_id, role_key)
        values (race.winner_user_id, race.leadership_role)
        on conflict (user_id, role_key) do nothing;
    else
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role;
    end if;

    update public.elections
      set roles_applied_at = now()
      where id = e_election;
    return;
  end if;

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

  if race.office = 'president' and race.winner_user_id is not null then
    select ec.running_mate_user_id into winner_mate
    from public.election_candidates ec
    where ec.election_id = e_election
      and ec.user_id = race.winner_user_id
    limit 1;

    if winner_mate is not null then
      incompat_mate := array['representative', 'senator', 'president', 'vice_president'];
      delete from public.government_role_grants g
        where g.user_id = winner_mate
          and (g.role_key = any(leadership) or g.role_key = any(incompat_mate));

      insert into public.government_role_grants (user_id, role_key)
        values (winner_mate, 'vice_president')
        on conflict (user_id, role_key) do nothing;

      update public.profiles p
        set office_role = 'vice_president',
            updated_at = now()
        where p.id = winner_mate
          and (
            p.office_role is null
            or p.office_role = 'citizen'
            or p.office_role = 'vice_president'
            or p.office_role = any(incompat_mate)
            or p.office_role = any(leadership)
          );
    end if;
  end if;

  for cand in
    select ec.user_id, ec.running_mate_user_id, pr.residence_state, pr.home_district_code, pr.office_role
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

      if cand.running_mate_user_id is not null then
        delete from public.government_role_grants g
          where g.user_id = cand.running_mate_user_id and g.role_key = 'vice_president';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.running_mate_user_id and p.office_role = 'vice_president';
      end if;
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

create or replace function public.admin_reapply_presidential_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'admin_reapply_presidential_role_transitions requires staff admin';
  end if;

  select office, phase into r
  from public.elections
  where id = e_election;
  if not found then
    raise exception 'Election not found';
  end if;
  if r.office <> 'president' or r.phase <> 'closed'::public.election_phase then
    raise exception 'Only closed presidential elections can be re-applied';
  end if;

  update public.elections
    set roles_applied_at = null
    where id = e_election;

  perform public._apply_election_role_transitions(e_election);
end;
$$;

revoke all on function public.admin_reapply_presidential_role_transitions(uuid) from public;
grant execute on function public.admin_reapply_presidential_role_transitions(uuid) to authenticated;

notify pgrst, 'reload schema';
