-- Staff: zero all income-tax balances as if fully paid, credit federal treasury by forgiven outstanding,
-- and rewrite fiscal_year_close_summaries so tax_collected matches appropriations (UI "cumulative shortage"
-- on the federal page uses those summaries + active FY cash collected).

create or replace function public.admin_tax_forgive_all_outstanding_reset_books()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bump numeric;
  v_rows int := 0;
begin
  if v_uid is not null and not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may run this reset.';
  end if;

  select coalesce(sum(outstanding_amount), 0) into v_bump from public.fiscal_tax_accounts;

  update public.federal_treasury
  set balance = balance + coalesce(v_bump, 0)
  where id = 1;

  update public.fiscal_tax_accounts
  set
    paid_amount = greatest(
      coalesce(paid_amount, 0),
      coalesce(assessed_tax, 0) + coalesce(total_penalties, 0)
    ),
    outstanding_amount = 0,
    total_penalties = 0,
    status = 'paid',
    last_warning_scope = null,
    last_warning_at = null,
    penalty_applied_through_date = null,
    updated_at = now();
  get diagnostics v_rows = row_count;

  update public.fiscal_year_close_summaries
  set
    tax_collected_total = appropriations_total,
    funding_ratio = 1,
    spend_minus_tax_collected = 0,
    treasury_net_delta = 0;

  return jsonb_build_object(
    'ok', true,
    'federal_treasury_credited', round(coalesce(v_bump, 0), 2),
    'tax_account_rows_updated', v_rows
  );
end;
$$;

comment on function public.admin_tax_forgive_all_outstanding_reset_books() is
  'Staff-only: mark all fiscal_tax_accounts fully paid without debiting wallets; credit federal treasury by prior outstanding; align close summaries as if tax funded appropriations.';

grant execute on function public.admin_tax_forgive_all_outstanding_reset_books() to authenticated;

notify pgrst, 'reload schema';
