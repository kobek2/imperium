-- Staff: on active FY4, enforce enacted FY4 brackets + appropriations JSON, zero federal treasury cash and FY outlays,
-- clear FY4 tax events, then set every profile's income-tax row from marginal tax on hourly_income since FY start
-- (paid_amount = 0, outstanding = assessed, penalties cleared).

create or replace function public.admin_fy4_apply_budget_tax_baseline()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  y record;
  v_brackets jsonb :=
    '[
      {"ceiling":20000,"rate":0.15},
      {"ceiling":50000,"rate":0.20},
      {"ceiling":100000,"rate":0.25},
      {"ceiling":200000,"rate":0.30},
      {"ceiling":null,"rate":0.349}
    ]'::jsonb;
  v_lines jsonb :=
    '[
      {"key":"infrastructure","label":"Infrastructure and Transportation","base_minimum":35691670,"minimum":35691670,"allocated":35691670},
      {"key":"education","label":"Education","base_minimum":31362069,"minimum":31362069,"allocated":31362069},
      {"key":"healthcare","label":"Healthcare","base_minimum":30074213,"minimum":30074213,"allocated":30074213},
      {"key":"defense","label":"Defense and National Security","base_minimum":35691672,"minimum":35691672,"allocated":35691672},
      {"key":"social_welfare","label":"Social Welfare Programs","base_minimum":37856475,"minimum":37856475,"allocated":37856475},
      {"key":"environment","label":"Environmental Protection","base_minimum":24223733,"minimum":24223733,"allocated":24223733},
      {"key":"economic_development","label":"Economic Development and Job Creation","base_minimum":37212547,"minimum":37212547,"allocated":37212547},
      {"key":"science_tech","label":"Science and Technology Research","base_minimum":21648024,"minimum":21648024,"allocated":21648024},
      {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","base_minimum":8659207,"minimum":8659207,"allocated":8659207},
      {"key":"relief","label":"Relief Funds","base_minimum":21648024,"minimum":21648024,"allocated":21648024}
    ]'::jsonb;
  u record;
  v_inflow numeric;
  v_tax numeric;
  v_due timestamptz;
  v_rows int := 0;
  v_assessed_total numeric := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may run this FY4 tax baseline.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then
    raise exception 'No active fiscal year.';
  end if;
  if y.year_index is distinct from 4 then
    raise exception 'This baseline applies only when the active fiscal year is FY 4 (year_index = 4). Current: %.', y.year_index;
  end if;

  update public.federal_budgets
  set
    tax_brackets = v_brackets,
    line_items = v_lines,
    status = 'submitted',
    submitted_at = coalesce(submitted_at, v_now),
    updated_at = v_now
  where fiscal_year_id = y.id;

  update public.federal_treasury
  set balance = 0
  where id = 1;

  delete from public.federal_treasury_outlays where fiscal_year_id = y.id;

  delete from public.fiscal_tax_events where fiscal_year_id = y.id;

  v_due := v_now + (greatest(1, least(60, coalesce(y.tax_due_days_after_close, 7))) * interval '1 day');

  for u in select id from public.profiles
  loop
    select coalesce(sum(l.delta), 0) into v_inflow
    from public.economy_ledger l
    where l.wallet_user_id = u.id
      and l.kind = 'hourly_income'
      and l.delta > 0
      and l.created_at >= y.started_at;

    v_tax := round(public.fiscal_marginal_tax(v_inflow, v_brackets), 2);
    v_assessed_total := v_assessed_total + coalesce(v_tax, 0);

    insert into public.fiscal_tax_accounts (
      fiscal_year_id,
      user_id,
      assessed_tax,
      paid_amount,
      outstanding_amount,
      total_penalties,
      due_at,
      status,
      last_warning_scope,
      last_warning_at,
      penalty_applied_through_date,
      updated_at
    ) values (
      y.id,
      u.id,
      greatest(0::numeric, v_tax),
      0,
      greatest(0::numeric, v_tax),
      0,
      v_due,
      case when coalesce(v_tax, 0) <= 0 then 'paid' else 'pending' end,
      null,
      null,
      null,
      v_now
    )
    on conflict (fiscal_year_id, user_id) do update
    set
      assessed_tax = excluded.assessed_tax,
      paid_amount = 0,
      outstanding_amount = excluded.outstanding_amount,
      total_penalties = 0,
      due_at = excluded.due_at,
      status = excluded.status,
      last_warning_scope = null,
      last_warning_at = null,
      penalty_applied_through_date = null,
      updated_at = v_now;

    v_rows := v_rows + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y.id,
    'profiles_updated', v_rows,
    'sum_assessed_income_tax', round(v_assessed_total, 2)
  );
end;
$$;

comment on function public.admin_fy4_apply_budget_tax_baseline() is
  'Staff (active FY4): sync federal budget brackets/lines to enacted FY4 law, zero treasury + FY outlays, clear FY4 tax events, recompute each profile tax from hourly_income since FY start with paid_amount = 0.';

grant execute on function public.admin_fy4_apply_budget_tax_baseline() to authenticated;

notify pgrst, 'reload schema';
