-- Player council seats in caucus + lite city budget propose/vote flow.

alter table public.campaign_caucus_members
  add column if not exists holder_user_id uuid references auth.users (id) on delete set null;

-- Rebuild caucus from ward incumbents; player-held wards link holder_user_id.
create or replace function public.sync_campaign_council_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_caucus_members where true;

  insert into public.campaign_caucus_members (
    sim_politician_id, chamber, party, seat_label, sort_order, holder_user_id
  )
  select
    sp.id,
    'council',
    sp.party,
    w.code,
    row_number() over (order by w.code)::smallint,
    w.claimed_by
  from public.wards w
  join public.sim_politicians sp on sp.id = w.incumbent_politician_id
  where w.city_code = 'MB'
  order by w.code;

  return jsonb_build_object(
    'ok', true,
    'members', (select count(*)::int from public.campaign_caucus_members),
    'player_seats', (select count(*)::int from public.campaign_caucus_members where holder_user_id is not null)
  );
end;
$$;

create or replace function public.bootstrap_campaign_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.sync_campaign_council_caucus();
end;
$$;

grant execute on function public.sync_campaign_council_caucus() to authenticated;

-- When a player wins a council ward, claim the seat and refresh caucus.
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
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    update public.profiles p
      set office_role = winner_role,
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

-- ---------- Lite city budget RPCs ----------

create table if not exists public.city_budget_member_votes (
  budget_id uuid not null references public.city_budgets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote text not null check (vote in ('yea', 'nay')),
  voted_at timestamptz not null default now(),
  primary key (budget_id, user_id)
);

alter table public.city_budget_member_votes enable row level security;
drop policy if exists "city_budget_member_votes read" on public.city_budget_member_votes;
create policy "city_budget_member_votes read" on public.city_budget_member_votes
  for select to authenticated using (true);

create or replace function public.mayor_propose_city_budget(
  p_finance numeric default 12,
  p_police numeric default 28,
  p_public_works numeric default 18,
  p_parks numeric default 10,
  p_planning numeric default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  budget_id uuid;
  fy smallint := 1;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may propose the city budget';
  end if;

  select coalesce(max(fiscal_year), 0) + 1 into fy from public.city_budgets where status = 'enacted';
  if fy < 1 then fy := 1; end if;

  if exists (select 1 from public.city_budgets where status in ('proposed', 'council_vote')) then
    raise exception 'A budget is already pending council action';
  end if;

  insert into public.city_budgets (fiscal_year, status, proposed_by)
  values (fy, 'council_vote', v_uid)
  returning id into budget_id;

  insert into public.city_budget_lines (budget_id, department_key, amount_millions) values
    (budget_id, 'finance', coalesce(p_finance, 0)),
    (budget_id, 'police', coalesce(p_police, 0)),
    (budget_id, 'public_works', coalesce(p_public_works, 0)),
    (budget_id, 'parks', coalesce(p_parks, 0)),
    (budget_id, 'planning', coalesce(p_planning, 0));

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object('ok', true, 'budget_id', budget_id, 'fiscal_year', fy);
end;
$$;

create or replace function public.finalize_city_budget_vote(p_budget_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  mayor_party text;
  cm record;
  pv record;
  yeas smallint := 0;
  nays smallint := 0;
  vote text;
  player_voted boolean;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  select p.party into mayor_party
  from public.profiles p
  where p.id = b.proposed_by;

  for cm in
    select c.party, c.holder_user_id, c.seat_label
    from public.campaign_caucus_members c
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    if cm.holder_user_id is not null then
      select v.vote into vote
      from public.city_budget_member_votes v
      where v.budget_id = p_budget_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_party_line_vote(cm.party, coalesce(mayor_party, 'democrat'));
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;
  end loop;

  update public.city_budgets set council_yeas = yeas, council_nays = nays where id = p_budget_id;

  if yeas >= 4 then
    update public.city_budgets set status = 'enacted', enacted_at = now() where id = p_budget_id;
    return jsonb_build_object('ok', true, 'passed', true, 'yeas', yeas, 'nays', nays);
  end if;

  update public.city_budgets set status = 'rejected' where id = p_budget_id;
  return jsonb_build_object('ok', true, 'passed', false, 'yeas', yeas, 'nays', nays);
end;
$$;

create or replace function public.council_member_budget_vote(
  p_budget_id uuid,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vote text := lower(trim(coalesce(p_vote, '')));
  b record;
  cm record;
  player_votes smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if v_vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key = 'council_member'
  ) then
    raise exception 'Only council members may vote on the budget';
  end if;

  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  select * into cm from public.campaign_caucus_members
  where chamber = 'council' and holder_user_id = v_uid;
  if cm.sim_politician_id is null then
    raise exception 'Your ward is not seated on the council caucus roster — ask admin to sync caucus';
  end if;

  insert into public.city_budget_member_votes (budget_id, user_id, vote)
  values (p_budget_id, v_uid, v_vote)
  on conflict (budget_id, user_id) do update set vote = excluded.vote, voted_at = now();

  select count(*)::smallint into player_votes
  from public.city_budget_member_votes where budget_id = p_budget_id;

  if player_votes >= (
    select count(*)::smallint from public.campaign_caucus_members
    where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(p_budget_id);
  end if;

  return jsonb_build_object('ok', true, 'pending', true, 'player_votes', player_votes);
end;
$$;

grant execute on function public.mayor_propose_city_budget(numeric, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.council_member_budget_vote(uuid, text) to authenticated;
grant execute on function public.finalize_city_budget_vote(uuid) to authenticated;

notify pgrst, 'reload schema';
