-- NPC floor votes, sim leadership grants, and automation hooks for unattended races.

-- ---------- Sim floor votes ----------

create table if not exists public.bill_sim_votes (
  bill_id uuid not null references public.bills (id) on delete cascade,
  sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  chamber text not null check (chamber in ('house', 'senate')),
  vote text not null check (vote in ('yea', 'nay', 'abstain', 'present')),
  created_at timestamptz not null default now(),
  primary key (bill_id, sim_politician_id, chamber)
);

create index if not exists bill_sim_votes_bill_chamber_idx
  on public.bill_sim_votes (bill_id, chamber);

alter table public.bill_sim_votes enable row level security;
drop policy if exists "bill_sim_votes readable" on public.bill_sim_votes;
create policy "bill_sim_votes readable" on public.bill_sim_votes for select using (true);

-- ---------- Sim leadership grants (cosmetic officers without auth.users) ----------

create table if not exists public.sim_government_role_grants (
  sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  role_key text not null,
  granted_at timestamptz not null default now(),
  primary key (sim_politician_id, role_key)
);

create unique index if not exists sim_government_role_grants_one_per_role
  on public.sim_government_role_grants (role_key);

alter table public.sim_government_role_grants enable row level security;
drop policy if exists "sim_government_role_grants readable" on public.sim_government_role_grants;
create policy "sim_government_role_grants readable" on public.sim_government_role_grants for select using (true);

-- ---------- Helpers ----------

create or replace function public._leadership_role_party(
  p_role text,
  p_majority_party text
)
returns text
language sql
immutable
as $$
  select case
    when p_role in (
      'speaker', 'house_majority_leader', 'house_majority_whip',
      'president_pro_tempore', 'senate_majority_leader', 'senate_majority_whip'
    ) then p_majority_party
    when p_role in (
      'house_minority_leader', 'house_minority_whip',
      'senate_minority_leader', 'senate_minority_whip'
    ) then case p_majority_party
      when 'democrat' then 'republican'
      when 'republican' then 'democrat'
      else 'democrat'
    end
    else p_majority_party
  end;
$$;

create or replace function public._pick_sim_politician_for_leadership(
  p_chamber text,
  p_role text,
  p_majority_party text,
  p_exclude_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
stable
as $$
declare
  target_party text;
  picked uuid;
begin
  target_party := public._leadership_role_party(p_role, p_majority_party);

  if p_chamber = 'house' then
    select sp.id into picked
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.office = 'house'
      and sp.party = target_party
      and not (sp.id = any (p_exclude_ids))
    order by sp.character_name asc, sp.id asc
    limit 1;
  else
    select sp.id into picked
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.office = 'senate'
      and sp.party = target_party
      and not (sp.id = any (p_exclude_ids))
    order by seat.state_code asc, seat.senate_class asc, sp.character_name asc, sp.id asc
    limit 1;
  end if;

  return picked;
end;
$$;

create or replace function public._house_district_held_by_player(p_district_code text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where upper(trim(coalesce(p.home_district_code, ''))) = upper(trim(coalesce(p_district_code, '')))
      and (
        p.office_role = 'representative'
        or exists (
          select 1 from public.government_role_grants g
          where g.user_id = p.id and g.role_key = 'representative'
        )
      )
  );
$$;

create or replace function public._senate_roster_slots_held_by_players(p_state_code text)
returns int
language sql
stable
as $$
  select count(distinct p.id)::int
  from public.profiles p
  where upper(trim(coalesce(p.residence_state, ''))) = upper(trim(coalesce(p_state_code, '')))
    and (
      p.office_role = 'senator'
      or exists (
        select 1 from public.government_role_grants g
        where g.user_id = p.id and g.role_key = 'senator'
      )
    );
$$;

create or replace function public._sim_vote_for_author_party(
  p_politician_party text,
  p_author_party text
)
returns text
language sql
immutable
as $$
  select case
    when p_author_party is null then 'abstain'
    when p_politician_party = p_author_party then 'yea'
    when p_politician_party is null then 'abstain'
    else 'nay'
  end;
$$;

create or replace function public.cast_sim_politician_floor_votes(p_bill_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  bill_row record;
  author_party text;
  chamber text;
  pol record;
  cast_count int := 0;
  vote_val text;
  player_senate_skip int;
begin
  select b.id, b.status, b.author_id
    into bill_row
    from public.bills b
    where b.id = p_bill_id;
  if not found then
    return 0;
  end if;

  if bill_row.status = 'house_floor' then
    chamber := 'house';
  elsif bill_row.status = 'senate_floor' then
    chamber := 'senate';
  else
    return 0;
  end if;

  select p.party into author_party
    from public.profiles p
    where p.id = bill_row.author_id;

  if chamber = 'house' then
    for pol in
      select sp.id, sp.party, d.code as district_code
      from public.districts d
      join public.sim_politicians sp on sp.id = d.incumbent_politician_id
      where d.incumbent_politician_id is not null
        and not public._house_district_held_by_player(d.code)
      order by d.code asc
    loop
      if exists (
        select 1 from public.bill_sim_votes v
        where v.bill_id = p_bill_id
          and v.sim_politician_id = pol.id
          and v.chamber = chamber
      ) then
        continue;
      end if;

      vote_val := public._sim_vote_for_author_party(pol.party, author_party);
      insert into public.bill_sim_votes (bill_id, sim_politician_id, chamber, vote)
      values (p_bill_id, pol.id, chamber, vote_val);
      cast_count := cast_count + 1;
    end loop;
  else
    for pol in
      select
        sp.id,
        sp.party,
        seat.state_code,
        seat.senate_class,
        row_number() over (
          partition by seat.state_code
          order by seat.senate_class asc, sp.character_name asc, sp.id asc
        ) as seat_rank
      from public.senate_seats seat
      join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
      where seat.incumbent_politician_id is not null
      order by seat.state_code asc, seat.senate_class asc
    loop
      player_senate_skip := public._senate_roster_slots_held_by_players(pol.state_code);
      if pol.seat_rank <= player_senate_skip then
        continue;
      end if;

      if exists (
        select 1 from public.bill_sim_votes v
        where v.bill_id = p_bill_id
          and v.sim_politician_id = pol.id
          and v.chamber = chamber
      ) then
        continue;
      end if;

      vote_val := public._sim_vote_for_author_party(pol.party, author_party);
      insert into public.bill_sim_votes (bill_id, sim_politician_id, chamber, vote)
      values (p_bill_id, pol.id, chamber, vote_val);
      cast_count := cast_count + 1;
    end loop;
  end if;

  return cast_count;
end;
$$;

create or replace function public.cast_active_bill_sim_votes()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  bill_id uuid;
  total int := 0;
begin
  for bill_id in
    select b.id
    from public.bills b
    where b.status in ('house_floor', 'senate_floor')
  loop
    total := total + public.cast_sim_politician_floor_votes(bill_id);
  end loop;
  return total;
end;
$$;

-- ---------- Leadership closeout: NPC fallback when nobody files ----------

create or replace function public.close_leadership_session(s_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  rk text;
  winner_user uuid;
  winner_sim uuid;
  best_votes integer;
  best_filed timestamptz;
  cand record;
  cand_votes integer;
  cand_filed timestamptz;
  roles text[];
  used_sim_ids uuid[] := '{}'::uuid[];
begin
  select id, chamber, phase, majority_party
    into sess
    from public.leadership_sessions
    where id = s_id
    for update;
  if not found then
    return;
  end if;
  if sess.phase = 'closed' then
    return;
  end if;

  if sess.chamber = 'house' then
    roles := array[
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip'
    ];
  else
    roles := array[
      'president_pro_tempore',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip'
    ];
  end if;

  foreach rk in array roles loop
    winner_user := null;
    winner_sim := null;
    best_votes := -1;
    best_filed := null;

    for cand in
      select
        c.id,
        c.user_id,
        c.created_at as filed_at,
        (
          select count(*)::int
          from public.leadership_session_votes v
          where v.session_id = s_id
            and v.role = rk
            and v.candidate_id = c.id
        ) as votes
      from public.leadership_session_candidates c
      where c.session_id = s_id and c.role = rk
      order by c.created_at asc, c.id asc
    loop
      cand_votes := cand.votes;
      cand_filed := cand.filed_at;
      if cand_votes > best_votes
         or (
           cand_votes = best_votes
           and (best_filed is null or cand_filed < best_filed)
         )
      then
        best_votes := cand_votes;
        winner_user := cand.user_id;
        best_filed := cand.filed_at;
      end if;
    end loop;

    delete from public.government_role_grants g
      where g.role_key = rk
        and (winner_user is null or g.user_id <> winner_user);

    delete from public.sim_government_role_grants sg
      where sg.role_key = rk;

    if winner_user is not null then
      insert into public.government_role_grants (user_id, role_key)
        values (winner_user, rk)
        on conflict (user_id, role_key) do nothing;
    else
      winner_sim := public._pick_sim_politician_for_leadership(
        sess.chamber, rk, sess.majority_party, used_sim_ids
      );
      if winner_sim is null then
        winner_sim := public._pick_sim_politician_for_leadership(
          sess.chamber, rk, sess.majority_party, '{}'::uuid[]
        );
      end if;
      if winner_sim is not null then
        insert into public.sim_government_role_grants (sim_politician_id, role_key)
          values (winner_sim, rk)
          on conflict (role_key) do update set
            sim_politician_id = excluded.sim_politician_id,
            granted_at = now();
        used_sim_ids := array_append(used_sim_ids, winner_sim);
      end if;
    end if;
  end loop;

  update public.leadership_sessions
    set phase = 'closed',
        closed_at = now()
    where id = s_id;
end;
$$;

-- ---------- Scheduler: tick NPC campaigns + guarantee general winners ----------

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
  perform public.tick_npc_campaigns(e_election);

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

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts,
           coalesce(ec.npc_synthetic_votes, 0) as synth_votes
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'house' then
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
    if race.office = 'house' then
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

create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public.tick_npc_campaigns(null);

  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

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
    begin
      perform public._close_primary_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: primary close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
  loop
    begin
      perform public.tick_npc_campaigns(r.id);
      perform public._close_general_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: general close failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.legislation_run_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.legislation_apply_leadership_deadlines();
  perform public.legislation_refresh_deputy_clerk_roles();
  perform public.cast_active_bill_sim_votes();
end;
$$;

grant execute on function public.cast_sim_politician_floor_votes(uuid) to authenticated, service_role;
grant execute on function public.cast_active_bill_sim_votes() to authenticated, service_role;

notify pgrst, 'reload schema';
