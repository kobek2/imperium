-- Fix: join alias `b` shadowed PL/pgSQL variable `b`, so SELECT INTO never assigned the budget row
-- and fiscal_marginal_tax(..., b.tax_brackets) raised "record b is not assigned yet".

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
    if v_tax < 1 then
      v_tax := 25;
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

notify pgrst, 'reload schema';
