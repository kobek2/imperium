-- Tax ops fixes:
-- 1) last_warning_scope: "one warning per UTC day" no longer blocks a different scope the same day
--    (e.g. due_soon then delinquent).
-- 2) Warning lead + penalty rate read from the active FY row so staff/admin updates apply while the
--    open tax ledger still lives on the most recent closed FY.
-- 3) fiscal_pay_tax targets the same fiscal year as the treasury tax ledger (max year_index with accounts).
-- 4) Treasury bootstrap: drop the $25 synthetic floor; skip players with zero assessable tax.

alter table public.fiscal_tax_accounts
  add column if not exists last_warning_scope text;

create or replace function public._fiscal_treasury_bootstrap_tax_accounts_if_needed()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y record;
  bud record;
  u record;
  v_started timestamptz;
  v_inflow numeric;
  v_tax numeric;
begin
  select fy.* into y
  from public.rp_fiscal_years fy
  join public.federal_budgets fb on fb.fiscal_year_id = fy.id and fb.status = 'submitted'
  where fy.status = 'active'
  limit 1;
  if not found then
    select fy.* into y
    from public.rp_fiscal_years fy
    join public.federal_budgets fb on fb.fiscal_year_id = fy.id and fb.status = 'submitted'
    order by fy.year_index desc
    limit 1;
  end if;
  if not found then
    return;
  end if;

  if exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = y.id) then
    return;
  end if;

  select * into bud from public.federal_budgets where fiscal_year_id = y.id limit 1;
  if not found then
    return;
  end if;

  v_started := y.started_at;

  for u in select id from public.profiles
  loop
    select coalesce(sum(delta), 0) into v_inflow
    from public.economy_ledger
    where wallet_user_id = u.id
      and kind = 'hourly_income'
      and delta > 0
      and created_at >= v_started;

    v_tax := public.fiscal_marginal_tax(v_inflow, bud.tax_brackets);
    if v_tax <= 0 then
      continue;
    end if;

    insert into public.fiscal_tax_accounts (
      fiscal_year_id,
      user_id,
      assessed_tax,
      paid_amount,
      outstanding_amount,
      due_at,
      status
    ) values (
      y.id,
      u.id,
      v_tax,
      0,
      v_tax,
      now() - interval '1 day',
      'pending'
    )
    on conflict (fiscal_year_id, user_id) do nothing;
  end loop;
end;
$$;

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
  a record;
  w record;
  amt numeric := round(coalesce(p_amount, 0), 2);
  pay_amt numeric;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt <= 0 then raise exception 'Payment amount must be positive.'; end if;

  select fy.* into y_ledger
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then raise exception 'No tax ledger fiscal year.'; end if;

  select * into a
  from public.fiscal_tax_accounts
  where fiscal_year_id = y_ledger.id and user_id = v_uid
  for update;
  if not found then raise exception 'No tax account for this fiscal year.'; end if;
  if a.outstanding_amount <= 0 then
    return jsonb_build_object('ok', true, 'paid', 0, 'remaining', 0);
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if coalesce(w.balance, 0) <= 0 then raise exception 'Insufficient wallet balance.'; end if;

  pay_amt := least(a.outstanding_amount, amt, w.balance);
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
  where id = a.id;

  insert into public.fiscal_tax_events (
    account_id, fiscal_year_id, user_id, event_type, amount, detail, created_by
  ) values (
    a.id, y_ledger.id, v_uid, 'payment', pay_amt,
    jsonb_build_object('method', 'wallet'),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'paid', pay_amt,
    'remaining', greatest(0, a.outstanding_amount - pay_amt),
    'wallet_balance', new_bal
  );
end;
$$;

create or replace function public.fiscal_issue_tax_warning(p_scope text default 'due_soon')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  y_active record;
  warned int := 0;
  row_rec record;
  v_lead int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  perform public._economy_require_active_budget();

  perform public._fiscal_treasury_bootstrap_tax_accounts_if_needed();

  select fy.* into y
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'warned', 0);
  end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;

  v_lead := greatest(
    1,
    coalesce(y_active.tax_warning_lead_days, y.tax_warning_lead_days, 2)
  );

  for row_rec in
    select a.*
    from public.fiscal_tax_accounts a
    where a.fiscal_year_id = y.id
      and a.outstanding_amount > 0
      and (
        (p_scope = 'all')
        or (
          p_scope = 'due_soon'
          and a.due_at <= now() + make_interval(days => v_lead)
        )
        or (
          p_scope = 'delinquent'
          and (
            a.status = 'delinquent'
            or now()::date > a.due_at::date
          )
        )
      )
      and (
        a.last_warning_at is null
        or a.last_warning_at::date < now()::date
        or coalesce(a.last_warning_scope, '') is distinct from p_scope
      )
  loop
    update public.fiscal_tax_accounts
    set last_warning_at = now(),
        last_warning_scope = p_scope,
        updated_at = now()
    where id = row_rec.id;

    insert into public.fiscal_tax_events (
      account_id, fiscal_year_id, user_id, event_type, detail, created_by
    ) values (
      row_rec.id, row_rec.fiscal_year_id, row_rec.user_id, 'warning',
      jsonb_build_object('scope', p_scope, 'outstanding', row_rec.outstanding_amount),
      v_uid
    );
    warned := warned + 1;
  end loop;

  return jsonb_build_object('ok', true, 'warned', warned);
end;
$$;

create or replace function public.fiscal_apply_tax_penalties()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  y_active record;
  row_rec record;
  v_today date := now()::date;
  from_day date;
  days_over int;
  penalty numeric;
  touched int := 0;
  v_rate numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  perform public._economy_require_active_budget();

  perform public._fiscal_treasury_bootstrap_tax_accounts_if_needed();

  select fy.* into y
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then return jsonb_build_object('ok', true, 'updated', 0); end if;

  select * into y_active from public.rp_fiscal_years where status = 'active' limit 1;

  v_rate := greatest(
    0.000001::numeric,
    coalesce(y_active.tax_penalty_daily_rate, y.tax_penalty_daily_rate, 0.05::numeric)
  );

  for row_rec in
    select *
    from public.fiscal_tax_accounts a
    where a.fiscal_year_id = y.id
      and a.outstanding_amount > 0
      and v_today > a.due_at::date
  loop
    from_day := coalesce(row_rec.penalty_applied_through_date + 1, row_rec.due_at::date + 1);
    days_over := greatest(0, (v_today - from_day + 1));
    if days_over <= 0 then
      continue;
    end if;

    penalty := round(row_rec.outstanding_amount * v_rate * days_over, 2);
    if penalty <= 0 then
      continue;
    end if;

    update public.fiscal_tax_accounts
    set total_penalties = total_penalties + penalty,
        outstanding_amount = outstanding_amount + penalty,
        status = 'delinquent',
        penalty_applied_through_date = v_today,
        updated_at = now()
    where id = row_rec.id;

    insert into public.fiscal_tax_events (
      account_id, fiscal_year_id, user_id, event_type, amount, detail, created_by
    ) values (
      row_rec.id, row_rec.fiscal_year_id, row_rec.user_id, 'penalty', penalty,
      jsonb_build_object('days', days_over, 'daily_rate', v_rate),
      v_uid
    );
    touched := touched + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', touched);
end;
$$;

notify pgrst, 'reload schema';
