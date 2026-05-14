-- Deploy to U.S. debt: support signed us_debt (positive = owed, negative = surplus toward zero).

create or replace function public.fiscal_treasury_deploy_cash(
  p_category text,
  p_line_item_key text,
  p_amount numeric,
  p_note text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_active record;
  t record;
  v_amt numeric := round(greatest(0, coalesce(p_amount, 0)), 2);
  v_pay numeric;
  v_bal numeric;
  v_debt numeric;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_key text := nullif(trim(coalesce(p_line_item_key, '')), '');
  v_has_line boolean;
  v_new_debt numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  if p_category is null or p_category not in ('us_debt', 'budget_line') then
    raise exception 'category must be us_debt or budget_line.';
  end if;

  if p_category = 'budget_line' and v_key is null then
    raise exception 'line_item_key is required for budget_line deployments.';
  end if;

  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  if p_category = 'budget_line' then
    select exists (
      select 1
      from public.federal_budgets b,
        lateral jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) elem
      where b.fiscal_year_id = y_active.id
        and (elem->>'key') = v_key
    )
    into v_has_line;
    if not coalesce(v_has_line, false) then
      raise exception 'Unknown line_item_key for the active federal budget.';
    end if;
  end if;

  select * into t from public.federal_treasury where id = 1 for update;
  if not found then raise exception 'Federal treasury row missing.'; end if;

  v_bal := round(coalesce(t.balance, 0), 2);
  if v_bal <= 0 then raise exception 'Federal treasury has no cash on hand.'; end if;

  v_pay := least(v_amt, v_bal);

  if p_category = 'us_debt' then
    insert into public.national_metrics (fiscal_year_id, us_debt, updated_by)
    values (y_active.id, 0, v_uid)
    on conflict (fiscal_year_id) do nothing;

    select coalesce(us_debt, 0) into v_debt
    from public.national_metrics
    where fiscal_year_id = y_active.id
    for update;

    if v_debt > 0 then
      v_pay := least(v_pay, v_debt);
      if v_pay <= 0 then
        raise exception 'No positive U.S. debt on file to pay down (already at or below zero).';
      end if;
      v_new_debt := greatest(0::numeric, v_debt - v_pay);
    elsif v_debt < 0 then
      v_pay := least(v_pay, abs(v_debt));
      if v_pay <= 0 then
        raise exception 'No surplus position on file to deploy against (us_debt is not negative).';
      end if;
      v_new_debt := least(0::numeric, v_debt + v_pay);
    else
      raise exception
        'U.S. debt (sim) is exactly zero on file — use budget line buckets or set a baseline in national metrics first.';
    end if;

    update public.national_metrics
    set
      us_debt = v_new_debt,
      updated_at = now(),
      updated_by = v_uid
    where fiscal_year_id = y_active.id;
  end if;

  update public.federal_treasury
  set balance = balance - v_pay
  where id = 1;

  insert into public.federal_treasury_outlays (
    fiscal_year_id, category, line_item_key, amount, note, created_by
  ) values (
    y_active.id,
    p_category,
    case when p_category = 'budget_line' then v_key else null end,
    v_pay,
    v_note,
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'deployed', v_pay,
    'fiscal_year_id', y_active.id,
    'category', p_category,
    'line_item_key', case when p_category = 'budget_line' then v_key else null end,
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1),
    'us_debt_after', case
      when p_category = 'us_debt' then (select us_debt from public.national_metrics where fiscal_year_id = y_active.id)
      else null
    end
  );
end;
$$;

notify pgrst, 'reload schema';
