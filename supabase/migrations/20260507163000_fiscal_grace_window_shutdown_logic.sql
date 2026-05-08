-- Restore 24h post-rollover grace model:
-- - New active fiscal years get an appropriation deadline window immediately.
-- - Economy remains active during that window even if budget is still draft.
-- - Economy shuts down after deadline miss until appropriations are enrolled
--   or staff manually submits the budget.

create or replace function public._fiscal_seed_active_year_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours int := greatest(1, coalesce(new.appropriation_window_hours, 24));
  v_now timestamptz := now();
  v_deadline timestamptz;
begin
  if new.status = 'active'
     and new.appropriations_act_bill_id is null
  then
    v_deadline := coalesce(new.appropriation_deadline_at, v_now + make_interval(hours => v_hours));
    new.appropriation_deadline_at := v_deadline;
    new.appropriation_clock_started_at := coalesce(new.appropriation_clock_started_at, v_now);
    new.budget_initial_window_ends_at := coalesce(
      new.budget_initial_window_ends_at,
      least(v_deadline, v_now + interval '24 hours')
    );
    new.budget_treasury_override_until := coalesce(new.budget_treasury_override_until, v_deadline);
    new.budget_cycle_rp_key := coalesce(new.budget_cycle_rp_key, to_char(timezone('UTC', v_now), 'YYYY-MM'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiscal_seed_active_year_window on public.rp_fiscal_years;
create trigger trg_fiscal_seed_active_year_window
before insert or update of status, appropriations_act_bill_id, appropriation_deadline_at
on public.rp_fiscal_years
for each row
execute function public._fiscal_seed_active_year_window();

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
      'Federal government shutdown: the annual appropriations act was not enrolled before the statutory deadline. Economy payouts and purchases are suspended until Congress enrolls appropriations or staff submits the budget workbook.';
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
        or (
          y.appropriation_deadline_at is not null
          and now() <= y.appropriation_deadline_at
        )
      )
  ) then
    raise exception
      'Economy is frozen until the annual appropriations act is enrolled, the budget workbook is submitted, or the active fiscal-year grace window is open.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
