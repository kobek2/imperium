-- Reopen biennium budgets that were enacted without any player council participation
-- (NPC mayor + NPC caucus auto-pass before a player won a seat).

alter table public.city_budgets drop constraint if exists city_budgets_status_check;
alter table public.city_budgets add constraint city_budgets_status_check
  check (status in ('draft', 'proposed', 'council_vote', 'awaiting_mayor', 'enacted', 'rejected', 'vetoed', 'superseded'));

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
  );
$$;

create or replace function public._city_budget_had_player_council_input(p_budget_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.city_budget_roll_calls rc
    where rc.budget_id = p_budget_id
      and rc.user_id is not null
  )
  or exists (
    select 1
    from public.city_budget_member_votes v
    where v.budget_id = p_budget_id
  );
$$;

create or replace function public._city_supersede_npc_only_biennium_budget(p_biennium smallint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  superseded_any boolean := false;
begin
  if not public._city_has_player_council_seats() then
    return false;
  end if;

  for b in
    select id
    from public.city_budgets
    where fiscal_year = p_biennium
      and status = 'enacted'
      and not public._city_budget_had_player_council_input(id)
  loop
    update public.city_budgets
    set status = 'superseded'
    where id = b.id;
    superseded_any := true;
  end loop;

  return superseded_any;
end;
$$;

create or replace function public._city_biennium_budget_enacted(p_biennium smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.city_budgets b
    where b.fiscal_year = p_biennium
      and b.status = 'enacted'
  );
$$;

create or replace function public.mayor_propose_city_budget(
  p_finance numeric default null,
  p_police numeric default null,
  p_public_works numeric default null,
  p_parks numeric default null,
  p_planning numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  budget_id uuid;
  fy smallint;
  rev numeric;
  exp numeric;
  def numeric;
  epoch timestamptz;
  biennium smallint;
  f numeric := coalesce(p_finance, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'finance'));
  pol numeric := coalesce(p_police, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'police'));
  pw numeric := coalesce(p_public_works, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'public_works'));
  pk numeric := coalesce(p_parks, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'parks'));
  pl numeric := coalesce(p_planning, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'planning'));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may propose the city budget';
  end if;

  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  biennium := public._city_biennium_index_from_epoch(epoch);

  perform public._city_supersede_npc_only_biennium_budget(biennium);

  if not public._city_budget_propose_allowed(epoch) then
    raise exception 'City budget may only be proposed during sign-ups or legislative session until the biennium budget is enacted';
  end if;

  if public._city_biennium_budget_in_flight(biennium) then
    raise exception 'A budget is already pending council action or mayor signature for this biennium';
  end if;

  rev := public._city_biennial_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;
  fy := biennium;

  insert into public.city_budgets (
    fiscal_year, status, proposed_by,
    projected_revenue_millions, projected_expenditure_millions, projected_deficit_millions
  ) values (
    fy, 'council_vote', v_uid, rev, exp, def
  )
  returning id into budget_id;

  insert into public.city_budget_lines (budget_id, department_key, amount_millions) values
    (budget_id, 'finance', coalesce(f, 0)),
    (budget_id, 'police', coalesce(pol, 0)),
    (budget_id, 'public_works', coalesce(pw, 0)),
    (budget_id, 'parks', coalesce(pk, 0)),
    (budget_id, 'planning', coalesce(pl, 0));

  -- Only skip the council vote when the entire caucus is NPC-held.
  if not public._city_has_player_council_seats() then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object('ok', true, 'budget_id', budget_id, 'fiscal_year', fy, 'biennium', true);
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

  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  biennium := public._city_biennium_index_from_epoch(epoch);
  perform public._city_supersede_npc_only_biennium_budget(biennium);

  return true;
end;
$$;

-- Backfill: player council seats exist but biennium budget was NPC-only enacted.
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

grant execute on function public._city_has_player_council_seats() to authenticated, service_role;
grant execute on function public._city_budget_had_player_council_input(uuid) to authenticated, service_role;
grant execute on function public._city_supersede_npc_only_biennium_budget(smallint) to authenticated, service_role;

notify pgrst, 'reload schema';
