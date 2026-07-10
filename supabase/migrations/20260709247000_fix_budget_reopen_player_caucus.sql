-- Reopen NPC-only enacted budgets after a player wins council: keep ward sim ids,
-- include all wards in caucus sync, and supersede on status tick / page load.

create or replace function public._city_has_player_council_seats()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_caucus_members c
    where c.chamber = 'council'
      and c.holder_user_id is not null
  )
  or exists (
    select 1
    from public.wards w
    where w.city_code = 'MB'
      and w.claimed_by is not null
  )
  or exists (
    select 1
    from public.government_role_grants g
    where g.role_key = 'council_member'
  );
$$;

create or replace function public.sync_campaign_council_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_caucus_members where chamber = 'council';

  insert into public.campaign_caucus_members (
    sim_politician_id, chamber, party, seat_label, sort_order, holder_user_id
  )
  select
    coalesce(w.incumbent_politician_id, roster.id),
    'council',
    coalesce(sp.party, roster.party),
    w.code,
    row_number() over (order by w.code)::smallint,
    w.claimed_by
  from public.wards w
  left join public.sim_politicians sp on sp.id = w.incumbent_politician_id
  left join lateral (
    select sp2.id, sp2.party
    from public.sim_politicians sp2
    where sp2.office = 'council'
      and sp2.ward_code = w.code
    order by
      case
        when sp2.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end
          then 0
        else 1
      end,
      sp2.slug
    limit 1
  ) roster on true
  where w.city_code = 'MB'
    and coalesce(w.incumbent_politician_id, roster.id) is not null;

  return jsonb_build_object(
    'ok', true,
    'members', (select count(*)::int from public.campaign_caucus_members where chamber = 'council'),
    'player_seats', (select count(*)::int from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null)
  );
end;
$$;

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
  winner_label text;
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

  if race.office = 'council_ward' and race.ward_code is not null then
    perform public._vacate_city_council_ward_seat(race.ward_code, race.winner_user_id);
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
      select ec.party,
             ec.sim_politician_id,
             coalesce(nullif(trim(pr.character_name), ''), nullif(trim(ec.npc_name), '')) as character_name
        into winner
        from public.election_candidates ec
        left join public.profiles pr on pr.id = ec.user_id
        where ec.election_id = e_election and ec.user_id = race.winner_user_id
        limit 1;

      winner_party := coalesce(winner.party, 'democrat');
      party_code := public._party_to_incumbent_code(winner_party);
      winner_label := coalesce(nullif(trim(winner.character_name), ''), 'Council Member');

      update public.wards w set
        incumbent_politician_id = coalesce(winner.sim_politician_id, w.incumbent_politician_id),
        incumbent_party = party_code,
        incumbent_npc_name = winner_label,
        claimed_by = race.winner_user_id
      where w.code = race.ward_code;

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
      and ec.user_id is not null
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'council_ward' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.ward_code, ''))
         or upper(coalesce(cand.residence_state, '')) = 'MB' then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'council_member';
        update public.profiles p
          set office_role = case
                when p.office_role = 'council_member' then null
                else p.office_role
              end,
              updated_at = now()
          where p.id = cand.user_id;
      end if;
    elsif race.office = 'mayor' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'mayor';
      update public.profiles p
        set office_role = case
              when p.office_role = 'mayor' then null
              else p.office_role
            end,
            updated_at = now()
        where p.id = cand.user_id;
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

create or replace function public.reopen_city_biennium_budget_if_needed(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  epoch timestamptz;
  biennium smallint;
  superseded boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  perform public.sync_campaign_council_caucus();

  select epoch_started_at into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  biennium := public._city_biennium_index_from_epoch(coalesce(epoch, now()));
  superseded := public._city_supersede_npc_only_biennium_budget(biennium);

  return jsonb_build_object(
    'ok', true,
    'biennium', biennium,
    'superseded', superseded,
    'has_player_council_seats', public._city_has_player_council_seats(),
    'budget_enacted', public._city_biennium_budget_enacted(biennium),
    'budget_propose_allowed', public._city_budget_propose_allowed(coalesce(epoch, now()))
  );
end;
$$;

create or replace function public.ensure_city_election_seating(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  needs_seat boolean := false;
  expected_role text;
  epoch timestamptz;
  biennium smallint;
begin
  select e.id, e.office, e.state, e.phase, e.winner_user_id, e.ward_code, e.roles_applied_at
    into race
    from public.elections e
    where e.id = p_election_id;
  if not found then
    return false;
  end if;
  if race.phase <> 'closed'::public.election_phase or race.winner_user_id is null then
    return false;
  end if;
  if not public._city_is_mb_election(race.office::text, race.state) then
    return false;
  end if;
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> race.winner_user_id and not public.is_staff_admin(auth.uid()) then
    raise exception 'Only the certified winner or staff may apply seating';
  end if;

  expected_role := case race.office when 'mayor' then 'mayor' when 'council_ward' then 'council_member' else null end;
  if expected_role is null then
    return false;
  end if;

  needs_seat := not exists (
    select 1
    from public.government_role_grants g
    where g.user_id = race.winner_user_id
      and g.role_key = expected_role
  );

  if race.office = 'council_ward' and race.ward_code is not null then
    needs_seat := needs_seat or not exists (
      select 1
      from public.wards w
      where w.code = race.ward_code
        and w.claimed_by = race.winner_user_id
    );
  end if;

  if needs_seat then
    update public.elections
    set roles_applied_at = null
    where id = p_election_id;

    perform public._apply_election_role_transitions(p_election_id);
  end if;

  perform public.sync_campaign_council_caucus();

  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  biennium := public._city_biennium_index_from_epoch(coalesce(epoch, now()));
  perform public._city_supersede_npc_only_biennium_budget(biennium);

  return true;
end;
$$;

create or replace function public.tick_city_realtime_scheduler(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  eng record;
  epoch timestamptz;
  elapsed numeric;
  cycle_idx bigint;
  pos numeric;
  phase text;
  sim_yr smallint;
  biennium smallint;
  even_yr smallint;
  phase_changed boolean := false;
  elections_opened int := 0;
  class_b_opened int := 0;
  salary_forfeited int := 0;
  election_out jsonb;
  council_vote_out jsonb;
  cycle_start timestamptz;
  budget_passed boolean;
begin
  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week, turn_phase, epoch_started_at)
    values (p_city_code, 0, 1, 1, 'sign_ups_open', now())
    returning * into eng;
  end if;

  epoch := coalesce(eng.epoch_started_at, now());
  elapsed := public._city_elapsed_hours(epoch);
  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  pos := public._city_position_in_cycle_hours(epoch);
  phase := public._city_cycle_phase_from_epoch(epoch);
  sim_yr := public._city_sim_year_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;

  perform public.sync_campaign_council_caucus();
  perform public._city_supersede_npc_only_biennium_budget(biennium);

  budget_passed := public._city_biennium_budget_passed(biennium);

  if eng.last_cycle_phase is distinct from phase then
    phase_changed := true;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  salary_forfeited := public._city_forfeit_expired_salary_windows(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);
  council_vote_out := public._city_advance_expired_council_votes();

  if cycle_idx <> coalesce(eng.last_cycle_index, -1) then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours())::int);
    elections_opened := public._city_open_election_cycle(
      p_city_code,
      (cycle_idx * 2 + 1)::smallint,
      cycle_start
    );
  end if;

  if pos >= public._city_sim_year_hours()
     and coalesce(eng.class_b_cycle_opened, -1) <> cycle_idx then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours() + public._city_sim_year_hours())::int);
    class_b_opened := public._city_open_election_cycle(p_city_code, even_yr, cycle_start);
    update public.city_sim_engine_state
    set class_b_cycle_opened = cycle_idx
    where city_code = p_city_code;
  end if;

  election_out := public._city_advance_mb_election_phases();

  update public.city_sim_engine_state
  set
    sim_year = sim_yr,
    sim_week = 1,
    turn_phase = phase::public.city_turn_phase,
    last_cycle_index = cycle_idx,
    last_cycle_phase = phase,
    updated_at = now()
  where city_code = p_city_code;

  update public.city_fiscal_metrics
  set fiscal_year = biennium, updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'sim_year', sim_yr,
    'biennium_index', biennium,
    'cycle_index', cycle_idx,
    'cycle_phase', phase,
    'position_in_cycle_hours', round(pos, 2),
    'phase_changed', phase_changed,
    'active_council_class', public._city_active_council_class(sim_yr),
    'mayor_election_active', public._city_mayor_election_active(sim_yr),
    'budget_proposal_open', phase = 'sign_ups_open',
    'budget_propose_allowed', public._city_budget_propose_allowed(epoch),
    'budget_enacted', public._city_biennium_budget_enacted(biennium),
    'budget_passed', budget_passed,
    'ordinances_allowed', phase = 'legislative' and budget_passed,
    'elections_opened', elections_opened,
    'class_b_opened', class_b_opened,
    'salary_forfeited', salary_forfeited,
    'election_track', election_out,
    'council_votes', council_vote_out
  );
end;
$$;

-- Backfill wards that lost incumbent_politician_id when a player won without a sim_politician link.
update public.wards w
set incumbent_politician_id = sp.id
from public.sim_politicians sp
where w.city_code = 'MB'
  and w.incumbent_politician_id is null
  and w.claimed_by is not null
  and sp.office = 'council'
  and sp.ward_code = w.code
  and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end;

select public.sync_campaign_council_caucus();

do $$
declare
  eng record;
  biennium smallint;
begin
  select epoch_started_at into eng from public.city_sim_engine_state where city_code = 'MB';
  if eng.epoch_started_at is not null then
    biennium := public._city_biennium_index_from_epoch(eng.epoch_started_at);
    perform public._city_supersede_npc_only_biennium_budget(biennium);
  end if;
end;
$$;

grant execute on function public.reopen_city_biennium_budget_if_needed(char) to authenticated, service_role;

notify pgrst, 'reload schema';
