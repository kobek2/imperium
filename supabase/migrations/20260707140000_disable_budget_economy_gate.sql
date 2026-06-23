-- Baseline mode: federal budget / appropriations enrollment no longer gates economy RPCs.

create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

comment on function public._economy_require_active_budget() is
  'No-op in baseline mode — economy is not frozen pending a presidential budget submission.';

-- Defense procurement: no longer requires a submitted federal budget workbook.
create or replace function public.rp_defense_obligate_procurement(
  p_fiscal_year_id uuid,
  p_category text,
  p_amount numeric,
  p_memo text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_budget record;
  v_allocated numeric := 1000000000::numeric;
  v_used numeric;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public._cabinet_portfolio_secretary(v_uid, 'secretary_of_defense') then
    raise exception 'Only the Secretary of Defense may obligate defense procurement funds.';
  end if;

  if p_fiscal_year_id is null then
    raise exception 'Fiscal year required.';
  end if;

  if p_category not in (
    'weapon_system_modernization',
    'heavy_armor',
    'cavalry_and_mobility',
    'aviation_rotary',
    'missiles_and_long_range_strike',
    'munitions_industrial_base'
  ) then
    raise exception 'Invalid procurement category.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive.';
  end if;

  if coalesce(trim(p_memo), '') = '' then
    p_memo := '';
  end if;
  if char_length(p_memo) > 2000 then
    raise exception 'Memo too long.';
  end if;

  select * into v_budget
  from public.federal_budgets b
  where b.fiscal_year_id = p_fiscal_year_id
  for update;

  if found then
    select coalesce(max((elem->>'allocated')::numeric), 0::numeric) into v_allocated
    from jsonb_array_elements(coalesce(v_budget.line_items, '[]'::jsonb)) elem
    where elem->>'key' = 'defense';

    if v_allocated <= 0 then
      v_allocated := 1000000000::numeric;
    end if;
  end if;

  select coalesce(sum(o.amount_obligated), 0::numeric) into v_used
  from public.rp_defense_procurement_obligations o
  where o.fiscal_year_id = p_fiscal_year_id;

  if v_used + p_amount > v_allocated then
    raise exception
      'INSUFFICIENT_DEFENSE_APPROPRIATION: total obligations would exceed the defense line allocation for this fiscal year.';
  end if;

  insert into public.rp_defense_procurement_obligations (
    fiscal_year_id,
    category,
    amount_obligated,
    memo,
    created_by
  ) values (
    p_fiscal_year_id,
    p_category,
    round(p_amount, 2),
    p_memo,
    v_uid
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_new_id,
    'allocated', v_allocated,
    'used', v_used + round(p_amount, 2),
    'remaining', v_allocated - (v_used + round(p_amount, 2))
  );
end;
$$;

notify pgrst, 'reload schema';
