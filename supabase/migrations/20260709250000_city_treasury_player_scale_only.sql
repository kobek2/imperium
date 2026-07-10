-- Treasury = sum of enacted player-scale biennium balances only.
-- Supersede macro/NPC ghost budgets; rebuild from budget lines + office-salary revenue.

create or replace function public._city_budget_is_player_scale(p_budget_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select sum(l.amount_millions)
    from public.city_budget_lines l
    where l.budget_id = p_budget_id
  ), 0) <= 50;
$$;

create or replace function public._city_recalculate_budget_balance(p_budget_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  rev numeric;
  exp numeric;
  def numeric;
begin
  rev := public._city_biennial_fiscal_revenue_millions('MB');
  select coalesce(sum(amount_millions), 0) into exp
  from public.city_budget_lines
  where budget_id = p_budget_id;

  def := rev - exp;

  update public.city_budgets
  set
    projected_revenue_millions = rev,
    projected_expenditure_millions = exp,
    projected_deficit_millions = def
  where id = p_budget_id;

  return def;
end;
$$;

create or replace function public._city_rebuild_treasury_from_enacted()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  total numeric := 0;
  b record;
begin
  for b in
    select id
    from public.city_budgets
    where status = 'enacted'
    order by fiscal_year, enacted_at nulls last, created_at
  loop
    total := total + public._city_recalculate_budget_balance(b.id);
  end loop;

  update public.city_fiscal_metrics
  set treasury_balance = total,
      updated_at = now()
  where city_code = 'MB';

  return total;
end;
$$;

create or replace function public._apply_enacted_city_budget(p_budget_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  line record;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;

  perform public._city_recalculate_budget_balance(p_budget_id);

  for line in
    select department_key, amount_millions
    from public.city_budget_lines
    where budget_id = p_budget_id
  loop
    update public.city_fiscal_department_allocations
    set amount_millions = line.amount_millions,
        minimum_required_millions = public._city_dept_minimum_millions(line.department_key)
    where city_code = 'MB' and department_key = line.department_key;
  end loop;

  update public.city_fiscal_metrics
  set fiscal_year = fiscal_year + 1,
      updated_at = now()
  where city_code = 'MB';

  perform public._city_rebuild_treasury_from_enacted();
  perform public.recompute_mayor_electoral_approval('MB');
  perform public._apply_budget_sim_effects(
    p_budget_id,
    (select projected_deficit_millions from public.city_budgets where id = p_budget_id)
  );
end;
$$;

-- Drop macro-scale NPC auto-budgets (>$50M total spending is never player-scale).
update public.city_budgets b
set status = 'superseded'
where b.status = 'enacted'
  and not public._city_budget_is_player_scale(b.id);

-- When players hold office, NPC-only enacted budgets from before they joined should not count.
update public.city_budgets b
set status = 'superseded'
where b.status = 'enacted'
  and public._city_has_seated_player_officeholders('MB')
  and not public._city_budget_had_player_council_input(b.id);

select public._city_rebuild_treasury_from_enacted();

-- If treasury is still macro-corrupt, rebuild from the latest budget + current player-scale allocations.
do $$
declare
  alloc_total numeric := 0;
  treasury numeric := 0;
  bid uuid;
  dept record;
begin
  select coalesce(sum(amount_millions), 0) into alloc_total
  from public.city_fiscal_department_allocations
  where city_code = 'MB';

  select treasury_balance into treasury
  from public.city_fiscal_metrics
  where city_code = 'MB';

  if alloc_total > 50 or abs(treasury) <= 100 then
    return;
  end if;

  select b.id into bid
  from public.city_budgets b
  order by b.enacted_at desc nulls last, b.created_at desc
  limit 1;

  if bid is null then
    return;
  end if;

  update public.city_budgets
  set status = 'superseded'
  where status = 'enacted'
    and id <> bid;

  update public.city_budgets
  set status = 'enacted'
  where id = bid;

  delete from public.city_budget_lines where budget_id = bid;

  for dept in
    select department_key, amount_millions
    from public.city_fiscal_department_allocations
    where city_code = 'MB'
  loop
    insert into public.city_budget_lines (budget_id, department_key, amount_millions)
    values (bid, dept.department_key, dept.amount_millions);
  end loop;

  perform public._city_rebuild_treasury_from_enacted();
end;
$$;

grant execute on function public._city_budget_is_player_scale(uuid) to authenticated, service_role;
grant execute on function public._city_recalculate_budget_balance(uuid) to authenticated, service_role;
grant execute on function public._city_rebuild_treasury_from_enacted() to authenticated, service_role;

notify pgrst, 'reload schema';
