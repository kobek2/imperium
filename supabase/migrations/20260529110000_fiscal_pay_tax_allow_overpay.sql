-- Allow voluntary income tax payments above outstanding (and payments when already paid up).

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
  v_out_before numeric;
  v_surplus numeric;
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

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if coalesce(w.balance, 0) <= 0 then raise exception 'Insufficient wallet balance.'; end if;

  pay_amt := least(amt, w.balance);
  if pay_amt <= 0 then raise exception 'Insufficient wallet balance.'; end if;

  v_out_before := greatest(0::numeric, coalesce(tax_acct.outstanding_amount, 0));
  v_surplus := greatest(0::numeric, pay_amt - v_out_before);

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
    jsonb_build_object(
      'fiscal_year_id', y_ledger.id,
      'payment', pay_amt,
      'outstanding_before', v_out_before,
      'voluntary_surplus', v_surplus
    )
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
    jsonb_build_object('method', 'wallet', 'voluntary_surplus', v_surplus),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'paid', pay_amt,
    'remaining', greatest(0, tax_acct.outstanding_amount - pay_amt),
    'voluntary_surplus', v_surplus,
    'wallet_balance', new_bal
  );
end;
$$;

notify pgrst, 'reload schema';
