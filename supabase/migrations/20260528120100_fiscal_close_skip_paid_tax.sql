-- fiscal_close_year: do not collect again from wallets when income tax is already fully paid
-- (fiscal_pay_tax credits treasury during the year; close only sweeps remaining_due).
-- Also preserve cumulative paid_amount on upsert instead of overwriting with close-only slice.

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
