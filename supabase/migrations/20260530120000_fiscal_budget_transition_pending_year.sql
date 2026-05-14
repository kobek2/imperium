-- Budget transition flow (replaces appropriations-driven economy shutdown):
-- 1) Staff start the 24h window (admin_start_appropriations_window): sets deadline on the active FY
--    and opens a `pending_activation` successor FY + cloned draft federal budget.
-- 2) President edits/saves that draft; submitting it runs the former fiscal_close_year settlement on the
--    active FY and activates the pending row (no separate fiscal_close_year insert).
-- 3) Unfreezing the active FY advances all wallets' last_collected_at so freeze time is not paid out later.
-- 4) Tax penalties accrue only on accounts tied to closed fiscal years (prior-year arrear), not the open FY assessment.

-- ---------- status: allow pending_activation ----------
alter table public.rp_fiscal_years drop constraint if exists rp_fiscal_years_status_check;

alter table public.rp_fiscal_years
  add constraint rp_fiscal_years_status_check
  check (status in ('active', 'closed', 'pending_activation'));

alter table public.rp_fiscal_years
  add column if not exists pending_parent_fiscal_year_id uuid references public.rp_fiscal_years (id) on delete cascade;

comment on column public.rp_fiscal_years.pending_parent_fiscal_year_id is
  'When status = pending_activation, the active fiscal year this row will replace once its federal budget is submitted.';

create index if not exists idx_rp_fiscal_years_pending_parent
  on public.rp_fiscal_years (pending_parent_fiscal_year_id)
  where status = 'pending_activation';

-- ---------- Unfreeze: forfeit wall-clock accrual window for hourly collects ----------
create or replace function public._rp_fiscal_years_on_unfreeze_reset_collect_baselines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(old.economy_activity_frozen, false) = true
     and coalesce(new.economy_activity_frozen, false) = false
     and new.status = 'active' then
    update public.economy_wallets
    set last_collected_at = now(),
        updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rp_fiscal_years_unfreeze_collect on public.rp_fiscal_years;
create trigger trg_rp_fiscal_years_unfreeze_collect
after update of economy_activity_frozen on public.rp_fiscal_years
for each row
execute function public._rp_fiscal_years_on_unfreeze_reset_collect_baselines();

-- ---------- Penalties: closed fiscal years only (carryover arrear) ----------
create or replace function public.fiscal_apply_tax_penalties()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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

  select * into y_active
  from public.rp_fiscal_years
  where status = 'active'
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;

  v_rate := greatest(0.000001::numeric, coalesce(y_active.tax_penalty_daily_rate, 0.05::numeric));

  for row_rec in
    select a.*
    from public.fiscal_tax_accounts a
    join public.rp_fiscal_years fy on fy.id = a.fiscal_year_id
    where fy.status = 'closed'
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
      jsonb_build_object('days', days_over, 'daily_rate', v_rate, 'penalty_scope', 'closed_fiscal_year_carryover'),
      v_uid
    );
    touched := touched + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', touched);
end;
$$;

-- ---------- Staff: start / refresh 24h window + open pending FY draft ----------
create or replace function public.admin_start_appropriations_window(p_hours int default 24)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  v_hours int;
  v_now timestamptz := now();
  v_deadline timestamptz;
  b record;
  v_pending_id uuid;
  v_next_idx int;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may start the budget transition countdown.';
  end if;

  v_hours := greatest(1, least(coalesce(p_hours, 24), 168));

  select * into y
  from public.rp_fiscal_years
  where status = 'active'
  for update;

  if not found then
    raise exception 'No active fiscal year.';
  end if;

  select * into b from public.federal_budgets where fiscal_year_id = y.id limit 1;
  if not found or b.status is distinct from 'submitted' then
    raise exception 'The active fiscal year must have a submitted federal budget before opening a transition draft.';
  end if;

  v_deadline := v_now + make_interval(hours => v_hours);

  update public.rp_fiscal_years
  set
    appropriation_clock_started_at = v_now,
    appropriation_deadline_at = v_deadline,
    budget_initial_window_ends_at = v_deadline,
    budget_initial_window_missed_at = null,
    appropriation_window_hours = v_hours
  where id = y.id;

  select id into v_pending_id
  from public.rp_fiscal_years
  where pending_parent_fiscal_year_id = y.id
    and status = 'pending_activation'
  limit 1;

  if v_pending_id is not null then
    return jsonb_build_object(
      'ok', true,
      'fiscal_year_id', y.id,
      'pending_fiscal_year_id', v_pending_id,
      'appropriation_deadline_at', v_deadline,
      'hours', v_hours,
      'message', 'Countdown refreshed; existing transition draft kept.'
    );
  end if;

  v_next_idx := y.year_index + 1;

  if exists (select 1 from public.rp_fiscal_years where year_index = v_next_idx) then
    raise exception 'Next fiscal index % already exists; resolve duplicate years before starting a transition.', v_next_idx;
  end if;

  insert into public.rp_fiscal_years (
    year_index,
    label,
    status,
    gdp_opening_total,
    pending_parent_fiscal_year_id,
    appropriation_deadline_at,
    appropriations_act_bill_id,
    appropriation_clock_started_at,
    appropriation_window_hours,
    tax_due_days_after_close,
    tax_penalty_daily_rate,
    tax_warning_lead_days,
    economy_activity_frozen
  )
  values (
    v_next_idx,
    'FY ' || v_next_idx::text,
    'pending_activation',
    null,
    y.id,
    null,
    null,
    null,
    y.appropriation_window_hours,
    y.tax_due_days_after_close,
    y.tax_penalty_daily_rate,
    y.tax_warning_lead_days,
    false
  )
  returning id into v_pending_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  )
  values (
    v_pending_id,
    'draft',
    v_uid,
    b.tax_brackets,
    b.line_items,
    b.metrics,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y.id,
    'pending_fiscal_year_id', v_pending_id,
    'appropriation_deadline_at', v_deadline,
    'hours', v_hours,
    'message', 'Transition draft opened.'
  );
end;
$$;

-- ---------- Staff: cancel pending transition ----------
create or replace function public.admin_cancel_budget_transition()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y_act record;
  y_pen record;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may cancel a budget transition.';
  end if;

  select * into y_act from public.rp_fiscal_years where status = 'active' for update;
  if not found then
    raise exception 'No active fiscal year.';
  end if;

  select * into y_pen
  from public.rp_fiscal_years
  where pending_parent_fiscal_year_id = y_act.id
    and status = 'pending_activation'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No pending transition fiscal year.');
  end if;

  delete from public.rp_fiscal_years where id = y_pen.id;

  update public.rp_fiscal_years
  set
    appropriation_deadline_at = null,
    budget_initial_window_ends_at = null,
    budget_initial_window_missed_at = null,
    appropriation_clock_started_at = null
  where id = y_act.id;

  return jsonb_build_object('ok', true, 'cancelled_pending', true);
end;
$$;

grant execute on function public.admin_cancel_budget_transition() to authenticated;

-- ---------- Save draft: allow pending_activation child of active FY ----------
create or replace function public.fiscal_save_budget_draft(
  p_fiscal_year_id uuid,
  p_tax_brackets jsonb,
  p_line_items jsonb,
  p_metrics jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  y_active uuid;
  b record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (public._fiscal_is_president(v_uid) or public.is_staff_admin(v_uid)) then
    raise exception 'Only the President or a full staff operator may edit the federal budget.';
  end if;

  select id into y_active from public.rp_fiscal_years where status = 'active' limit 1;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;

  if y.status = 'active' then
    null;
  elsif y.status = 'pending_activation' and y.pending_parent_fiscal_year_id is not distinct from y_active then
    null;
  else
    raise exception 'Only the active fiscal year or its open transition draft may be edited.';
  end if;

  select * into b from public.federal_budgets where fiscal_year_id = p_fiscal_year_id for update;
  if found and b.status is not distinct from 'submitted' and not public.is_staff_admin(v_uid) then
    raise exception 'This federal budget is already enacted (submitted). Only full staff may override edits.';
  end if;

  if not found then
    insert into public.federal_budgets (
      fiscal_year_id, status, president_user_id, tax_brackets, line_items, metrics, updated_at
    ) values (
      p_fiscal_year_id, 'draft', v_uid, coalesce(p_tax_brackets, '[]'::jsonb), coalesce(p_line_items, '[]'::jsonb), coalesce(p_metrics, '{}'::jsonb), now()
    );
  else
    update public.federal_budgets
    set
      president_user_id = v_uid,
      tax_brackets = coalesce(p_tax_brackets, tax_brackets),
      line_items = coalesce(p_line_items, line_items),
      metrics = coalesce(p_metrics, metrics),
      updated_at = now()
    where id = b.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- Activate pending FY (year-end close on parent + promote child) ----------
create or replace function public._fiscal_activate_pending_fiscal_year(p_pending_id uuid, p_actor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y_new record;
  y_old record;
  b_new record;
  b_old record;
  v_started timestamptz;
  v_now timestamptz := now();
  v_gdp_before numeric;
  v_total_tax_assessed numeric := 0;
  v_prior_tax_paid numeric := 0;
  v_close_sweep_total numeric := 0;
  v_all_tax_collected numeric := 0;
  v_total_spend numeric := 0;
  v_funding_ratio numeric := 0;
  v_treasury_net numeric := 0;
  v_spend_minus_tax numeric := 0;
  v_debt_roll numeric := 0;
  u record;
  v_inflow numeric;
  v_tax numeric;
  wbal numeric;
  pay_now numeric;
  new_bal numeric;
  prior_paid numeric;
  remaining_due numeric;
  new_total_paid numeric;
  outst numeric;
  v_account_due timestamptz;
  v_due_row timestamptz;
  el jsonb;
  min_amt numeric;
  alloc numeric;
begin
  select * into y_new from public.rp_fiscal_years where id = p_pending_id for update;
  if not found or y_new.status is distinct from 'pending_activation' then
    raise exception 'Pending transition fiscal year not found.';
  end if;

  select * into y_old from public.rp_fiscal_years where id = y_new.pending_parent_fiscal_year_id for update;
  if not found or y_old.status is distinct from 'active' then
    raise exception 'Active parent fiscal year not found for this transition.';
  end if;

  select * into b_new from public.federal_budgets where fiscal_year_id = y_new.id for update;
  if not found or b_new.status is not distinct from 'submitted' then
    raise exception 'Save a draft for the transition year before submitting.';
  end if;

  for el in select * from jsonb_array_elements(b_new.line_items)
  loop
    min_amt := coalesce((el->>'minimum')::numeric, 0);
    alloc := coalesce((el->>'allocated')::numeric, 0);
    if alloc < min_amt then
      raise exception 'Line item % requires at least $% allocated (got $%).', el->>'key', min_amt, alloc;
    end if;
  end loop;

  select * into b_old from public.federal_budgets where fiscal_year_id = y_old.id for update;
  if not found or b_old.status is distinct from 'submitted' then
    raise exception 'Active fiscal year must keep a submitted budget until transition.';
  end if;

  v_started := y_old.started_at;

  update public.federal_budgets
  set status = 'submitted', submitted_at = v_now, president_user_id = coalesce(b_new.president_user_id, p_actor), updated_at = v_now
  where id = b_new.id;

  select coalesce(sum((elem->>'allocated')::numeric), 0) into v_total_spend
  from jsonb_array_elements(b_old.line_items) elem;

  select coalesce(sum(balance), 0) into v_gdp_before from public.economy_wallets;

  select coalesce(sum(paid_amount), 0) into v_prior_tax_paid
  from public.fiscal_tax_accounts
  where fiscal_year_id = y_old.id;

  for u in select id from public.profiles
  loop
    select coalesce(sum(delta), 0) into v_inflow
    from public.economy_ledger
    where wallet_user_id = u.id
      and kind = 'hourly_income'
      and delta > 0
      and created_at >= v_started
      and created_at < v_now;

    v_tax := public.fiscal_marginal_tax(v_inflow, b_old.tax_brackets);
    v_total_tax_assessed := v_total_tax_assessed + v_tax;

    prior_paid := coalesce(
      (
        select a.paid_amount
        from public.fiscal_tax_accounts a
        where a.fiscal_year_id = y_old.id and a.user_id = u.id
        limit 1
      ),
      0::numeric
    );
    v_account_due := (
      select a.due_at
      from public.fiscal_tax_accounts a
      where a.fiscal_year_id = y_old.id and a.user_id = u.id
      limit 1
    );

    remaining_due := greatest(0::numeric, v_tax - prior_paid);

    insert into public.economy_wallets (user_id) values (u.id) on conflict do nothing;
    select balance into wbal from public.economy_wallets where user_id = u.id for update;
    pay_now := least(coalesce(wbal, 0), remaining_due);
    new_bal := coalesce(wbal, 0) - pay_now;

    if pay_now > 0 then
      update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = u.id;
      insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
      values (
        u.id,
        -pay_now,
        new_bal,
        'fiscal_income_tax',
        jsonb_build_object(
          'fiscal_year_id', y_old.id,
          'gross_inflows', v_inflow,
          'tax_payment', pay_now,
          'tax_assessed', v_tax,
          'prior_paid', prior_paid,
          'remaining_before_sweep', remaining_due
        )
      );
      v_close_sweep_total := v_close_sweep_total + pay_now;
    end if;

    new_total_paid := prior_paid + pay_now;
    outst := greatest(0::numeric, v_tax - new_total_paid);
    v_due_row := coalesce(
      v_account_due,
      v_now + make_interval(days => coalesce(y_old.tax_due_days_after_close, 7))
    );

    insert into public.fiscal_tax_accounts (
      fiscal_year_id, user_id, assessed_tax, paid_amount, outstanding_amount, due_at, status
    ) values (
      y_old.id,
      u.id,
      v_tax,
      new_total_paid,
      outst,
      v_due_row,
      case
        when outst <= 0 then 'paid'
        when v_now::date > v_due_row::date then 'delinquent'
        else 'pending'
      end
    )
    on conflict (fiscal_year_id, user_id) do update
    set
      assessed_tax = excluded.assessed_tax,
      paid_amount = excluded.paid_amount,
      outstanding_amount = excluded.outstanding_amount,
      due_at = coalesce(public.fiscal_tax_accounts.due_at, excluded.due_at),
      status = excluded.status,
      updated_at = now();
  end loop;

  v_all_tax_collected := v_prior_tax_paid + v_close_sweep_total;
  v_treasury_net := v_close_sweep_total - v_total_spend;
  v_spend_minus_tax := greatest(0::numeric, v_total_spend - v_all_tax_collected);
  v_debt_roll := v_total_spend - v_all_tax_collected;

  update public.federal_treasury
  set balance = balance + v_treasury_net
  where id = 1;

  v_funding_ratio := case
    when v_total_spend <= 0 then 1
    else least(1, round(v_all_tax_collected / v_total_spend, 6))
  end;

  insert into public.fiscal_year_close_summaries (
    fiscal_year_id,
    appropriations_total,
    tax_assessed_total,
    tax_collected_total,
    funding_ratio,
    treasury_net_delta,
    spend_minus_tax_collected
  ) values (
    y_old.id,
    v_total_spend,
    v_total_tax_assessed,
    v_all_tax_collected,
    v_funding_ratio,
    v_treasury_net,
    v_spend_minus_tax
  )
  on conflict (fiscal_year_id) do update
  set
    appropriations_total = excluded.appropriations_total,
    tax_assessed_total = excluded.tax_assessed_total,
    tax_collected_total = excluded.tax_collected_total,
    funding_ratio = excluded.funding_ratio,
    treasury_net_delta = excluded.treasury_net_delta,
    spend_minus_tax_collected = excluded.spend_minus_tax_collected,
    created_at = now();

  update public.rp_fiscal_years
  set status = 'closed', closed_at = v_now, gdp_closing_total = v_gdp_before
  where id = y_old.id;

  update public.rp_fiscal_years
  set
    status = 'active',
    started_at = v_now,
    gdp_opening_total = (select coalesce(sum(balance), 0) from public.economy_wallets),
    pending_parent_fiscal_year_id = null,
    appropriation_deadline_at = null,
    appropriations_act_bill_id = null,
    appropriation_clock_started_at = null,
    appropriation_window_hours = y_old.appropriation_window_hours,
    tax_due_days_after_close = y_old.tax_due_days_after_close,
    tax_penalty_daily_rate = y_old.tax_penalty_daily_rate,
    tax_warning_lead_days = y_old.tax_warning_lead_days,
    budget_initial_window_ends_at = null,
    budget_initial_window_missed_at = null,
    budget_cycle_rp_key = null,
    economy_activity_frozen = false
  where id = y_new.id;

  if exists (select 1 from public.national_metrics m where m.fiscal_year_id = y_old.id) then
    insert into public.national_metrics (
      fiscal_year_id,
      government_approval,
      unemployment_rate,
      per_capita_income,
      us_debt,
      education_academic_scores,
      education_dropout_rate,
      education_higher_ed_enrollment,
      poverty_percentage,
      poverty_effect,
      homelessness,
      healthcare_coverage,
      life_expectancy,
      crime_total,
      crime_prisoners,
      infrastructure_road_quality,
      infrastructure_road_congestion,
      updated_by
    )
    select
      y_new.id,
      greatest(0, least(100, coalesce(m.government_approval, 50) * v_funding_ratio)),
      coalesce(m.unemployment_rate, 0) + (1 - v_funding_ratio) * 5,
      coalesce(m.per_capita_income, 0) * v_funding_ratio,
      greatest(0::numeric, coalesce(m.us_debt, 0) + v_debt_roll),
      coalesce(m.education_academic_scores, 0) * v_funding_ratio,
      coalesce(m.education_dropout_rate, 0) + (1 - v_funding_ratio) * 2,
      coalesce(m.education_higher_ed_enrollment, 0) * v_funding_ratio,
      coalesce(m.poverty_percentage, 0) + (1 - v_funding_ratio) * 3,
      coalesce(m.poverty_effect, 0) + (1 - v_funding_ratio) * 2,
      greatest(0, round(coalesce(m.homelessness, 0) * (1 + (1 - v_funding_ratio) * 0.2))),
      coalesce(m.healthcare_coverage, 0) * v_funding_ratio,
      coalesce(m.life_expectancy, 0) * (0.98 + 0.02 * v_funding_ratio),
      greatest(0, round(coalesce(m.crime_total, 0) * (1 + (1 - v_funding_ratio) * 0.15))),
      greatest(0, round(coalesce(m.crime_prisoners, 0) * (1 + (1 - v_funding_ratio) * 0.1))),
      coalesce(m.infrastructure_road_quality, 0) * v_funding_ratio,
      least(100, coalesce(m.infrastructure_road_congestion, 0) + (1 - v_funding_ratio) * 6),
      p_actor
    from public.national_metrics m
    where m.fiscal_year_id = y_old.id
    on conflict (fiscal_year_id) do update
    set
      government_approval = excluded.government_approval,
      unemployment_rate = excluded.unemployment_rate,
      per_capita_income = excluded.per_capita_income,
      us_debt = excluded.us_debt,
      education_academic_scores = excluded.education_academic_scores,
      education_dropout_rate = excluded.education_dropout_rate,
      education_higher_ed_enrollment = excluded.education_higher_ed_enrollment,
      poverty_percentage = excluded.poverty_percentage,
      poverty_effect = excluded.poverty_effect,
      homelessness = excluded.homelessness,
      healthcare_coverage = excluded.healthcare_coverage,
      life_expectancy = excluded.life_expectancy,
      crime_total = excluded.crime_total,
      crime_prisoners = excluded.crime_prisoners,
      infrastructure_road_quality = excluded.infrastructure_road_quality,
      infrastructure_road_congestion = excluded.infrastructure_road_congestion,
      updated_by = excluded.updated_by,
      updated_at = now();
  else
    insert into public.national_metrics (fiscal_year_id, updated_by)
    values (y_new.id, p_actor)
    on conflict (fiscal_year_id) do nothing;
  end if;

  insert into public.national_metrics_change_log (
    fiscal_year_id,
    changed_by,
    reason,
    old_values,
    new_values
  )
  values (
    y_old.id,
    p_actor,
    'Fiscal transition: funding ratio + treasury / debt roll-up (pending FY activated)',
    jsonb_build_object(
      'appropriations_total', v_total_spend,
      'tax_assessed_total', v_total_tax_assessed,
      'tax_collected_total', v_prior_tax_paid
    ),
    jsonb_build_object(
      'funding_ratio', v_funding_ratio,
      'treasury_net_delta', v_treasury_net,
      'spend_minus_tax_collected', v_spend_minus_tax,
      'us_debt_delta', v_debt_roll,
      'tax_collected_total', v_all_tax_collected,
      'tax_close_sweep_total', v_close_sweep_total,
      'activated_fiscal_year_id', y_new.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'transition', true,
    'closed_year_id', y_old.id,
    'total_tax_assessed', v_total_tax_assessed,
    'total_tax_collected', v_all_tax_collected,
    'tax_close_sweep_total', v_close_sweep_total,
    'total_spending', v_total_spend,
    'funding_ratio', v_funding_ratio,
    'treasury_net_delta', v_treasury_net,
    'spend_minus_tax_collected', v_spend_minus_tax,
    'us_debt_delta', v_debt_roll,
    'gdp_before_tax_snapshot', v_gdp_before,
    'new_fiscal_year_id', y_new.id
  );
end;
$$;

-- ---------- Submit budget: active FY unchanged; pending FY runs transition ----------
create or replace function public.fiscal_submit_budget(p_fiscal_year_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  b record;
  el jsonb;
  min_amt numeric;
  alloc numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (
    public._fiscal_is_president(v_uid)
    or public.is_staff_admin(v_uid)
  ) then
    raise exception 'Only the President or a full staff operator may submit the federal budget.';
  end if;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;

  if y.status = 'pending_activation' then
    return public._fiscal_activate_pending_fiscal_year(p_fiscal_year_id, v_uid);
  end if;

  if y.status is distinct from 'active' then
    raise exception 'Only the active fiscal year or an open transition draft may be submitted.';
  end if;

  select * into b from public.federal_budgets where fiscal_year_id = p_fiscal_year_id for update;
  if not found then raise exception 'No budget draft exists. Save a draft first.'; end if;
  if b.status = 'submitted' then raise exception 'Budget already submitted.'; end if;

  for el in select * from jsonb_array_elements(b.line_items)
  loop
    min_amt := coalesce((el->>'minimum')::numeric, 0);
    alloc := coalesce((el->>'allocated')::numeric, 0);
    if alloc < min_amt then
      raise exception 'Line item % requires at least $% allocated (got $%).', el->>'key', min_amt, alloc;
    end if;
  end loop;

  update public.federal_budgets
  set status = 'submitted', submitted_at = now(), president_user_id = coalesce(b.president_user_id, v_uid), updated_at = now()
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- Block legacy close while a transition draft is open ----------
create or replace function public.fiscal_close_year()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  b record;
  v_started timestamptz;
  v_now timestamptz := now();
  v_gdp_before numeric;
  v_total_tax_assessed numeric := 0;
  v_prior_tax_paid numeric := 0;
  v_close_sweep_total numeric := 0;
  v_all_tax_collected numeric := 0;
  v_total_spend numeric := 0;
  v_funding_ratio numeric := 0;
  v_treasury_net numeric := 0;
  v_spend_minus_tax numeric := 0;
  v_debt_roll numeric := 0;
  u record;
  v_inflow numeric;
  v_tax numeric;
  wbal numeric;
  pay_now numeric;
  new_bal numeric;
  prior_paid numeric;
  remaining_due numeric;
  new_total_paid numeric;
  outst numeric;
  v_account_due timestamptz;
  v_due_row timestamptz;
  v_new_year_id uuid;
  v_next_idx int;
  v_brackets jsonb;
  v_line_items jsonb;
  v_metrics jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (public._fiscal_is_president(v_uid) or public.is_staff_admin(v_uid)) then
    raise exception 'Only the President or a full staff operator may close the fiscal year.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' for update;
  if not found then raise exception 'No active fiscal year.'; end if;

  if exists (
    select 1
    from public.rp_fiscal_years p
    where p.pending_parent_fiscal_year_id = y.id
      and p.status = 'pending_activation'
  ) then
    raise exception
      'A transition-year draft is open. Submit that federal budget to roll the year, or ask staff to cancel the transition.';
  end if;

  select * into b from public.federal_budgets where fiscal_year_id = y.id for update;
  if not found or b.status is distinct from 'submitted' then
    raise exception 'Submit a federal budget before closing the year.';
  end if;

  v_started := y.started_at;
  v_brackets := b.tax_brackets;
  v_line_items := b.line_items;
  v_metrics := b.metrics;

  select coalesce(sum((elem->>'allocated')::numeric), 0) into v_total_spend
  from jsonb_array_elements(v_line_items) elem;

  select coalesce(sum(balance), 0) into v_gdp_before from public.economy_wallets;

  select coalesce(sum(paid_amount), 0) into v_prior_tax_paid
  from public.fiscal_tax_accounts
  where fiscal_year_id = y.id;

  for u in select id from public.profiles
  loop
    select coalesce(sum(delta), 0) into v_inflow
    from public.economy_ledger
    where wallet_user_id = u.id
      and kind = 'hourly_income'
      and delta > 0
      and created_at >= v_started
      and created_at < v_now;

    v_tax := public.fiscal_marginal_tax(v_inflow, v_brackets);
    v_total_tax_assessed := v_total_tax_assessed + v_tax;

    prior_paid := coalesce(
      (
        select a.paid_amount
        from public.fiscal_tax_accounts a
        where a.fiscal_year_id = y.id and a.user_id = u.id
        limit 1
      ),
      0::numeric
    );
    v_account_due := (
      select a.due_at
      from public.fiscal_tax_accounts a
      where a.fiscal_year_id = y.id and a.user_id = u.id
      limit 1
    );

    remaining_due := greatest(0::numeric, v_tax - prior_paid);

    insert into public.economy_wallets (user_id) values (u.id) on conflict do nothing;
    select balance into wbal from public.economy_wallets where user_id = u.id for update;
    pay_now := least(coalesce(wbal, 0), remaining_due);
    new_bal := coalesce(wbal, 0) - pay_now;

    if pay_now > 0 then
      update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = u.id;
      insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
      values (
        u.id,
        -pay_now,
        new_bal,
        'fiscal_income_tax',
        jsonb_build_object(
          'fiscal_year_id', y.id,
          'gross_inflows', v_inflow,
          'tax_payment', pay_now,
          'tax_assessed', v_tax,
          'prior_paid', prior_paid,
          'remaining_before_sweep', remaining_due
        )
      );
      v_close_sweep_total := v_close_sweep_total + pay_now;
    end if;

    new_total_paid := prior_paid + pay_now;
    outst := greatest(0::numeric, v_tax - new_total_paid);
    v_due_row := coalesce(
      v_account_due,
      v_now + make_interval(days => coalesce(y.tax_due_days_after_close, 7))
    );

    insert into public.fiscal_tax_accounts (
      fiscal_year_id, user_id, assessed_tax, paid_amount, outstanding_amount, due_at, status
    ) values (
      y.id,
      u.id,
      v_tax,
      new_total_paid,
      outst,
      v_due_row,
      case
        when outst <= 0 then 'paid'
        when v_now::date > v_due_row::date then 'delinquent'
        else 'pending'
      end
    )
    on conflict (fiscal_year_id, user_id) do update
    set
      assessed_tax = excluded.assessed_tax,
      paid_amount = excluded.paid_amount,
      outstanding_amount = excluded.outstanding_amount,
      due_at = coalesce(public.fiscal_tax_accounts.due_at, excluded.due_at),
      status = excluded.status,
      updated_at = now();
  end loop;

  v_all_tax_collected := v_prior_tax_paid + v_close_sweep_total;

  v_treasury_net := v_close_sweep_total - v_total_spend;
  v_spend_minus_tax := greatest(0::numeric, v_total_spend - v_all_tax_collected);
  v_debt_roll := v_total_spend - v_all_tax_collected;

  update public.federal_treasury
  set balance = balance + v_treasury_net
  where id = 1;

  v_funding_ratio := case
    when v_total_spend <= 0 then 1
    else least(1, round(v_all_tax_collected / v_total_spend, 6))
  end;

  insert into public.fiscal_year_close_summaries (
    fiscal_year_id,
    appropriations_total,
    tax_assessed_total,
    tax_collected_total,
    funding_ratio,
    treasury_net_delta,
    spend_minus_tax_collected
  ) values (
    y.id,
    v_total_spend,
    v_total_tax_assessed,
    v_all_tax_collected,
    v_funding_ratio,
    v_treasury_net,
    v_spend_minus_tax
  )
  on conflict (fiscal_year_id) do update
  set
    appropriations_total = excluded.appropriations_total,
    tax_assessed_total = excluded.tax_assessed_total,
    tax_collected_total = excluded.tax_collected_total,
    funding_ratio = excluded.funding_ratio,
    treasury_net_delta = excluded.treasury_net_delta,
    spend_minus_tax_collected = excluded.spend_minus_tax_collected,
    created_at = now();

  update public.rp_fiscal_years
  set status = 'closed', closed_at = v_now, gdp_closing_total = v_gdp_before
  where id = y.id;

  v_next_idx := y.year_index + 1;
  insert into public.rp_fiscal_years (
    year_index,
    label,
    status,
    gdp_opening_total,
    appropriation_deadline_at,
    appropriations_act_bill_id,
    appropriation_clock_started_at,
    appropriation_window_hours,
    tax_due_days_after_close,
    tax_penalty_daily_rate,
    tax_warning_lead_days
  )
  values (
    v_next_idx,
    'FY ' || v_next_idx::text,
    'active',
    (select coalesce(sum(balance), 0) from public.economy_wallets),
    null,
    null,
    null,
    null,
    y.appropriation_window_hours,
    y.tax_due_days_after_close,
    y.tax_penalty_daily_rate,
    y.tax_warning_lead_days
  )
  returning id into v_new_year_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  ) values (
    v_new_year_id,
    'draft',
    v_uid,
    v_brackets,
    v_line_items,
    v_metrics,
    now()
  );

  if exists (select 1 from public.national_metrics m where m.fiscal_year_id = y.id) then
    insert into public.national_metrics (
      fiscal_year_id,
      government_approval,
      unemployment_rate,
      per_capita_income,
      us_debt,
      education_academic_scores,
      education_dropout_rate,
      education_higher_ed_enrollment,
      poverty_percentage,
      poverty_effect,
      homelessness,
      healthcare_coverage,
      life_expectancy,
      crime_total,
      crime_prisoners,
      infrastructure_road_quality,
      infrastructure_road_congestion,
      updated_by
    )
    select
      v_new_year_id,
      greatest(0, least(100, coalesce(m.government_approval, 50) * v_funding_ratio)),
      coalesce(m.unemployment_rate, 0) + (1 - v_funding_ratio) * 5,
      coalesce(m.per_capita_income, 0) * v_funding_ratio,
      greatest(0::numeric, coalesce(m.us_debt, 0) + v_debt_roll),
      coalesce(m.education_academic_scores, 0) * v_funding_ratio,
      coalesce(m.education_dropout_rate, 0) + (1 - v_funding_ratio) * 2,
      coalesce(m.education_higher_ed_enrollment, 0) * v_funding_ratio,
      coalesce(m.poverty_percentage, 0) + (1 - v_funding_ratio) * 3,
      coalesce(m.poverty_effect, 0) + (1 - v_funding_ratio) * 2,
      greatest(0, round(coalesce(m.homelessness, 0) * (1 + (1 - v_funding_ratio) * 0.2))),
      coalesce(m.healthcare_coverage, 0) * v_funding_ratio,
      coalesce(m.life_expectancy, 0) * (0.98 + 0.02 * v_funding_ratio),
      greatest(0, round(coalesce(m.crime_total, 0) * (1 + (1 - v_funding_ratio) * 0.15))),
      greatest(0, round(coalesce(m.crime_prisoners, 0) * (1 + (1 - v_funding_ratio) * 0.1))),
      coalesce(m.infrastructure_road_quality, 0) * v_funding_ratio,
      least(100, coalesce(m.infrastructure_road_congestion, 0) + (1 - v_funding_ratio) * 6),
      v_uid
    from public.national_metrics m
    where m.fiscal_year_id = y.id;
  else
    insert into public.national_metrics (fiscal_year_id, updated_by)
    values (v_new_year_id, v_uid);
  end if;

  insert into public.national_metrics_change_log (
    fiscal_year_id,
    changed_by,
    reason,
    old_values,
    new_values
  )
  values (
    y.id,
    v_uid,
    'Fiscal close: funding ratio + treasury / debt roll-up',
    jsonb_build_object(
      'appropriations_total', v_total_spend,
      'tax_assessed_total', v_total_tax_assessed,
      'tax_collected_total', v_prior_tax_paid
    ),
    jsonb_build_object(
      'funding_ratio', v_funding_ratio,
      'treasury_net_delta', v_treasury_net,
      'spend_minus_tax_collected', v_spend_minus_tax,
      'us_debt_delta', v_debt_roll,
      'tax_collected_total', v_all_tax_collected,
      'tax_close_sweep_total', v_close_sweep_total
    )
  );

  return jsonb_build_object(
    'ok', true,
    'closed_year_id', y.id,
    'total_tax_assessed', v_total_tax_assessed,
    'total_tax_collected', v_all_tax_collected,
    'tax_close_sweep_total', v_close_sweep_total,
    'total_spending', v_total_spend,
    'funding_ratio', v_funding_ratio,
    'treasury_net_delta', v_treasury_net,
    'spend_minus_tax_collected', v_spend_minus_tax,
    'us_debt_delta', v_debt_roll,
    'gdp_before_tax_snapshot', v_gdp_before,
    'new_fiscal_year_id', v_new_year_id,
    'economy_frozen_until_submit', true
  );
end;
$$;

notify pgrst, 'reload schema';
