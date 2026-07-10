-- Fix treasury $0: recovery must run when all budgets were superseded (not skip on abs(treasury) <= 100).

create or replace function public._city_restore_treasury_from_canonical_budget(p_city_code char(2) default 'MB')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  alloc_total numeric := 0;
  bid uuid;
  biennium smallint;
  epoch timestamptz;
  mayor_uid uuid;
  dept record;
begin
  select coalesce(sum(amount_millions), 0) into alloc_total
  from public.city_fiscal_department_allocations
  where city_code = p_city_code;

  if alloc_total <= 0 or alloc_total > 50 then
    return null;
  end if;

  select b.id into bid
  from public.city_budgets b
  where b.status in ('enacted', 'awaiting_mayor', 'council_vote', 'superseded')
  order by
    case b.status
      when 'enacted' then 0
      when 'awaiting_mayor' then 1
      when 'council_vote' then 2
      else 3
    end,
    b.enacted_at desc nulls last,
    b.created_at desc
  limit 1;

  if bid is null then
    select epoch_started_at into epoch
    from public.city_sim_engine_state
    where city_code = p_city_code;

    biennium := public._city_biennium_index_from_epoch(coalesce(epoch, now()));

    select g.user_id into mayor_uid
    from public.government_role_grants g
    where g.role_key = 'mayor'
    order by g.user_id
    limit 1;

    insert into public.city_budgets (
      fiscal_year, status, proposed_by, enacted_at
    ) values (
      biennium, 'enacted', mayor_uid, now()
    )
    returning id into bid;
  else
    update public.city_budgets
    set
      status = 'enacted',
      enacted_at = coalesce(enacted_at, now())
    where id = bid;
  end if;

  update public.city_budgets
  set status = 'superseded'
  where status = 'enacted'
    and id <> bid;

  delete from public.city_budget_lines where budget_id = bid;

  for dept in
    select department_key, amount_millions
    from public.city_fiscal_department_allocations
    where city_code = p_city_code
  loop
    insert into public.city_budget_lines (budget_id, department_key, amount_millions)
    values (bid, dept.department_key, dept.amount_millions);
  end loop;

  perform public._city_recalculate_budget_balance(bid);

  update public.city_fiscal_metrics
  set
    treasury_balance = (
      select projected_deficit_millions
      from public.city_budgets
      where id = bid
    ),
    updated_at = now()
  where city_code = p_city_code;

  return bid;
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
  enacted_count int := 0;
  alloc_total numeric := 0;
begin
  for b in
    select id
    from public.city_budgets
    where status = 'enacted'
    order by fiscal_year, enacted_at nulls last, created_at
  loop
    enacted_count := enacted_count + 1;
    total := total + public._city_recalculate_budget_balance(b.id);
  end loop;

  if enacted_count = 0 then
    select coalesce(sum(amount_millions), 0) into alloc_total
    from public.city_fiscal_department_allocations
    where city_code = 'MB';

    if alloc_total > 0 and alloc_total <= 50 and public._city_has_seated_player_officeholders('MB') then
      perform public._city_restore_treasury_from_canonical_budget('MB');
      select treasury_balance into total
      from public.city_fiscal_metrics
      where city_code = 'MB';
      return total;
    end if;
  end if;

  update public.city_fiscal_metrics
  set treasury_balance = total,
      updated_at = now()
  where city_code = 'MB';

  return total;
end;
$$;

create or replace function public.sync_city_treasury_balance(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  treasury numeric;
  enacted_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  perform public._city_rebuild_treasury_from_enacted();

  select treasury_balance into treasury
  from public.city_fiscal_metrics
  where city_code = p_city_code;

  select count(*)::int into enacted_count
  from public.city_budgets
  where status = 'enacted';

  return jsonb_build_object(
    'ok', true,
    'treasury_balance_millions', treasury,
    'enacted_budgets', enacted_count
  );
end;
$$;

-- Backfill now: player-scale allocations exist but no enacted budget survived supersede.
select public._city_rebuild_treasury_from_enacted();

grant execute on function public._city_restore_treasury_from_canonical_budget(char) to authenticated, service_role;
grant execute on function public.sync_city_treasury_balance(char) to authenticated, service_role;

notify pgrst, 'reload schema';
