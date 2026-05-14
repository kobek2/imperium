-- 1) fiscal_pay_tax: rename record variable `tax_acct` and avoid table alias `a` in EXISTS (PL/pgSQL
--    name collision caused "record \"a\" is not assigned yet" when paying tax in some builds).
-- 2) fiscal_my_tax_ledger_account: signed-in user's tax row for the same FY fiscal_pay_tax uses.
-- 3) federal_treasury_outlays + fiscal_treasury_deploy_cash: Treasury deploys cash to U.S. debt or a budget line.

create or replace function public.fiscal_pay_tax(p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_ledger record;
  tax_acct record;
  w record;
  amt numeric := round(coalesce(p_amount, 0), 2);
  pay_amt numeric;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt <= 0 then raise exception 'Payment amount must be positive.'; end if;

  select fy.* into y_ledger
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts ftx where ftx.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then raise exception 'No tax ledger fiscal year.'; end if;

  select * into tax_acct
  from public.fiscal_tax_accounts
  where fiscal_year_id = y_ledger.id and user_id = v_uid
  for update;
  if not found then raise exception 'No tax account for this fiscal year.'; end if;
  if coalesce(tax_acct.outstanding_amount, 0) <= 0 then
    return jsonb_build_object('ok', true, 'paid', 0, 'remaining', 0);
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if coalesce(w.balance, 0) <= 0 then raise exception 'Insufficient wallet balance.'; end if;

  pay_amt := least(tax_acct.outstanding_amount, amt, w.balance);
  if pay_amt <= 0 then raise exception 'Insufficient wallet balance.'; end if;
  new_bal := w.balance - pay_amt;

  update public.economy_wallets
  set balance = new_bal, updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    -pay_amt,
    new_bal,
    'fiscal_income_tax',
    jsonb_build_object('fiscal_year_id', y_ledger.id, 'payment', pay_amt)
  );

  update public.federal_treasury
  set balance = balance + pay_amt
  where id = 1;

  update public.fiscal_tax_accounts
  set
    paid_amount = paid_amount + pay_amt,
    outstanding_amount = greatest(0, outstanding_amount - pay_amt),
    status = case
      when greatest(0, outstanding_amount - pay_amt) = 0 then 'paid'
      when now()::date > due_at::date then 'delinquent'
      else 'pending'
    end,
    updated_at = now()
  where id = tax_acct.id;

  insert into public.fiscal_tax_events (
    account_id, fiscal_year_id, user_id, event_type, amount, detail, created_by
  ) values (
    tax_acct.id, y_ledger.id, v_uid, 'payment', pay_amt,
    jsonb_build_object('method', 'wallet'),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'paid', pay_amt,
    'remaining', greatest(0, tax_acct.outstanding_amount - pay_amt),
    'wallet_balance', new_bal
  );
end;
$$;

create or replace function public.fiscal_my_tax_ledger_account()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_ledger record;
  tax_acct record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not authenticated');
  end if;

  select fy.* into y_ledger
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts ftx where ftx.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'fiscal_year_id', null, 'account', null);
  end if;

  select * into tax_acct
  from public.fiscal_tax_accounts
  where fiscal_year_id = y_ledger.id and user_id = v_uid;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'fiscal_year_id', y_ledger.id,
      'account', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y_ledger.id,
    'account', jsonb_build_object(
      'assessed_tax', tax_acct.assessed_tax,
      'paid_amount', tax_acct.paid_amount,
      'outstanding_amount', tax_acct.outstanding_amount,
      'total_penalties', tax_acct.total_penalties,
      'due_at', tax_acct.due_at,
      'status', tax_acct.status
    )
  );
end;
$$;

grant execute on function public.fiscal_my_tax_ledger_account() to authenticated;

create table if not exists public.federal_treasury_outlays (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years (id) on delete cascade,
  category text not null check (category in ('us_debt', 'budget_line')),
  line_item_key text,
  amount numeric(20, 2) not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists federal_treasury_outlays_fy_idx
  on public.federal_treasury_outlays (fiscal_year_id, created_at desc);

create index if not exists federal_treasury_outlays_fy_line_idx
  on public.federal_treasury_outlays (fiscal_year_id, line_item_key);

comment on table public.federal_treasury_outlays is
  'Discretionary federal cash deployments from federal_treasury (debt paydown or line-item buckets); audit trail for Treasury.';

alter table public.federal_treasury_outlays enable row level security;

drop policy if exists "federal_treasury_outlays read authed" on public.federal_treasury_outlays;
create policy "federal_treasury_outlays read authed"
  on public.federal_treasury_outlays
  for select
  using (auth.role() = 'authenticated');

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

    v_pay := least(v_pay, greatest(0::numeric, coalesce(v_debt, 0)));
    if v_pay <= 0 then
      raise exception 'No U.S. debt on file to pay down (us_debt is zero).';
    end if;

    update public.national_metrics
    set
      us_debt = greatest(0::numeric, coalesce(us_debt, 0) - v_pay),
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
    'treasury_balance_after', (select balance from public.federal_treasury where id = 1)
  );
end;
$$;

grant execute on function public.fiscal_treasury_deploy_cash(text, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
