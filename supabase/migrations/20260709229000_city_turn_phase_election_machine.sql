-- City turn-phase election machine: 5 turns/year, staggered council classes, admin-only advance.

create type public.city_turn_phase as enum (
  'sign_ups_open',
  'primaries',
  'generals',
  'results',
  'oath_of_office'
);

alter table public.city_sim_engine_state
  add column if not exists turn_phase public.city_turn_phase not null default 'sign_ups_open';

comment on column public.city_sim_engine_state.sim_week is
  'Sim turn within sim_year (1–5). Advanced only by admin_advance_city_sim_turn.';
comment on column public.city_sim_engine_state.turn_phase is
  'Election track phase for the current sim turn (1: sign-ups … 5: oath).';

alter table public.wards
  add column if not exists election_class char(1) check (election_class in ('A', 'B'));

update public.wards
set election_class = case
  when code in ('W01', 'W02', 'W03', 'W04') then 'A'
  when code in ('W05', 'W06', 'W07') then 'B'
  else election_class
end
where city_code = 'MB';

alter table public.elections
  add column if not exists oath_pending boolean not null default false,
  add column if not exists city_sim_year smallint,
  add column if not exists city_sim_turn smallint;

-- Sync turn_phase from sim_week for existing rows.
update public.city_sim_engine_state
set turn_phase = case coalesce(sim_week, 1)
  when 1 then 'sign_ups_open'::public.city_turn_phase
  when 2 then 'primaries'::public.city_turn_phase
  when 3 then 'generals'::public.city_turn_phase
  when 4 then 'results'::public.city_turn_phase
  else 'oath_of_office'::public.city_turn_phase
end
where city_code = 'MB';

create or replace function public._city_turn_phase_from_turn(p_turn smallint)
returns public.city_turn_phase
language sql
immutable
as $$
  select case greatest(1, least(5, coalesce(p_turn, 1)))
    when 1 then 'sign_ups_open'::public.city_turn_phase
    when 2 then 'primaries'::public.city_turn_phase
    when 3 then 'generals'::public.city_turn_phase
    when 4 then 'results'::public.city_turn_phase
    else 'oath_of_office'::public.city_turn_phase
  end;
$$;

create or replace function public._city_active_council_class(p_sim_year smallint)
returns char(1)
language sql
immutable
as $$
  select case when coalesce(p_sim_year, 1) % 2 = 1 then 'A' else 'B' end;
$$;

create or replace function public._city_mayor_election_active(p_sim_year smallint)
returns boolean
language sql
immutable
as $$
  select coalesce(p_sim_year, 1) % 2 = 1;
$$;

create or replace function public._city_is_mb_election(p_office text, p_state text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_office, ''))) in ('mayor', 'council_ward')
    and upper(trim(coalesce(p_state, ''))) = 'MB';
$$;

create or replace function public._city_ward_in_active_class(p_ward_code text, p_sim_year smallint)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.wards w
    where w.code = upper(trim(p_ward_code))
      and w.city_code = 'MB'
      and w.election_class = public._city_active_council_class(p_sim_year)
  );
$$;

create or replace function public._city_revert_role_transitions_for_oath(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
begin
  select e.office, e.winner_user_id, e.ward_code into race
  from public.elections e where e.id = e_election;
  if not found then return; end if;
  if not public._city_is_mb_election(race.office::text, 'MB') then return; end if;

  if race.office = 'mayor' and race.winner_user_id is not null then
    delete from public.government_role_grants
    where user_id = race.winner_user_id and role_key = 'mayor';
    update public.profiles set office_role = null, updated_at = now()
    where id = race.winner_user_id and office_role = 'mayor';
  elsif race.office = 'council_ward' and race.winner_user_id is not null then
    delete from public.government_role_grants
    where user_id = race.winner_user_id and role_key = 'council_member';
    update public.profiles set office_role = null, updated_at = now()
    where id = race.winner_user_id and office_role = 'council_member';
    update public.wards set claimed_by = null
    where code = race.ward_code and claimed_by = race.winner_user_id;
  end if;
end;
$$;

create or replace function public._close_city_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._close_general_for_election(e_election);
  perform public._city_revert_role_transitions_for_oath(e_election);
  update public.elections
  set oath_pending = true
  where id = e_election;
end;
$$;

create or replace function public._city_apply_election_oaths(p_city_code char(2) default 'MB')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  n int := 0;
begin
  for e in
    select id from public.elections
    where oath_pending = true
      and phase = 'closed'::public.election_phase
      and public._city_is_mb_election(office::text, state)
      and winner_candidate_id is not null
  loop
    perform public._apply_election_role_transitions(e.id);
    update public.elections
    set oath_pending = false
    where id = e.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public._city_open_election_cycle(
  p_city_code char(2),
  p_sim_year smallint
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  active_class char(1) := public._city_active_council_class(p_sim_year);
  mayor_on boolean := public._city_mayor_election_active(p_sim_year);
  created int := 0;
begin
  if mayor_on and not exists (
    select 1 from public.elections e
    where e.office = 'mayor' and e.state = 'MB'
      and e.city_sim_year = p_sim_year
  ) then
    insert into public.elections (
      office, state, phase, filing_opens_at, filing_closes_at,
      primary_closes_at, general_closes_at, primary_party_wide,
      filing_window_started_at, city_sim_year, city_sim_turn, oath_pending
    ) values (
      'mayor', 'MB', 'filing', now(), now() + interval '100 years',
      now() + interval '100 years', now() + interval '100 years', true,
      now(), p_sim_year, 1, false
    );
    created := created + 1;
  end if;

  for w in
    select code from public.wards
    where city_code = p_city_code and election_class = active_class
    order by code
  loop
    if not exists (
      select 1 from public.elections e
      where e.office = 'council_ward' and e.ward_code = w.code
        and e.city_sim_year = p_sim_year
    ) then
      insert into public.elections (
        office, state, ward_code, phase, filing_opens_at, filing_closes_at,
        primary_closes_at, general_closes_at, primary_party_wide,
        filing_window_started_at, city_sim_year, city_sim_turn, oath_pending
      ) values (
        'council_ward', 'MB', w.code, 'filing', now(), now() + interval '100 years',
        now() + interval '100 years', now() + interval '100 years', true,
        now(), p_sim_year, 1, false
      );
      created := created + 1;
    end if;
  end loop;

  return created;
end;
$$;

create or replace function public._city_advance_election_track(
  p_city_code char(2),
  p_new_turn smallint,
  p_new_year smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  phase public.city_turn_phase := public._city_turn_phase_from_turn(p_new_turn);
  e record;
  opened int := 0;
  closed_primary int := 0;
  closed_general int := 0;
  oaths int := 0;
begin
  if phase = 'sign_ups_open' then
    opened := public._city_open_election_cycle(p_city_code, p_new_year);
  elsif phase = 'primaries' then
    for e in
      select id from public.elections
      where public._city_is_mb_election(office::text, state)
        and city_sim_year = p_new_year
        and phase = 'filing'::public.election_phase
    loop
      update public.elections set phase = 'primary'::public.election_phase, city_sim_turn = 2
      where id = e.id;
      perform public.seed_election_npc_opponents(e.id);
    end loop;
  elsif phase = 'generals' then
    for e in
      select id from public.elections
      where public._city_is_mb_election(office::text, state)
        and city_sim_year = p_new_year
        and phase = 'primary'::public.election_phase
    loop
      perform public._close_primary_for_election(e.id);
      update public.elections set phase = 'general'::public.election_phase, city_sim_turn = 3
      where id = e.id;
      closed_primary := closed_primary + 1;
    end loop;
  elsif phase = 'results' then
    for e in
      select id from public.elections
      where public._city_is_mb_election(office::text, state)
        and city_sim_year = p_new_year
        and phase = 'general'::public.election_phase
    loop
      perform public._close_city_general_for_election(e.id);
      update public.elections set city_sim_turn = 4 where id = e.id;
      closed_general := closed_general + 1;
    end loop;
  elsif phase = 'oath_of_office' then
    oaths := public._city_apply_election_oaths(p_city_code);
    update public.elections set city_sim_turn = 5
    where public._city_is_mb_election(office::text, state)
      and city_sim_year = p_new_year;
  end if;

  return jsonb_build_object(
    'phase', phase,
    'opened', opened,
    'closed_primary', closed_primary,
    'closed_general', closed_general,
    'oaths', oaths
  );
end;
$$;

-- City races are driven by admin turn advance only; federal/leadership races keep wall-clock schedule.
create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  update public.elections e
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now()
    and not public._city_is_mb_election(e.office::text, e.state);

  update public.elections e
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now()
    and not public._city_is_mb_election(e.office::text, e.state);

  for r in
    select e.id from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.filing_window_started_at is not null
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
      and not public._city_is_mb_election(e.office::text, e.state)
  loop
    begin
      perform public._close_primary_for_election(r.id);
    exception when others then
      raise warning 'advance_election_phases: primary close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select e.id from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
      and not public._city_is_mb_election(e.office::text, e.state)
  loop
    begin
      perform public.tick_npc_campaigns(r.id);
      perform public._close_general_for_election(r.id);
    exception when others then
      raise warning 'advance_election_phases: general close failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.get_city_sim_week_status(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  eng record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select sim_year, sim_week, sim_tick, turn_phase into eng
  from public.city_sim_engine_state where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'city_code', p_city_code,
    'sim_year', coalesce(eng.sim_year, 1),
    'sim_week', coalesce(eng.sim_week, 1),
    'sim_turn', coalesce(eng.sim_week, 1),
    'sim_tick', coalesce(eng.sim_tick, 0),
    'turn_phase', coalesce(eng.turn_phase::text, 'sign_ups_open'),
    'active_council_class', public._city_active_council_class(coalesce(eng.sim_year, 1)),
    'mayor_election_active', public._city_mayor_election_active(coalesce(eng.sim_year, 1)),
    'campaign_active', false,
    'campaign_cycle', null,
    'campaign_turn', null,
    'campaign_phase', null
  );
end;
$$;

create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  eng record;
  new_year smallint;
  new_week smallint;
  new_phase public.city_turn_phase;
  capped int;
  election_out jsonb;
  warnings text[] := '{}';
  turns_per_year constant smallint := 5;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;

  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week, turn_phase)
    values (p_city_code, 0, 1, 1, 'sign_ups_open')
    returning * into eng;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  capped := public._city_sim_cap_uncollected_salaries(p_city_code);

  new_week := eng.sim_week + 1;
  new_year := eng.sim_year;
  if new_week > turns_per_year then
    new_week := 1;
    new_year := new_year + 1;
  end if;
  new_phase := public._city_turn_phase_from_turn(new_week);

  update public.city_sim_engine_state
  set sim_year = new_year, sim_week = new_week, turn_phase = new_phase, updated_at = now()
  where city_code = p_city_code;

  perform public._city_sim_reset_salary_week(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  election_out := public._city_advance_election_track(p_city_code, new_week, new_year);

  if new_week = 1 then
    update public.city_fiscal_metrics
    set fiscal_year = new_year, updated_at = now()
    where city_code = p_city_code;
  end if;

  return jsonb_build_object(
    'ok', true,
    'sim_year', new_year,
    'sim_week', new_week,
    'sim_turn', new_week,
    'turn_phase', new_phase::text,
    'sim_tick', eng.sim_tick,
    'salaries_forfeited', capped,
    'election_track', election_out,
    'warnings', warnings,
    'forced', p_force
  );
end;
$$;

create or replace function public.admin_advance_city_sim_turn(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_advance_city_sim_week(p_city_code, p_force);
end;
$$;

-- Budget propose: turn 1 only (vote/sign logic unchanged).
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
  sim_turn smallint;
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

  select coalesce(sim_week, 1) into sim_turn
  from public.city_sim_engine_state where city_code = 'MB';
  if coalesce(sim_turn, 0) <> 1 then
    raise exception 'City budget may only be proposed on turn 1 of the fiscal year';
  end if;

  if exists (select 1 from public.city_budgets where status in ('proposed', 'council_vote', 'awaiting_mayor')) then
    raise exception 'A budget is already pending council action or mayor signature';
  end if;

  rev := public._city_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;

  select coalesce(max(fiscal_year), 0) + 1 into fy from public.city_budgets where status = 'enacted';
  if fy < 1 then fy := 1; end if;

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

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object(
    'ok', true, 'budget_id', budget_id, 'fiscal_year', fy, 'status', 'council_vote',
    'projected_revenue_millions', rev,
    'projected_expenditure_millions', exp,
    'projected_deficit_millions', def,
    'warning', case when def < 0 then format('Projected annual deficit: $%sM', round(def::numeric, 4)) else null end
  );
end;
$$;

grant execute on function public.admin_advance_city_sim_turn(char, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
