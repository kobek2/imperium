-- Align economy unlock with calendar: enrolled appropriations act OR submitted federal budget workbook.

create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active' and coalesce(y.economy_activity_frozen, false)
  ) then
    raise exception
      'ECONOMY_FROZEN: Government shutdown in effect. No economic activity permitted.';
  end if;

  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active'
      and y.appropriation_deadline_at is not null
      and y.appropriations_act_bill_id is null
      and now() > y.appropriation_deadline_at
  ) then
    raise exception
      'Federal government shutdown: the annual appropriations act was not enrolled before the statutory deadline. Economy payouts and purchases are suspended until Congress enrolls appropriations.';
  end if;

  if not exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active'
      and (
        y.appropriations_act_bill_id is not null
        or exists (
          select 1
          from public.federal_budgets b
          where b.fiscal_year_id = y.id
            and b.status = 'submitted'
        )
      )
  ) then
    raise exception
      'Economy is frozen until the annual appropriations act is enrolled into law or the President submits the federal budget workbook for the active fiscal year.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
