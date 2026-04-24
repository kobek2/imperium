-- Fiscal governance lifecycle: configurable appropriations clock, tax accounts/events,
-- treasury powers, player tax payments, and close-year funding-ratio snapshots.

alter table public.rp_fiscal_years
  add column if not exists appropriation_clock_started_at timestamptz,
  add column if not exists appropriation_window_hours int not null default 24
    check (appropriation_window_hours between 1 and 336),
  add column if not exists tax_due_days_after_close int not null default 7
    check (tax_due_days_after_close between 1 and 60),
  add column if not exists tax_penalty_daily_rate numeric(8,6) not null default 0.05
    check (tax_penalty_daily_rate >= 0 and tax_penalty_daily_rate <= 1),
  add column if not exists tax_warning_lead_days int not null default 2
    check (tax_warning_lead_days between 0 and 30);

create table if not exists public.fiscal_tax_accounts (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assessed_tax numeric(20,2) not null default 0,
  paid_amount numeric(20,2) not null default 0,
  total_penalties numeric(20,2) not null default 0,
  outstanding_amount numeric(20,2) not null default 0,
  assessed_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','delinquent','paid')),
  last_warning_at timestamptz,
  penalty_applied_through_date date,
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id, user_id)
);

create index if not exists fiscal_tax_accounts_fy_status_idx
  on public.fiscal_tax_accounts (fiscal_year_id, status);

create table if not exists public.fiscal_tax_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.fiscal_tax_accounts(id) on delete cascade,
  fiscal_year_id uuid not null references public.rp_fiscal_years(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null
    check (event_type in ('assessment','payment','warning','penalty','status_change','admin_config')),
  amount numeric(20,2),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists fiscal_tax_events_fy_created_idx
  on public.fiscal_tax_events (fiscal_year_id, created_at desc);

create table if not exists public.fiscal_year_close_summaries (
  fiscal_year_id uuid primary key references public.rp_fiscal_years(id) on delete cascade,
  appropriations_total numeric(20,2) not null default 0,
  tax_assessed_total numeric(20,2) not null default 0,
  tax_collected_total numeric(20,2) not null default 0,
  funding_ratio numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.fiscal_tax_accounts enable row level security;
alter table public.fiscal_tax_events enable row level security;
alter table public.fiscal_year_close_summaries enable row level security;

drop policy if exists "fiscal_tax_accounts read authed" on public.fiscal_tax_accounts;
create policy "fiscal_tax_accounts read authed" on public.fiscal_tax_accounts
  for select using (auth.role() = 'authenticated');

drop policy if exists "fiscal_tax_events read authed" on public.fiscal_tax_events;
create policy "fiscal_tax_events read authed" on public.fiscal_tax_events
  for select using (auth.role() = 'authenticated');

drop policy if exists "fiscal_year_close_summaries read authed" on public.fiscal_year_close_summaries;
create policy "fiscal_year_close_summaries read authed" on public.fiscal_year_close_summaries
  for select using (auth.role() = 'authenticated');

create or replace function public._fiscal_is_treasury_officer(p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    public._fiscal_is_president(p_uid)
    or public._fiscal_is_admin(p_uid)
    or public.is_staff_admin(p_uid)
    or exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'secretary_of_treasury'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = 'secretary_of_treasury'
    ),
    false
  );
$$;

create or replace function public.fiscal_start_appropriation_clock_if_president_seated()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y record;
  has_president boolean := false;
begin
  select * into y
  from public.rp_fiscal_years
  where status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No active fiscal year.');
  end if;

  has_president := exists (
    select 1
    from public.government_role_grants g
    where g.role_key = 'president'
  ) or exists (
    select 1 from public.profiles p where p.office_role = 'president'
  );

  if not has_president then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'no_president');
  end if;

  if y.appropriation_clock_started_at is null then
    update public.rp_fiscal_years
    set appropriation_clock_started_at = now(),
        appropriation_deadline_at = now() + make_interval(hours => greatest(1, coalesce(y.appropriation_window_hours, 24)))
    where id = y.id;
    return jsonb_build_object('ok', true, 'started', true);
  end if;

  return jsonb_build_object('ok', true, 'started', false, 'reason', 'already_started');
end;
$$;

grant execute on function public.fiscal_start_appropriation_clock_if_president_seated() to authenticated;

create or replace function public._fiscal_try_start_clock_on_president_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'government_role_grants' and new.role_key = 'president' then
    perform public.fiscal_start_appropriation_clock_if_president_seated();
  elsif tg_table_name = 'profiles' and new.office_role = 'president' and coalesce(old.office_role, '') <> 'president' then
    perform public.fiscal_start_appropriation_clock_if_president_seated();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiscal_start_clock_on_president_grant on public.government_role_grants;
create trigger trg_fiscal_start_clock_on_president_grant
after insert on public.government_role_grants
for each row
execute function public._fiscal_try_start_clock_on_president_grant();

drop trigger if exists trg_fiscal_start_clock_on_profile_president on public.profiles;
create trigger trg_fiscal_start_clock_on_profile_president
after update of office_role on public.profiles
for each row
execute function public._fiscal_try_start_clock_on_president_grant();

create or replace function public.fiscal_admin_update_config(
  p_appropriation_window_hours int default null,
  p_tax_due_days_after_close int default null,
  p_tax_penalty_daily_rate numeric default null,
  p_tax_warning_lead_days int default null
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then
    raise exception 'Only full staff operators may update fiscal config.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' for update;
  if not found then raise exception 'No active fiscal year.'; end if;

  update public.rp_fiscal_years
  set
    appropriation_window_hours = coalesce(p_appropriation_window_hours, appropriation_window_hours),
    tax_due_days_after_close = coalesce(p_tax_due_days_after_close, tax_due_days_after_close),
    tax_penalty_daily_rate = coalesce(p_tax_penalty_daily_rate, tax_penalty_daily_rate),
    tax_warning_lead_days = coalesce(p_tax_warning_lead_days, tax_warning_lead_days)
  where id = y.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.fiscal_admin_update_config(int, int, numeric, int) to authenticated;

create or replace function public.fiscal_treasury_dashboard()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  assessed numeric := 0;
  paid numeric := 0;
  outstanding numeric := 0;
  delinquent_count int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then
    return jsonb_build_object('fiscal_year_id', null, 'assessed', 0, 'paid', 0, 'outstanding', 0, 'delinquent_count', 0);
  end if;

  select
    coalesce(sum(a.assessed_tax), 0),
    coalesce(sum(a.paid_amount), 0),
    coalesce(sum(a.outstanding_amount), 0),
    coalesce(sum(case when a.status = 'delinquent' then 1 else 0 end), 0)::int
  into assessed, paid, outstanding, delinquent_count
  from public.fiscal_tax_accounts a
  where a.fiscal_year_id = y.id;

  return jsonb_build_object(
    'fiscal_year_id', y.id,
    'assessed', assessed,
    'paid', paid,
    'outstanding', outstanding,
    'delinquent_count', delinquent_count
  );
end;
$$;

grant execute on function public.fiscal_treasury_dashboard() to authenticated;

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
  warned int := 0;
  row_rec record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'warned', 0);
  end if;

  for row_rec in
    select a.*
    from public.fiscal_tax_accounts a
    where a.fiscal_year_id = y.id
      and a.outstanding_amount > 0
      and (
        (p_scope = 'all')
        or (p_scope = 'due_soon' and a.due_at <= now() + make_interval(days => y.tax_warning_lead_days))
        or (p_scope = 'delinquent' and a.status = 'delinquent')
      )
      and (a.last_warning_at is null or a.last_warning_at::date < now()::date)
  loop
    update public.fiscal_tax_accounts
    set last_warning_at = now(),
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

grant execute on function public.fiscal_issue_tax_warning(text) to authenticated;

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
  row_rec record;
  v_today date := now()::date;
  from_day date;
  days_over int;
  penalty numeric;
  touched int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then return jsonb_build_object('ok', true, 'updated', 0); end if;

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

    penalty := round(row_rec.outstanding_amount * y.tax_penalty_daily_rate * days_over, 2);
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
      jsonb_build_object('days', days_over, 'daily_rate', y.tax_penalty_daily_rate),
      v_uid
    );
    touched := touched + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', touched);
end;
$$;

grant execute on function public.fiscal_apply_tax_penalties() to authenticated;

create or replace function public.fiscal_pay_tax(p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  a record;
  w record;
  amt numeric := round(coalesce(p_amount, 0), 2);
  pay_amt numeric;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt <= 0 then raise exception 'Payment amount must be positive.'; end if;

  select * into y from public.rp_fiscal_years where status = 'active' limit 1;
  if not found then raise exception 'No active fiscal year.'; end if;

  select * into a
  from public.fiscal_tax_accounts
  where fiscal_year_id = y.id and user_id = v_uid
  for update;
  if not found then raise exception 'No active tax account for this fiscal year.'; end if;
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
    jsonb_build_object('fiscal_year_id', y.id, 'payment', pay_amt)
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
    a.id, y.id, v_uid, 'payment', pay_amt,
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

grant execute on function public.fiscal_pay_tax(numeric) to authenticated;

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
  v_total_tax_collected numeric := 0;
  v_total_spend numeric := 0;
  v_funding_ratio numeric := 0;
  u record;
  v_inflow numeric;
  v_tax numeric;
  wbal numeric;
  pay_now numeric;
  new_bal numeric;
  v_new_year_id uuid;
  v_next_idx int;
  v_brackets jsonb;
  v_line_items jsonb;
  v_metrics jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_president(v_uid) then
    raise exception 'Only the President may close the fiscal year.';
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

    insert into public.economy_wallets (user_id) values (u.id) on conflict do nothing;
    select balance into wbal from public.economy_wallets where user_id = u.id for update;
    pay_now := least(coalesce(wbal, 0), v_tax);
    new_bal := coalesce(wbal, 0) - pay_now;

    if pay_now > 0 then
      update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = u.id;
      insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
      values (
        u.id,
        -pay_now,
        new_bal,
        'fiscal_income_tax',
        jsonb_build_object('fiscal_year_id', y.id, 'gross_inflows', v_inflow, 'tax_payment', pay_now, 'tax_assessed', v_tax)
      );
      v_total_tax_collected := v_total_tax_collected + pay_now;
    end if;

    insert into public.fiscal_tax_accounts (
      fiscal_year_id, user_id, assessed_tax, paid_amount, outstanding_amount, due_at, status
    ) values (
      y.id,
      u.id,
      v_tax,
      pay_now,
      greatest(0, v_tax - pay_now),
      v_now + make_interval(days => coalesce(y.tax_due_days_after_close, 7)),
      case
        when greatest(0, v_tax - pay_now) = 0 then 'paid'
        else 'pending'
      end
    )
    on conflict (fiscal_year_id, user_id) do update
    set
      assessed_tax = excluded.assessed_tax,
      paid_amount = excluded.paid_amount,
      outstanding_amount = excluded.outstanding_amount,
      due_at = excluded.due_at,
      status = excluded.status,
      updated_at = now();
  end loop;

  update public.federal_treasury
  set balance = balance + v_total_tax_collected - v_total_spend
  where id = 1;

  v_funding_ratio := case
    when v_total_spend <= 0 then 1
    else least(1, round(v_total_tax_collected / v_total_spend, 6))
  end;

  insert into public.fiscal_year_close_summaries (
    fiscal_year_id, appropriations_total, tax_assessed_total, tax_collected_total, funding_ratio
  ) values (
    y.id, v_total_spend, v_total_tax_assessed, v_total_tax_collected, v_funding_ratio
  )
  on conflict (fiscal_year_id) do update
  set
    appropriations_total = excluded.appropriations_total,
    tax_assessed_total = excluded.tax_assessed_total,
    tax_collected_total = excluded.tax_collected_total,
    funding_ratio = excluded.funding_ratio,
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
      m.us_debt,
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
    'Fiscal close funding ratio adjustment',
    jsonb_build_object(
      'appropriations_total', v_total_spend,
      'tax_assessed_total', v_total_tax_assessed,
      'tax_collected_total', v_total_tax_collected
    ),
    jsonb_build_object(
      'funding_ratio', v_funding_ratio
    )
  );

  return jsonb_build_object(
    'ok', true,
    'closed_year_id', y.id,
    'total_tax_assessed', v_total_tax_assessed,
    'total_tax_collected', v_total_tax_collected,
    'total_spending', v_total_spend,
    'funding_ratio', v_funding_ratio,
    'gdp_before_tax_snapshot', v_gdp_before,
    'new_fiscal_year_id', v_new_year_id,
    'economy_frozen_until_submit', true
  );
end;
$$;

notify pgrst, 'reload schema';
