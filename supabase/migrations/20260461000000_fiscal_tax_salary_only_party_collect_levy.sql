-- Federal income tax base: only scheduled salary + PAC hourly (`economy_ledger.kind = 'hourly_income'`).
-- Party chairs may set a levy (0–25%) on that same collect, credited to party treasury.

alter table public.party_organizations
  add column if not exists member_collect_levy_rate numeric not null default 0
    check (member_collect_levy_rate >= 0 and member_collect_levy_rate <= 0.25);

comment on column public.party_organizations.member_collect_levy_rate is
  'Fraction of each hourly_income collect withheld to the party treasury (chair sets; D/R only).';

create or replace function public.party_set_member_collect_levy_rate(p_party text, p_rate numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party is null or p_party not in ('democrat', 'republican') then
    raise exception 'Invalid party';
  end if;
  if not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party and po.office = 'chair' and po.user_id = v_uid
  ) then
    raise exception 'Only the party chair may set the member collect levy rate.';
  end if;

  r := greatest(0::numeric, least(round(coalesce(p_rate, 0), 4), 0.25));

  update public.party_organizations
  set member_collect_levy_rate = r, updated_at = now()
  where party_key = p_party;

  return jsonb_build_object('ok', true, 'member_collect_levy_rate', r);
end;
$$;

grant execute on function public.party_set_member_collect_levy_rate(text, numeric) to authenticated;

-- ---------- economy_collect_income: optional party levy on hourly collect ----------
create or replace function public.economy_collect_income(p_body jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w record;
  v_hours int;
  v_role_hourly numeric;
  v_pac_hourly numeric := 0;
  v_total_hourly numeric;
  v_gross numeric;
  v_keys text[];
  pac_lvl int;
  v_party text;
  v_levy_rate numeric;
  v_levy numeric := 0;
  po record;
  v_after_gross numeric;
  v_after_levy numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select * into w from public.economy_wallets where user_id = v_uid for update;
  select public._economy_effective_role_keys(v_uid) into v_keys;
  v_role_hourly := public._economy_hourly_from_roles(v_keys);

  select level into pac_lvl from public.economy_pacs where user_id = v_uid;
  if pac_lvl is not null then
    v_pac_hourly := public._economy_pac_hourly(pac_lvl);
  end if;

  v_total_hourly := v_role_hourly + v_pac_hourly;
  v_hours := floor(extract(epoch from (now() - w.last_collected_at)) / 3600)::int;
  v_hours := least(greatest(v_hours, 0), 24);

  if v_hours < 1 or v_total_hourly <= 0 then
    return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', 0, 'balance', w.balance);
  end if;

  v_gross := v_total_hourly * v_hours;

  select party into v_party from public.profiles where id = v_uid;
  if v_party in ('democrat', 'republican') then
    select * into po from public.party_organizations where party_key = v_party for update;
    v_levy_rate := coalesce(po.member_collect_levy_rate, 0);
    if v_levy_rate > 0 then
      v_levy := round(v_gross * least(v_levy_rate, 0.25), 2);
      if v_levy > v_gross then
        v_levy := v_gross;
      end if;
    end if;
  end if;

  v_after_gross := w.balance + v_gross;

  update public.economy_wallets
  set balance = v_after_gross,
      last_collected_at = now(),
      updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_gross,
    v_after_gross,
    'hourly_income',
    jsonb_build_object(
      'hours', v_hours,
      'role_hourly', v_role_hourly,
      'pac_hourly', v_pac_hourly,
      'role_keys', to_jsonb(v_keys)
    )
  );

  if v_levy > 0 then
    v_after_levy := v_after_gross - v_levy;
    update public.economy_wallets
    set balance = v_after_levy, updated_at = now()
    where user_id = v_uid;

    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (
      v_uid,
      -v_levy,
      v_after_levy,
      'party_collect_levy',
      jsonb_build_object('party', v_party, 'from_gross_collect', v_gross, 'levy', v_levy)
    );

    update public.party_organizations
    set treasury_balance = treasury_balance + v_levy, updated_at = now()
    where party_key = v_party;
  end if;

  return jsonb_build_object(
    'ok', true,
    'hours', v_hours,
    'paid', v_gross - v_levy,
    'party_levy', v_levy,
    'balance', case when v_levy > 0 then v_after_levy else v_after_gross end
  );
end;
$$;

-- ---------- fiscal_close_year: tax only hourly_income ----------
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
