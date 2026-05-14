-- FY rollover when the President signs the enrolled federal appropriations act (bill -> law):
-- `fiscal_on_appropriations_enrolled` runs from trigger `trg_fiscal_sync_enacted_appropriations_floor` on bills.
-- If the linked active FY has a `pending_activation` child (budget transition), enroll the bill then call
-- `_fiscal_activate_pending_fiscal_year`. Otherwise keep prior behavior: mark the active FY federal budget submitted.
--
-- `fiscal_submit_budget` on a pending row: only full staff may force-activate; Presidents use the signing path.

create or replace function public.fiscal_on_appropriations_enrolled(p_bill_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b record;
  y record;
  v_pending uuid;
  v_actor uuid;
  v_budget_fy uuid;
  v_rolled boolean := false;
  new_line_items jsonb;
begin
  if p_bill_id is null then
    raise exception 'Bill id required.';
  end if;

  select * into b from public.bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found.';
  end if;
  if b.status is distinct from 'law' then
    raise exception 'Bill is not enrolled as law.';
  end if;
  if not coalesce(b.is_federal_appropriations, false) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if b.linked_fiscal_year_id is null then
    raise exception 'Appropriations bill is not linked to a fiscal year.';
  end if;

  select * into y from public.rp_fiscal_years where id = b.linked_fiscal_year_id for update;
  if not found then
    raise exception 'Fiscal year not found.';
  end if;

  -- Second call (e.g. client RPC after trigger): FY already closed with this bill enrolled.
  if y.appropriations_act_bill_id is not distinct from p_bill_id and y.status is distinct from 'active' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_enrolled_fy_not_active');
  end if;

  if y.status is distinct from 'active' then
    raise exception 'Appropriations bills must be linked to the active fiscal year at signing.';
  end if;

  if y.appropriations_act_bill_id is not null and y.appropriations_act_bill_id is distinct from p_bill_id then
    raise exception 'This fiscal year already has an enrolled appropriations act.';
  end if;

  update public.rp_fiscal_years
  set
    appropriations_act_bill_id = p_bill_id,
    economy_activity_frozen = false
  where id = y.id;

  select id into v_pending
  from public.rp_fiscal_years
  where pending_parent_fiscal_year_id = y.id
    and status = 'pending_activation'
  limit 1;

  v_budget_fy := coalesce(v_pending, y.id);

  v_actor := coalesce(
    auth.uid(),
    (select id from public.profiles where office_role = 'president' limit 1)
  );

  if exists (
    select 1
    from public.federal_budgets fb
    where fb.fiscal_year_id = v_budget_fy
      and coalesce(jsonb_array_length(fb.line_items), 0) > 0
  ) then
    select coalesce(
      (
        select jsonb_agg(
          coalesce(elem, '{}'::jsonb) || jsonb_build_object(
            'minimum',
            greatest(
              round(coalesce((elem->>'minimum')::numeric, 0), 2),
              round(coalesce((elem->>'allocated')::numeric, 0), 2)
            ),
            'base_minimum',
            greatest(
              round(
                coalesce(
                  case
                    when elem ? 'base_minimum' and elem->>'base_minimum' is not null and elem->>'base_minimum' <> ''
                    then (elem->>'base_minimum')::numeric
                    else null
                  end,
                  coalesce((elem->>'minimum')::numeric, 0)
                ),
                2
              ),
              round(coalesce((elem->>'allocated')::numeric, 0), 2)
            )
          )
          order by t.ord
        )
        from jsonb_array_elements(
          (select fb.line_items from public.federal_budgets fb where fb.fiscal_year_id = v_budget_fy limit 1)
        ) with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    )
    into new_line_items;

    update public.federal_budgets
    set
      line_items = new_line_items,
      updated_at = now()
    where fiscal_year_id = v_budget_fy;
  end if;

  if v_pending is not null then
    perform public._fiscal_activate_pending_fiscal_year(v_pending, v_actor);
    v_rolled := true;
  else
    update public.federal_budgets
    set
      status = 'submitted',
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where fiscal_year_id = y.id
      and status = 'draft';
  end if;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y.id,
    'bill_id', p_bill_id,
    'fiscal_year_rolled', v_rolled
  );
end;
$$;

create or replace function public.fiscal_submit_budget(p_fiscal_year_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  b record;
  el jsonb;
  min_amt numeric;
  alloc numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (
    public._fiscal_is_president(v_uid)
    or public.is_staff_admin(v_uid)
  ) then
    raise exception 'Only the President or a full staff operator may submit the federal budget.';
  end if;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;

  if y.status = 'pending_activation' then
    if public.is_staff_admin(v_uid) then
      return public._fiscal_activate_pending_fiscal_year(p_fiscal_year_id, v_uid);
    end if;
    raise exception
      'The next fiscal year rolls forward when the President signs the enrolled federal appropriations act into law. Full staff may force rollover in an emergency.';
  end if;

  if y.status is distinct from 'active' then
    raise exception 'Only the active fiscal year or an open transition draft may be submitted.';
  end if;

  select * into b from public.federal_budgets where fiscal_year_id = p_fiscal_year_id for update;
  if not found then raise exception 'No budget draft exists. Save a draft first.'; end if;
  if b.status = 'submitted' then raise exception 'Budget already submitted.'; end if;

  for el in select * from jsonb_array_elements(b.line_items)
  loop
    min_amt := coalesce((el->>'minimum')::numeric, 0);
    alloc := coalesce((el->>'allocated')::numeric, 0);
    if alloc < min_amt then
      raise exception 'Line item % requires at least $% allocated (got $%).', el->>'key', min_amt, alloc;
    end if;
  end loop;

  update public.federal_budgets
  set status = 'submitted', submitted_at = now(), president_user_id = coalesce(b.president_user_id, v_uid), updated_at = now()
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
