-- Budget propose gate: biennium-scoped pipeline, empty-caucus pass-through, ordinance unlock alignment.

create or replace function public._city_biennium_budget_in_flight(p_biennium smallint)
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
      and b.status in ('proposed', 'council_vote', 'awaiting_mayor')
  );
$$;

create or replace function public._city_budget_propose_allowed(p_epoch timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._city_biennium_budget_in_flight(public._city_biennium_index_from_epoch(p_epoch)) then false
    when public._city_biennium_budget_enacted(public._city_biennium_index_from_epoch(p_epoch)) then false
    when public._city_cycle_phase_from_epoch(p_epoch) = 'sign_ups_open' then true
    when public._city_cycle_phase_from_epoch(p_epoch) = 'legislative' then true
    else false
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
  cm record;
  vote text;
  yeas smallint := 0;
  nays smallint := 0;
  player_voted boolean;
  rev numeric;
  exp numeric;
  def numeric;
  baseline numeric;
  delta_pct numeric;
  need_yeas smallint := 4;
  v_label text;
  v_user_id uuid;
  seat_count int := 0;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  rev := coalesce(b.projected_revenue_millions, public._city_biennial_fiscal_revenue_millions('MB'));
  select coalesce(sum(amount_millions), 0) into exp from public.city_budget_lines where budget_id = p_budget_id;
  def := rev - exp;

  select coalesce(sum(amount_millions), 0) into baseline
  from public.city_fiscal_department_allocations where city_code = 'MB';

  delta_pct := case when baseline > 0 then ((exp - baseline) / baseline) * 100 else 0 end;

  if def < -800 then need_yeas := 5; end if;

  select count(*)::int into seat_count
  from public.campaign_caucus_members
  where chamber = 'council';

  delete from public.city_budget_roll_calls where budget_id = p_budget_id;

  if seat_count = 0 then
    update public.city_budgets set
      council_yeas = 0,
      council_nays = 0,
      projected_revenue_millions = rev,
      projected_expenditure_millions = exp,
      projected_deficit_millions = def,
      status = 'awaiting_mayor'
    where id = p_budget_id;
    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', 0, 'nays', 0,
      'status', 'awaiting_mayor', 'deficit_millions', def,
      'supermajority_required', false, 'empty_council', true
    );
  end if;

  for cm in
    select c.party, c.holder_user_id, c.seat_label, c.sim_politician_id, sp.character_name
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    v_user_id := cm.holder_user_id;
    v_label := cm.character_name;

    if cm.holder_user_id is not null then
      select v.vote, coalesce(pr.character_name, pr.discord_username, cm.character_name)
      into vote, v_label
      from public.city_budget_member_votes v
      left join public.profiles pr on pr.id = v.user_id
      where v.budget_id = p_budget_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_budget_vote(cm.sim_politician_id, def, delta_pct);
      v_user_id := null;
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;

    insert into public.city_budget_roll_calls (
      budget_id, ward_code, voter_label, sim_politician_id, user_id, vote
    ) values (
      p_budget_id,
      cm.seat_label,
      coalesce(v_label, cm.character_name),
      cm.sim_politician_id,
      v_user_id,
      vote
    );
  end loop;

  update public.city_budgets set
    council_yeas = yeas,
    council_nays = nays,
    projected_revenue_millions = rev,
    projected_expenditure_millions = exp,
    projected_deficit_millions = def
  where id = p_budget_id;

  if yeas >= need_yeas then
    update public.city_budgets set status = 'awaiting_mayor' where id = p_budget_id;
    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', yeas, 'nays', nays,
      'status', 'awaiting_mayor', 'deficit_millions', def,
      'supermajority_required', need_yeas > 4
    );
  end if;

  update public.city_budgets set status = 'rejected' where id = p_budget_id;
  return jsonb_build_object(
    'ok', true, 'passed', false, 'yeas', yeas, 'nays', nays,
    'status', 'rejected', 'deficit_millions', def
  );
end;
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

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object('ok', true, 'budget_id', budget_id, 'fiscal_year', fy, 'biennium', true);
end;
$$;

grant execute on function public._city_biennium_budget_in_flight(smallint) to authenticated, service_role;

notify pgrst, 'reload schema';
