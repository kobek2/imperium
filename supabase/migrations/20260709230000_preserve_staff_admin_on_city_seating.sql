-- Staff operators who win city offices must keep admin/staff_super grants and profile marker.
-- Repair: Bleu Bell lost legacy admin when seated as mayor (office_role overwritten, no grant row).

insert into public.government_role_grants (user_id, role_key)
select p.id, 'admin'
from public.profiles p
where lower(trim(coalesce(p.character_name, ''))) = 'bleu bell'
  and not exists (
    select 1
    from public.government_role_grants g
    where g.user_id = p.id
      and g.role_key in ('admin', 'staff_super')
  )
on conflict (user_id, role_key) do nothing;

create or replace function public._apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  winner record;
  winner_role text;
  incompat text[];
  leadership text[];
  winner_party text;
  party_code char(1);
  winner_was_staff boolean := false;
begin
  select id, office, state, district_code, ward_code, senate_class, phase, winner_user_id, winner_candidate_id, roles_applied_at
    into race
    from public.elections
    where id = e_election;
  if not found then return; end if;
  if race.phase <> 'closed'::public.election_phase then return; end if;
  if race.roles_applied_at is not null then return; end if;

  leadership := array[
    'council_spokesperson',
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.office = 'mayor' then
    winner_role := 'mayor';
    incompat := array['council_member', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'council_ward' then
    winner_role := 'council_member';
    incompat := array['mayor', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president', 'mayor', 'council_member'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president', 'mayor', 'council_member'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president', 'mayor', 'council_member'];
  end if;

  if race.winner_user_id is not null then
    select exists (
      select 1
      from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and g.role_key in ('admin', 'staff_super')
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = race.winner_user_id
        and p.office_role = 'admin'
    )
    into winner_was_staff;

    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    if winner_was_staff then
      insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, 'admin')
      on conflict (user_id, role_key) do nothing;
    end if;

    update public.profiles p
      set office_role = case when winner_was_staff then 'admin' else winner_role end,
          home_district_code = case
            when race.office = 'council_ward' then coalesce(race.ward_code, p.home_district_code)
            else p.home_district_code
          end,
          residence_state = case
            when race.office in ('mayor', 'council_ward') then 'MB'
            else p.residence_state
          end,
          updated_at = now()
      where p.id = race.winner_user_id;

    if race.office in ('mayor', 'council_ward') then
      perform public._open_city_office_salary_term(race.winner_user_id, winner_role, 'MB');
    end if;

    if race.office = 'council_ward' and race.ward_code is not null then
      select ec.party, ec.sim_politician_id, pr.display_name
        into winner
        from public.election_candidates ec
        left join public.profiles pr on pr.id = ec.user_id
        where ec.election_id = e_election and ec.user_id = race.winner_user_id
        limit 1;

      winner_party := coalesce(winner.party, 'democrat');
      party_code := public._party_to_incumbent_code(winner_party);

      if winner.sim_politician_id is not null then
        update public.wards w set
          incumbent_politician_id = winner.sim_politician_id,
          incumbent_party = party_code,
          incumbent_npc_name = coalesce(nullif(trim(winner.display_name), ''), w.incumbent_npc_name),
          claimed_by = race.winner_user_id
        where w.code = race.ward_code;
      else
        update public.wards w set
          incumbent_party = party_code,
          incumbent_npc_name = coalesce(nullif(trim(winner.display_name), ''), w.incumbent_npc_name),
          claimed_by = race.winner_user_id
        where w.code = race.ward_code;
      end if;

      perform public.sync_campaign_council_caucus();
    elsif race.office = 'mayor' then
      update public.mayor_seat ms set
        incumbent_politician_id = (
          select ec.sim_politician_id from public.election_candidates ec
          where ec.election_id = e_election and ec.user_id = race.winner_user_id
          limit 1
        )
      where ms.city_code = 'MB';
    end if;
  end if;

  for cand in
    select ec.user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'council_ward' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.ward_code, ''))
         or upper(coalesce(cand.residence_state, '')) = 'MB' then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'council_member';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'council_member';
      end if;
    elsif race.office = 'mayor' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'mayor';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'mayor';
    elsif race.office = 'house' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.district_code, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';
    end if;

    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  update public.elections set roles_applied_at = now() where id = e_election;
end;
$$;

notify pgrst, 'reload schema';
