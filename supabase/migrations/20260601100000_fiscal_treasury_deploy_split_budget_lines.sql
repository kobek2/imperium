-- Split federal treasury cash across all active-budget line buckets in one transaction (equal or proportional).

create or replace function public.fiscal_treasury_deploy_cash_split_budget_lines(
  p_mode text,
  p_cap_amount numeric default null,
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
  v_bal numeric;
  v_pool numeric;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_mode text := lower(trim(coalesce(p_mode, 'equal')));
  elem record;
  keys text[] := '{}';
  allocs numeric[] := '{}';
  pays numeric[] := '{}';
  v_n int;
  i int;
  v_sum_alloc numeric := 0;
  v_total_out numeric := 0;
  v_each numeric;
  v_acc numeric;
  v_pay_i numeric;
  v_json_lines jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  if v_mode not in ('equal', 'proportional') then
    raise exception 'mode must be equal or proportional.';
  end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  for elem in
    select
      nullif(trim(coalesce(e->>'key', '')), '') as k2,
      greatest(0::numeric, round(coalesce((e->>'allocated')::numeric, 0), 2)) as a2
    from public.federal_budgets b,
      lateral jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) e
    where b.fiscal_year_id = y_active.id
      and nullif(trim(coalesce(e->>'key', '')), '') is not null
    order by 1
  loop
    keys := array_append(keys, elem.k2);
    allocs := array_append(allocs, elem.a2);
    pays := array_append(pays, 0::numeric);
  end loop;

  v_n := coalesce(array_length(keys, 1), 0);
  if v_n <= 0 then raise exception 'No budget line items to deploy against.'; end if;

  select * into t from public.federal_treasury where id = 1 for update;
  if not found then raise exception 'Federal treasury row missing.'; end if;

  v_bal := round(coalesce(t.balance, 0), 2);
  if v_bal <= 0 then raise exception 'Federal treasury has no cash on hand.'; end if;

  if p_cap_amount is not null and p_cap_amount > 0 then
    v_pool := least(v_bal, round(p_cap_amount, 2));
  else
    v_pool := v_bal;
  end if;

  if v_pool <= 0 then raise exception 'Nothing to deploy after applying cap.'; end if;

  if v_mode = 'equal' then
    v_each := trunc((v_pool / v_n::numeric) * 100) / 100;
    v_acc := 0;
    for i in 1..(v_n - 1) loop
      pays[i] := v_each;
      v_acc := v_acc + v_each;
    end loop;
    pays[v_n] := round(v_pool - v_acc, 2);
  else
    for i in 1..v_n loop
      v_sum_alloc := v_sum_alloc + allocs[i];
    end loop;
    if coalesce(v_sum_alloc, 0) <= 0 then
      v_each := trunc((v_pool / v_n::numeric) * 100) / 100;
      v_acc := 0;
      for i in 1..(v_n - 1) loop
        pays[i] := v_each;
        v_acc := v_acc + v_each;
      end loop;
      pays[v_n] := round(v_pool - v_acc, 2);
    else
      v_acc := 0;
      for i in 1..(v_n - 1) loop
        v_pay_i := round(v_pool * allocs[i] / v_sum_alloc, 2);
        pays[i] := v_pay_i;
        v_acc := v_acc + v_pay_i;
      end loop;
      pays[v_n] := round(v_pool - v_acc, 2);
    end if;
  end if;

  for i in 1..v_n loop
    v_total_out := v_total_out + pays[i];
  end loop;

  v_total_out := round(v_total_out, 2);
  if v_total_out <= 0 then raise exception 'Computed deployment total is zero.'; end if;
  if v_total_out > v_bal then raise exception 'Internal split exceeds treasury balance.'; end if;

  update public.federal_treasury
  set balance = balance - v_total_out
  where id = 1;

  for i in 1..v_n loop
    if pays[i] > 0 then
      insert into public.federal_treasury_outlays (
        fiscal_year_id, category, line_item_key, amount, note, created_by
      ) values (
        y_active.id,
        'budget_line',
        keys[i],
        pays[i],
        case
          when v_note = '' then format('split:%s', v_mode)
          else format('split:%s — %s', v_mode, v_note)
        end,
        v_uid
      );
      v_json_lines := v_json_lines || jsonb_build_array(
        jsonb_build_object('key', keys[i], 'deployed', pays[i])
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'deployed_total', v_total_out,
    'fiscal_year_id', y_active.id,
    'lines', v_json_lines,
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1)
  );
end;
$$;

grant execute on function public.fiscal_treasury_deploy_cash_split_budget_lines(text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
