-- NPC council members always vote yea on the city budget (debt-start / player-scale sim).

create or replace function public._npc_budget_vote(
  p_sim_politician_id uuid,
  p_deficit_millions numeric,
  p_spending_delta_pct numeric
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return 'yea';
end;
$$;

-- Always finalize council vote when no player-held seats are waiting to vote.
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

  -- No player council seats: NPC caucus votes immediately (all yea).
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

notify pgrst, 'reload schema';
