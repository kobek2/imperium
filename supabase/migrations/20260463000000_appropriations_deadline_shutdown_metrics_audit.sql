-- Appropriations clock per FY (new years only), government shutdown on missed deadline,
-- national metrics change audit trail, YTD income-tax estimate, optional line-item minimum inflation.

-- ---------- Schema ----------
alter table public.rp_fiscal_years
  add column if not exists appropriation_deadline_at timestamptz,
  add column if not exists appropriations_act_bill_id uuid references public.bills (id) on delete set null;

comment on column public.rp_fiscal_years.appropriation_deadline_at is
  'When set, the President must enroll an appropriations act for this FY before this IRL instant or the economy enters shutdown (no collects / spends). Legacy FY rows leave this null.';
comment on column public.rp_fiscal_years.appropriations_act_bill_id is
  'Bill id of the enrolled federal appropriations act for this fiscal year, once signed into law.';

alter table public.bills
  add column if not exists is_federal_appropriations boolean not null default false,
  add column if not exists linked_fiscal_year_id uuid references public.rp_fiscal_years (id) on delete set null;

create index if not exists bills_linked_fiscal_year_idx on public.bills (linked_fiscal_year_id)
  where linked_fiscal_year_id is not null;

create table if not exists public.national_metrics_change_log (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  reason text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists national_metrics_change_log_fy_idx
  on public.national_metrics_change_log (fiscal_year_id, created_at desc);

alter table public.national_metrics_change_log enable row level security;

drop policy if exists "national_metrics_change_log read authed" on public.national_metrics_change_log;
create policy "national_metrics_change_log read authed" on public.national_metrics_change_log
  for select using (auth.role() = 'authenticated');

-- ---------- Economy gate (submitted budget + appropriations shutdown) ----------
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
    join public.federal_budgets b on b.fiscal_year_id = y.id
    where y.status = 'active' and b.status = 'submitted'
  ) then
    raise exception 'Economy is frozen until the President submits a federal budget for the active fiscal year.';
  end if;
end;
$$;

-- ---------- Appropriations enrollment (called after President signs bill into law) ----------
create or replace function public.fiscal_on_appropriations_enrolled(p_bill_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b record;
  y record;
begin
  if p_bill_id is null then
    raise exception 'Bill id required.';
  end if;

  select * into b from public.bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found.';
  end if;
  if b.status is distinct from 'law' then
    raise exception 'Bill is not enrolled as law.';
  end if;
  if not coalesce(b.is_federal_appropriations, false) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if b.linked_fiscal_year_id is null then
    raise exception 'Appropriations bill is not linked to a fiscal year.';
  end if;

  select * into y from public.rp_fiscal_years where id = b.linked_fiscal_year_id for update;
  if not found then
    raise exception 'Fiscal year not found.';
  end if;

  if y.appropriations_act_bill_id is not null and y.appropriations_act_bill_id is distinct from p_bill_id then
    raise exception 'This fiscal year already has an enrolled appropriations act.';
  end if;

  update public.rp_fiscal_years
  set appropriations_act_bill_id = p_bill_id
  where id = y.id;

  update public.federal_budgets
  set
    status = 'submitted',
    submitted_at = coalesce(submitted_at, now()),
    updated_at = now()
  where fiscal_year_id = y.id;

  return jsonb_build_object('ok', true, 'fiscal_year_id', y.id, 'bill_id', p_bill_id);
end;
$$;

grant execute on function public.fiscal_on_appropriations_enrolled(uuid) to authenticated;

-- ---------- YTD federal income tax estimate (salary collects only; mirrors close-year base) ----------
create or replace function public.fiscal_estimate_ytd_income_tax()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_started timestamptz;
  v_inflow numeric;
  v_brackets jsonb;
  v_tax numeric;
  v_fy_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select y.id, y.started_at into v_fy_id, v_started
  from public.rp_fiscal_years y
  where y.status = 'active'
  limit 1;

  if v_fy_id is null then
    return jsonb_build_object('fiscal_year_id', null, 'gross_inflows', 0, 'estimated_tax', 0, 'fy_started_at', null);
  end if;

  select coalesce(b.tax_brackets, '[]'::jsonb) into v_brackets
  from public.federal_budgets b
  where b.fiscal_year_id = v_fy_id
  limit 1;

  select coalesce(sum(l.delta), 0) into v_inflow
  from public.economy_ledger l
  where l.wallet_user_id = v_uid
    and l.kind = 'hourly_income'
    and l.delta > 0
    and l.created_at >= v_started;

  v_tax := public.fiscal_marginal_tax(v_inflow, v_brackets);

  return jsonb_build_object(
    'fiscal_year_id', v_fy_id,
    'fy_started_at', v_started,
    'gross_inflows', round(v_inflow, 2),
    'estimated_tax', round(v_tax, 2)
  );
end;
$$;

grant execute on function public.fiscal_estimate_ytd_income_tax() to authenticated;

-- ---------- Scale draft line-item minimums with server “GDP” (wallet sum / FY opening), capped ----------
create or replace function public.fiscal_apply_server_gdp_inflation_to_line_minima()
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
  v_wallet_sum numeric;
  v_ratio numeric := 1;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
  v_min numeric;
  v_alloc numeric;
  line_rec record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_president(v_uid) then
    raise exception 'Only the President may adjust draft line minima.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' for update;
  if not found then raise exception 'No active fiscal year.'; end if;

  select * into b from public.federal_budgets where fiscal_year_id = y.id for update;
  if not found then raise exception 'No federal budget row for the active year.'; end if;
  if b.status is distinct from 'draft' then
    raise exception 'Line minima may only be inflated on a draft budget.';
  end if;

  select coalesce(sum(balance), 0) into v_wallet_sum from public.economy_wallets;

  if coalesce(y.gdp_opening_total, 0) > 0 then
    v_ratio := v_wallet_sum / y.gdp_opening_total;
    v_ratio := greatest(1::numeric, least(v_ratio, 1.15));
  end if;

  v_items := coalesce(b.line_items, '[]'::jsonb);
  -- PL/pgSQL requires a record (or aliased scalar list) when iterating set-returning functions.
  for line_rec in select * from jsonb_array_elements(v_items) as arr(elem)
  loop
    v_min := round(
      greatest(0::numeric, coalesce((line_rec.elem->>'minimum')::numeric, 0)) * v_ratio,
      2
    );
    v_alloc := greatest(coalesce((line_rec.elem->>'allocated')::numeric, 0), v_min);
    v_out := v_out || jsonb_build_array(
      line_rec.elem || jsonb_build_object('minimum', v_min, 'allocated', v_alloc)
    );
  end loop;

  update public.federal_budgets
  set line_items = v_out, updated_at = now()
  where fiscal_year_id = y.id;

  return jsonb_build_object('ok', true, 'ratio_applied', round(v_ratio, 6), 'wallet_sum', v_wallet_sum);
end;
$$;

grant execute on function public.fiscal_apply_server_gdp_inflation_to_line_minima() to authenticated;

-- ---------- National metrics admin upsert + audit ----------
drop function if exists public.national_metrics_admin_upsert(uuid, jsonb);
drop function if exists public.national_metrics_admin_upsert(uuid, jsonb, text);

create or replace function public.national_metrics_admin_upsert(
  p_fiscal_year_id uuid,
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  old_row public.national_metrics%rowtype;
  new_row public.national_metrics%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_admin(v_uid) then
    raise exception 'Only admins may edit national metrics.';
  end if;

  if not exists (select 1 from public.rp_fiscal_years where id = p_fiscal_year_id) then
    raise exception 'Fiscal year not found.';
  end if;

  insert into public.national_metrics (fiscal_year_id, updated_by)
  values (p_fiscal_year_id, v_uid)
  on conflict (fiscal_year_id) do nothing;

  select * into old_row from public.national_metrics where fiscal_year_id = p_fiscal_year_id;

  update public.national_metrics
  set
    government_approval = coalesce((p_payload->>'government_approval')::numeric, government_approval),
    unemployment_rate = coalesce((p_payload->>'unemployment_rate')::numeric, unemployment_rate),
    per_capita_income = coalesce((p_payload->>'per_capita_income')::numeric, per_capita_income),
    us_debt = coalesce((p_payload->>'us_debt')::numeric, us_debt),
    education_academic_scores = coalesce((p_payload->>'education_academic_scores')::numeric, education_academic_scores),
    education_dropout_rate = coalesce((p_payload->>'education_dropout_rate')::numeric, education_dropout_rate),
    education_higher_ed_enrollment = coalesce((p_payload->>'education_higher_ed_enrollment')::numeric, education_higher_ed_enrollment),
    poverty_percentage = coalesce((p_payload->>'poverty_percentage')::numeric, poverty_percentage),
    poverty_effect = coalesce((p_payload->>'poverty_effect')::numeric, poverty_effect),
    homelessness = coalesce((p_payload->>'homelessness')::bigint, homelessness),
    healthcare_coverage = coalesce((p_payload->>'healthcare_coverage')::numeric, healthcare_coverage),
    life_expectancy = coalesce((p_payload->>'life_expectancy')::numeric, life_expectancy),
    crime_total = coalesce((p_payload->>'crime_total')::bigint, crime_total),
    crime_prisoners = coalesce((p_payload->>'crime_prisoners')::bigint, crime_prisoners),
    infrastructure_road_quality = coalesce((p_payload->>'infrastructure_road_quality')::numeric, infrastructure_road_quality),
    infrastructure_road_congestion = coalesce((p_payload->>'infrastructure_road_congestion')::numeric, infrastructure_road_congestion),
    updated_at = now(),
    updated_by = v_uid
  where fiscal_year_id = p_fiscal_year_id;

  select * into new_row from public.national_metrics where fiscal_year_id = p_fiscal_year_id;

  insert into public.national_metrics_change_log (
    fiscal_year_id,
    changed_by,
    reason,
    old_values,
    new_values
  ) values (
    p_fiscal_year_id,
    v_uid,
    p_reason,
    to_jsonb(old_row) - 'updated_at',
    to_jsonb(new_row) - 'updated_at'
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.national_metrics_admin_upsert(uuid, jsonb, text) to authenticated;

-- ---------- fiscal_close_year: set appropriations deadline on the new active FY ----------
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
  v_total_tax numeric := 0;
  v_total_spend numeric := 0;
  u record;
  v_inflow numeric;
  v_tax numeric;
  wbal numeric;
  new_bal numeric;
  v_new_year_id uuid;
  v_next_idx int;
  v_brackets jsonb;
  v_line_items jsonb;
  v_metrics jsonb;
  insolvent int := 0;
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
    if v_tax <= 0 then
      continue;
    end if;

    select coalesce(balance, 0) into wbal from public.economy_wallets where user_id = u.id;
    if wbal < v_tax then
      insolvent := insolvent + 1;
    end if;
  end loop;

  if insolvent > 0 then
    raise exception 'Cannot close year: % player(s) cannot cover their income tax (insufficient wallet balance). They must earn or receive funds before the year can close.', insolvent;
  end if;

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
    insert into public.fiscal_tax_settlements (fiscal_year_id, user_id, gross_inflows, tax_due)
    values (y.id, u.id, v_inflow, v_tax)
    on conflict (fiscal_year_id, user_id) do update
      set gross_inflows = excluded.gross_inflows, tax_due = excluded.tax_due;

    if v_tax > 0 then
      insert into public.economy_wallets (user_id) values (u.id) on conflict do nothing;
      select balance into wbal from public.economy_wallets where user_id = u.id for update;
      new_bal := wbal - v_tax;
      if new_bal < 0 then
        raise exception 'Balance inconsistency for user %', u.id;
      end if;
      update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = u.id;
      insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
      values (
        u.id,
        -v_tax,
        new_bal,
        'fiscal_income_tax',
        jsonb_build_object('fiscal_year_id', y.id, 'gross_inflows', v_inflow, 'tax', v_tax)
      );
      v_total_tax := v_total_tax + v_tax;
    end if;
  end loop;

  update public.federal_treasury
  set balance = balance + v_total_tax - v_total_spend
  where id = 1;

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
    appropriations_act_bill_id
  )
  values (
    v_next_idx,
    'FY ' || v_next_idx::text,
    'active',
    (select coalesce(sum(balance), 0) from public.economy_wallets),
    v_now + interval '1 day',
    null
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
      m.government_approval,
      m.unemployment_rate,
      m.per_capita_income,
      m.us_debt,
      m.education_academic_scores,
      m.education_dropout_rate,
      m.education_higher_ed_enrollment,
      m.poverty_percentage,
      m.poverty_effect,
      m.homelessness,
      m.healthcare_coverage,
      m.life_expectancy,
      m.crime_total,
      m.crime_prisoners,
      m.infrastructure_road_quality,
      m.infrastructure_road_congestion,
      v_uid
    from public.national_metrics m
    where m.fiscal_year_id = y.id;
  else
    insert into public.national_metrics (fiscal_year_id, updated_by)
    values (v_new_year_id, v_uid);
  end if;

  return jsonb_build_object(
    'ok', true,
    'closed_year_id', y.id,
    'total_tax_collected', v_total_tax,
    'total_spending', v_total_spend,
    'gdp_before_tax_snapshot', v_gdp_before,
    'new_fiscal_year_id', v_new_year_id,
    'economy_frozen_until_submit', true
  );
end;
$$;

notify pgrst, 'reload schema';
