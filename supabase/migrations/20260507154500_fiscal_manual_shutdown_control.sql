-- Manual shutdown control:
-- remove automatic deadline-based shutdown gating from economy RPC checks.
-- Economy freeze is now driven only by rp_fiscal_years.economy_activity_frozen
-- plus the standard "submitted budget or enrolled appropriations" requirement.

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
      'ECONOMY_FROZEN: Economy activity is manually frozen by administration.';
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
      'Economy is frozen until the annual appropriations act is enrolled into law or staff marks the federal budget workbook submitted for the active fiscal year.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
