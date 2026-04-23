-- Structured national simulator metrics (per fiscal year). Admins edit via RPC; Directory shows active year.

create table public.national_metrics (
  fiscal_year_id uuid primary key references public.rp_fiscal_years (id) on delete cascade,
  government_approval numeric(8, 4),
  unemployment_rate numeric(8, 4),
  per_capita_income numeric(20, 2),
  us_debt numeric(20, 2),
  education_academic_scores numeric(5, 2),
  education_dropout_rate numeric(8, 4),
  education_higher_ed_enrollment numeric(8, 4),
  poverty_percentage numeric(8, 4),
  poverty_effect numeric(8, 4),
  homelessness bigint,
  healthcare_coverage numeric(8, 4),
  life_expectancy numeric(8, 4),
  crime_total bigint,
  crime_prisoners bigint,
  infrastructure_road_quality numeric(8, 4),
  infrastructure_road_congestion numeric(8, 4),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.national_metrics enable row level security;

create policy "national_metrics read authed" on public.national_metrics
  for select using (auth.role() = 'authenticated');

-- Seed for FY 1 (same id as existing rp_fiscal_years year_index = 1)
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
  infrastructure_road_congestion
)
select
  y.id,
  null,
  12.3,
  56567,
  0,
  7.6,
  11.7,
  51.9,
  12.3,
  6.4,
  710199,
  87.6,
  80.16,
  42460370,
  1767742,
  70.4,
  41.9
from public.rp_fiscal_years y
where y.year_index = 1
  and not exists (select 1 from public.national_metrics n where n.fiscal_year_id = y.id);

create or replace function public._fiscal_is_admin(p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = 'admin'
    ),
    false
  );
$$;

-- Payload matches app: all optional numeric fields; null = leave unchanged on update (caller sends full row on edit).
create or replace function public.national_metrics_admin_upsert(p_fiscal_year_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.national_metrics_admin_upsert(uuid, jsonb) to authenticated;

-- Copy national metrics when closing a fiscal year (draft new year inherits prior snapshot).
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
  insert into public.rp_fiscal_years (year_index, label, status, gdp_opening_total)
  values (
    v_next_idx,
    'FY ' || v_next_idx::text,
    'active',
    (select coalesce(sum(balance), 0) from public.economy_wallets)
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
