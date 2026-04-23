-- Federal fiscal year, presidential budget, progressive income tax on wallet inflows, treasury.
-- Economy RPCs are frozen until the active year has a submitted budget.

-- ---------- Tables ----------
create table public.rp_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  year_index int not null unique,
  label text not null,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null check (status in ('active', 'closed')),
  gdp_opening_total numeric(20, 2),
  gdp_closing_total numeric(20, 2)
);

create table public.federal_budgets (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years (id) on delete cascade,
  status text not null check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  president_user_id uuid references public.profiles (id) on delete set null,
  tax_brackets jsonb not null default '[]'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id)
);

create table public.federal_treasury (
  id int primary key check (id = 1),
  balance numeric(20, 2) not null default 0
);

create table public.fiscal_tax_settlements (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  gross_inflows numeric(20, 2) not null,
  tax_due numeric(20, 2) not null,
  created_at timestamptz not null default now(),
  unique (fiscal_year_id, user_id)
);

create index fiscal_tax_settlements_year_idx on public.fiscal_tax_settlements (fiscal_year_id);

-- ---------- RLS (reads only; writes via SECURITY DEFINER RPCs) ----------
alter table public.rp_fiscal_years enable row level security;
alter table public.federal_budgets enable row level security;
alter table public.federal_treasury enable row level security;
alter table public.fiscal_tax_settlements enable row level security;

create policy "rp_fiscal_years read authed" on public.rp_fiscal_years
  for select using (auth.role() = 'authenticated');
create policy "federal_budgets read authed" on public.federal_budgets
  for select using (auth.role() = 'authenticated');
create policy "federal_treasury read authed" on public.federal_treasury
  for select using (auth.role() = 'authenticated');
create policy "fiscal_tax_settlements read authed" on public.fiscal_tax_settlements
  for select using (auth.role() = 'authenticated');

-- ---------- Helpers ----------
create or replace function public._fiscal_is_president(p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'president'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = 'president'
    ),
    false
  );
$$;

create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- Marginal income tax: brackets jsonb array of { "ceiling": number | null, "rate": number }
-- Bands apply to consecutive slices of income (standard US-style marginal).
create or replace function public.fiscal_marginal_tax(p_income numeric, p_brackets jsonb)
returns numeric
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  el jsonb;
  prev_top numeric := 0;
  top numeric;
  r numeric;
  slice numeric;
  total numeric := 0;
begin
  if p_income is null or p_income <= 0 then
    return 0;
  end if;
  for el in select * from jsonb_array_elements(coalesce(p_brackets, '[]'::jsonb))
  loop
    if el ? 'ceiling' and (el->>'ceiling' is null or el->>'ceiling' = 'null') then
      top := null;
    else
      top := (el->>'ceiling')::numeric;
    end if;
    r := coalesce((el->>'rate')::numeric, 0);
    if top is null then
      slice := greatest(0::numeric, p_income - prev_top);
      total := total + slice * r;
      exit;
    else
      slice := greatest(0::numeric, least(p_income, top) - prev_top);
      total := total + slice * r;
      prev_top := top;
      if p_income <= top then
        exit;
      end if;
    end if;
  end loop;
  return round(total, 2);
end;
$$;

-- ---------- Seed: FY1 + submitted placeholder budget (economy stays unfrozen) ----------
insert into public.federal_treasury (id, balance) values (1, 0)
on conflict (id) do nothing;

insert into public.rp_fiscal_years (year_index, label, status, gdp_opening_total)
values (
  1,
  'FY 1',
  'active',
  coalesce((select sum(balance) from public.economy_wallets), 0)
)
on conflict (year_index) do nothing;

insert into public.federal_budgets (
  fiscal_year_id,
  status,
  submitted_at,
  tax_brackets,
  line_items,
  metrics
)
select
  y.id,
  'submitted',
  now(),
  '[
    {"ceiling":20000,"rate":0},
    {"ceiling":50000,"rate":0.025},
    {"ceiling":100000,"rate":0.05},
    {"ceiling":200000,"rate":0.15},
    {"ceiling":null,"rate":0.405}
  ]'::jsonb,
  '[
    {"key":"infrastructure","label":"Infrastructure and Transportation","minimum":600000,"allocated":600000},
    {"key":"education","label":"Education","minimum":500000,"allocated":500000},
    {"key":"healthcare","label":"Healthcare","minimum":700000,"allocated":700000},
    {"key":"defense","label":"Defense and National Security","minimum":650000,"allocated":650000},
    {"key":"social_welfare","label":"Social Welfare Programs","minimum":450000,"allocated":450000},
    {"key":"environment","label":"Environmental Protection","minimum":200000,"allocated":200000},
    {"key":"economic_development","label":"Economic Development and Job Creation","minimum":600000,"allocated":600000},
    {"key":"science_tech","label":"Science and Technology Research","minimum":200000,"allocated":200000},
    {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","minimum":100000,"allocated":100000},
    {"key":"relief","label":"Relief Funds","minimum":100000,"allocated":100000}
  ]'::jsonb,
  '{}'::jsonb
from public.rp_fiscal_years y
where y.year_index = 1
  and not exists (select 1 from public.federal_budgets b where b.fiscal_year_id = y.id);

-- ---------- Presidential RPCs ----------
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
  b record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_president(v_uid) then
    raise exception 'Only the President may edit the federal budget.';
  end if;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;
  if y.status is distinct from 'active' then raise exception 'Only the active fiscal year can be edited.'; end if;

  select * into b from public.federal_budgets where fiscal_year_id = p_fiscal_year_id for update;
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

grant execute on function public.fiscal_save_budget_draft(uuid, jsonb, jsonb, jsonb) to authenticated;

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
  if not public._fiscal_is_president(v_uid) then
    raise exception 'Only the President may submit the federal budget.';
  end if;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;
  if y.status is distinct from 'active' then raise exception 'Only the active fiscal year can be submitted.'; end if;

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
  set status = 'submitted', submitted_at = now(), president_user_id = v_uid, updated_at = now()
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.fiscal_submit_budget(uuid) to authenticated;

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

  -- Dry-run: count insolvent taxpayers
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

  -- Collect taxes and record settlements
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

grant execute on function public.fiscal_close_year() to authenticated;

-- ---------- Patch economy RPCs (require submitted budget) ----------
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
  new_bal numeric;
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
  new_bal := w.balance + v_gross;

  update public.economy_wallets
  set balance = new_bal,
      last_collected_at = now(),
      updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_gross,
    new_bal,
    'hourly_income',
    jsonb_build_object(
      'hours', v_hours,
      'role_hourly', v_role_hourly,
      'pac_hourly', v_pac_hourly,
      'role_keys', to_jsonb(v_keys)
    )
  );

  return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', v_gross, 'balance', new_bal);
end;
$$;

create or replace function public.economy_transfer_to_user(p_to_user uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid := auth.uid();
  a numeric := round(p_amount, 2);
  b_from record;
  b_to record;
  new_from numeric;
  new_to numeric;
begin
  if v_from is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if p_to_user is null or p_to_user = v_from then raise exception 'Invalid recipient'; end if;
  if a is null or a <= 0 or a > 500000000 then raise exception 'Invalid amount'; end if;

  insert into public.economy_wallets (user_id) values (v_from) on conflict do nothing;
  insert into public.economy_wallets (user_id) values (p_to_user) on conflict do nothing;

  select * into b_from from public.economy_wallets where user_id = v_from for update;
  select * into b_to from public.economy_wallets where user_id = p_to_user for update;

  if b_from.balance < a then raise exception 'Insufficient balance'; end if;

  new_from := b_from.balance - a;
  new_to := b_to.balance + a;

  update public.economy_wallets set balance = new_from, updated_at = now() where user_id = v_from;
  update public.economy_wallets set balance = new_to, updated_at = now() where user_id = p_to_user;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_from, -a, new_from, 'transfer_out', jsonb_build_object('to', p_to_user));
  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (p_to_user, a, new_to, 'transfer_in', jsonb_build_object('from', v_from));

  return jsonb_build_object('ok', true, 'your_balance', new_from);
end;
$$;

create or replace function public.economy_party_deposit(p_party text, p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  prof_party text;
  w record;
  po record;
  new_u numeric;
  new_t numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if p_party is null or p_party not in ('democrat', 'republican') then
    raise exception 'Party treasuries are only for Democratic and Republican affiliates';
  end if;
  if a is null or a <= 0 or a > 500000000 then raise exception 'Invalid amount'; end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then
    raise exception 'You can only fund your own party treasury';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  select * into po from public.party_organizations where party_key = p_party for update;

  if w.balance < a then raise exception 'Insufficient balance'; end if;

  new_u := w.balance - a;
  new_t := po.treasury_balance + a;

  update public.economy_wallets set balance = new_u, updated_at = now() where user_id = v_uid;
  update public.party_organizations set treasury_balance = new_t, updated_at = now() where party_key = p_party;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -a, new_u, 'party_deposit', jsonb_build_object('party', p_party));

  return jsonb_build_object('ok', true, 'your_balance', new_u, 'party_treasury', new_t);
end;
$$;

create or replace function public.economy_buy_campaign_ads(p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  unit_price numeric := 50000;
  q int := greatest(1, least(coalesce(p_qty, 1), 99));
  total numeric := unit_price * q;
  w record;
  new_bal numeric;
  new_qty int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < total then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - total;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_inventory as i (user_id, sku, quantity)
  values (v_uid, 'campaign_ad', q)
  on conflict (user_id, sku) do update set quantity = i.quantity + excluded.quantity
  returning quantity into new_qty;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -total, new_bal, 'campaign_ad_buy', jsonb_build_object('qty', q, 'unit_price', unit_price));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'campaign_ads', new_qty);
end;
$$;

create or replace function public.economy_use_campaign_ad(p_election uuid, p_candidate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  inv int;
  cand record;
  new_pts numeric;
  new_bal numeric;
  w record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select quantity into inv from public.economy_inventory where user_id = v_uid and sku = 'campaign_ad';
  if coalesce(inv, 0) < 1 then raise exception 'No campaign ads in inventory'; end if;

  select ec.id, ec.user_id, ec.election_id, e.phase
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;

  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.user_id <> v_uid then raise exception 'Not your candidacy'; end if;
  if cand.phase not in ('filing', 'primary', 'general') then raise exception 'Election not active'; end if;

  new_pts := coalesce((select campaign_points_total from public.election_candidates where id = cand.id), 0) + 1;
  update public.election_candidates set campaign_points_total = new_pts where id = cand.id;

  update public.economy_inventory set quantity = quantity - 1 where user_id = v_uid and sku = 'campaign_ad';

  select * into w from public.economy_wallets where user_id = v_uid;
  new_bal := w.balance;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, 0, new_bal, 'campaign_ad_spend', jsonb_build_object('election_id', p_election, 'candidate_id', p_candidate, 'points_added', 1));

  return jsonb_build_object('ok', true, 'campaign_points_total', new_pts, 'ads_remaining', inv - 1);
end;
$$;

create or replace function public.economy_buy_pac()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  price numeric := 5000000;
  w record;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if exists (select 1 from public.economy_pacs where user_id = v_uid) then
    raise exception 'PAC already owned';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  insert into public.economy_pacs (user_id, level) values (v_uid, 1);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_purchase', jsonb_build_object('level', 1));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_level', 1);
end;
$$;

create or replace function public.economy_upgrade_pac()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cur int;
  price numeric;
  w record;
  new_bal numeric;
  new_lvl int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select level into cur from public.economy_pacs where user_id = v_uid for update;
  if cur is null then raise exception 'No PAC to upgrade'; end if;
  if cur >= 3 then raise exception 'PAC already max level'; end if;

  price := case when cur = 1 then 20000000::numeric else 50000000::numeric end;
  new_lvl := cur + 1;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.economy_pacs set level = new_lvl, updated_at = now() where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_upgrade', jsonb_build_object('from_level', cur, 'to_level', new_lvl));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_level', new_lvl);
end;
$$;

create or replace function public.economy_blackjack_start(p_bet numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  bet numeric := round(p_bet, 2);
  w record;
  v_shoe smallint[];
  c smallint;
  n int;
  ph smallint[] := array[]::smallint[];
  dh smallint[] := array[]::smallint[];
  p_nat boolean;
  d_nat boolean;
  new_bal numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._economy_require_active_budget();
  if bet is null or bet < 1000 or bet > 5000000 then
    raise exception 'Bet must be between 1,000 and 5,000,000';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < bet then
    raise exception 'Insufficient balance';
  end if;

  delete from public.economy_blackjack_sessions where user_id = v_uid;

  v_shoe := public._bj_shuffled_shoe();

  n := array_length(v_shoe, 1);
  c := v_shoe[1];
  v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
  ph := ph || c;

  n := array_length(v_shoe, 1);
  c := v_shoe[1];
  v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
  dh := dh || c;

  n := array_length(v_shoe, 1);
  c := v_shoe[1];
  v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
  ph := ph || c;

  n := array_length(v_shoe, 1);
  c := v_shoe[1];
  v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
  dh := dh || c;

  new_bal := w.balance - bet;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -bet, new_bal, 'gamble_blackjack', jsonb_build_object('phase', 'ante', 'bet', bet));

  p_nat := public._bj_is_natural(ph);
  d_nat := public._bj_is_natural(dh);

  if p_nat and d_nat then
    new_bal := new_bal + bet;
    update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, bet, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'push', 'reason', 'both_blackjack', 'player_hand', ph, 'dealer_hand', dh));
    return jsonb_build_object(
      'active', false,
      'outcome', 'push',
      'message', 'Both blackjack — push.',
      'player_hand', ph,
      'dealer_hand', dh,
      'player_value', 21,
      'dealer_value', 21,
      'balance', new_bal
    );
  end if;

  if p_nat and not d_nat then
    new_bal := new_bal + bet * 2.5;
    update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, bet * 1.5, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'blackjack', 'player_hand', ph, 'dealer_hand', dh));
    return jsonb_build_object(
      'active', false,
      'outcome', 'blackjack',
      'message', 'Blackjack! Paid 3:2.',
      'player_hand', ph,
      'dealer_hand', dh,
      'player_value', 21,
      'dealer_value', public._bj_hand_value(dh),
      'balance', new_bal
    );
  end if;

  if d_nat and not p_nat then
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, 0, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'lose', 'reason', 'dealer_blackjack', 'player_hand', ph, 'dealer_hand', dh));
    return jsonb_build_object(
      'active', false,
      'outcome', 'lose',
      'message', 'Dealer has blackjack.',
      'player_hand', ph,
      'dealer_hand', dh,
      'player_value', public._bj_hand_value(ph),
      'dealer_value', 21,
      'balance', new_bal
    );
  end if;

  insert into public.economy_blackjack_sessions (user_id, bet_amount, shoe, player_hand, dealer_hand)
  values (v_uid, bet, v_shoe, ph, dh);

  return jsonb_build_object(
    'active', true,
    'bet', bet,
    'player_hand', ph,
    'player_value', public._bj_hand_value(ph),
    'dealer_up', dh[1],
    'dealer_hole_hidden', true,
    'balance', new_bal
  );
end;
$$;

create or replace function public.economy_blackjack_action(p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s record;
  v_shoe smallint[];
  v_ph smallint[];
  v_dh smallint[];
  c smallint;
  n int;
  pv int;
  dv int;
  bet numeric;
  w record;
  new_bal numeric;
  act text := lower(trim(p_action));
  v_resolve_dealer boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._economy_require_active_budget();
  if act not in ('hit', 'stand') then
    raise exception 'Action must be hit or stand';
  end if;

  select * into s from public.economy_blackjack_sessions where user_id = v_uid for update;
  if not found then
    raise exception 'No active hand — start a new round.';
  end if;

  bet := s.bet_amount;
  v_shoe := s.shoe;
  v_ph := s.player_hand;
  v_dh := s.dealer_hand;

  if act = 'hit' then
    n := array_length(v_shoe, 1);
    if n is null or n < 1 then
      raise exception 'Shoe is empty';
    end if;
    c := v_shoe[1];
    v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
    v_ph := v_ph || c;
    pv := public._bj_hand_value(v_ph);

    if pv > 21 then
      select * into w from public.economy_wallets where user_id = v_uid for update;
      new_bal := w.balance;
      delete from public.economy_blackjack_sessions where user_id = v_uid;
      insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
      values (v_uid, 0, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'bust', 'player_hand', v_ph, 'dealer_hand', v_dh));
      return jsonb_build_object(
        'active', false,
        'outcome', 'lose',
        'message', 'Bust — you lose.',
        'player_hand', v_ph,
        'dealer_hand', v_dh,
        'player_value', pv,
        'dealer_value', public._bj_hand_value(v_dh),
        'balance', new_bal
      );
    end if;

    if pv < 21 then
      update public.economy_blackjack_sessions
      set shoe = v_shoe, player_hand = v_ph, updated_at = now()
      where user_id = v_uid;
      select balance into new_bal from public.economy_wallets where user_id = v_uid;
      return jsonb_build_object(
        'active', true,
        'bet', bet,
        'player_hand', v_ph,
        'player_value', pv,
        'dealer_up', v_dh[1],
        'dealer_hole_hidden', true,
        'balance', new_bal
      );
    end if;

    v_resolve_dealer := true;
  elsif act = 'stand' then
    v_resolve_dealer := true;
  end if;

  if not v_resolve_dealer then
    raise exception 'Unreachable';
  end if;

  loop
    dv := public._bj_hand_value(v_dh);
    exit when dv >= 17;
    n := array_length(v_shoe, 1);
    if n is null or n < 1 then
      raise exception 'Shoe is empty';
    end if;
    c := v_shoe[1];
    v_shoe := case when n = 1 then array[]::smallint[] else v_shoe[2:n] end;
    v_dh := v_dh || c;
  end loop;

  pv := public._bj_hand_value(v_ph);
  dv := public._bj_hand_value(v_dh);

  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance;

  if dv > 21 or pv > dv then
    new_bal := new_bal + bet * 2;
    update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, bet * 2, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'win', 'player_hand', v_ph, 'dealer_hand', v_dh));
    delete from public.economy_blackjack_sessions where user_id = v_uid;
    return jsonb_build_object(
      'active', false,
      'outcome', 'win',
      'message', case when dv > 21 then 'Dealer busts — you win.' else 'You beat the dealer.' end,
      'player_hand', v_ph,
      'dealer_hand', v_dh,
      'player_value', pv,
      'dealer_value', dv,
      'balance', new_bal
    );
  elsif pv = dv then
    new_bal := new_bal + bet;
    update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, bet, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'push', 'player_hand', v_ph, 'dealer_hand', v_dh));
    delete from public.economy_blackjack_sessions where user_id = v_uid;
    return jsonb_build_object(
      'active', false,
      'outcome', 'push',
      'message', 'Push.',
      'player_hand', v_ph,
      'dealer_hand', v_dh,
      'player_value', pv,
      'dealer_value', dv,
      'balance', new_bal
    );
  else
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, 0, new_bal, 'gamble_blackjack', jsonb_build_object('outcome', 'lose', 'player_hand', v_ph, 'dealer_hand', v_dh));
    delete from public.economy_blackjack_sessions where user_id = v_uid;
    return jsonb_build_object(
      'active', false,
      'outcome', 'lose',
      'message', 'Dealer wins.',
      'player_hand', v_ph,
      'dealer_hand', v_dh,
      'player_value', pv,
      'dealer_value', dv,
      'balance', new_bal
    );
  end if;
end;
$$;

create or replace function public.party_deposit_treasury_to_election(p_party text, p_election_id uuid, p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  prof_party text;
  pts int;
  n int;
  po record;
  ephase text;
  total_pts int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if a is null or a < 50000 or a > 500000000 then raise exception 'Amount must be at least $50,000 (one campaign point) and at most $500,000,000'; end if;

  if not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party
      and po.office in ('chair', 'treasurer')
      and po.user_id = v_uid
  ) then
    raise exception 'Only the party chair or treasurer may direct treasury funds to a race';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select phase into ephase from public.elections where id = p_election_id;
  if ephase is null then raise exception 'Election not found'; end if;
  if ephase = 'closed' then raise exception 'That election is already closed'; end if;

  select count(*)::int into n
  from public.election_candidates ec
  where ec.election_id = p_election_id and ec.party::text = p_party;
  if n < 1 then raise exception 'No candidates from your party are filed in that election'; end if;

  pts := floor(a / 50000)::int;
  if pts < 1 then raise exception 'Amount too small to convert to campaign points'; end if;

  select * into po from public.party_organizations where party_key = p_party for update;
  if po.treasury_balance < a then raise exception 'Insufficient party treasury balance'; end if;

  update public.party_organizations
  set treasury_balance = treasury_balance - a, updated_at = now()
  where party_key = p_party;

  with cands as (
    select
      ec.id,
      row_number() over (order by ec.id) as rn,
      count(*) over ()::int as ncnt
    from public.election_candidates ec
    where ec.election_id = p_election_id and ec.party::text = p_party
  ),
  calc as (
    select
      cands.id,
      (pts / ncnt) + case when rn <= (pts % ncnt) then 1 else 0 end as add_pts
    from cands
  )
  update public.election_candidates ec
  set campaign_points_total = coalesce(ec.campaign_points_total, 0) + calc.add_pts
  from calc
  where ec.id = calc.id;

  total_pts := pts;

  insert into public.party_treasury_election_grants (party_key, election_id, amount, campaign_points_added, created_by)
  values (p_party, p_election_id, a, total_pts, v_uid);

  return jsonb_build_object(
    'ok', true,
    'amount', a,
    'campaign_points_added', total_pts,
    'treasury_after', (select treasury_balance from public.party_organizations where party_key = p_party)
  );
end;
$$;

create or replace function public.party_transfer_treasury_to_member(p_party text, p_recipient uuid, p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  prof_party text;
  recv_party text;
  po record;
  w_to record;
  new_to numeric;
  new_treasury numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if p_recipient is null then raise exception 'Invalid recipient'; end if;
  if a is null or a <= 0 or a > 500000000 then raise exception 'Invalid amount'; end if;

  if not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party
      and po.office in ('chair', 'treasurer')
      and po.user_id = v_uid
  ) then
    raise exception 'Only the party chair or treasurer may send treasury funds to a member';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select party into recv_party from public.profiles where id = p_recipient;
  if recv_party is distinct from p_party then raise exception 'Recipient must be a member of this party'; end if;

  insert into public.economy_wallets (user_id) values (p_recipient) on conflict do nothing;
  select * into w_to from public.economy_wallets where user_id = p_recipient for update;
  select * into po from public.party_organizations where party_key = p_party for update;

  if po.treasury_balance < a then raise exception 'Insufficient party treasury balance'; end if;

  new_to := w_to.balance + a;
  new_treasury := po.treasury_balance - a;

  update public.party_organizations
  set treasury_balance = new_treasury, updated_at = now()
  where party_key = p_party;

  update public.economy_wallets
  set balance = new_to, updated_at = now()
  where user_id = p_recipient;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    p_recipient,
    a,
    new_to,
    'party_treasury_in',
    jsonb_build_object('party', p_party, 'from_officer', v_uid)
  );

  return jsonb_build_object(
    'ok', true,
    'amount', a,
    'treasury_after', new_treasury,
    'recipient_balance', new_to
  );
end;
$$;

notify pgrst, 'reload schema';
