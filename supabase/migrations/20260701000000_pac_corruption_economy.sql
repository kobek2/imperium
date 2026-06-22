-- PAC corruption economy: businesses with treasuries, legal/illegal political spending,
-- industry holdings, bill conflict-of-interest, and investigations.

-- ---------- Industry sectors (stock market foundation) ----------
create table if not exists public.industry_sectors (
  key text primary key,
  label text not null,
  base_price numeric(20, 4) not null default 100 check (base_price > 0),
  current_price numeric(20, 4) not null default 100 check (current_price > 0),
  updated_at timestamptz not null default now()
);

insert into public.industry_sectors (key, label, base_price, current_price) values
  ('defense', 'Defense & Aerospace', 120, 120),
  ('energy', 'Energy & Utilities', 95, 95),
  ('healthcare', 'Healthcare & Pharma', 110, 110),
  ('finance', 'Finance & Banking', 105, 105),
  ('tech', 'Technology & Telecom', 130, 130)
on conflict (key) do nothing;

alter table public.industry_sectors enable row level security;
drop policy if exists "industry_sectors read authed" on public.industry_sectors;
create policy "industry_sectors read authed" on public.industry_sectors
  for select to authenticated using (true);

-- ---------- PAC organizations (replaces economy_pacs table) ----------
create table if not exists public.pac_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  tier smallint not null default 1 check (tier between 1 and 3),
  treasury_balance numeric(20, 2) not null default 0 check (treasury_balance >= 0),
  revenue_hourly numeric(20, 2) not null default 0 check (revenue_hourly >= 0),
  exposure_risk numeric(6, 2) not null default 0 check (exposure_risk >= 0 and exposure_risk <= 100),
  last_investigation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pac_organizations_owner_idx on public.pac_organizations (owner_user_id);

-- Migrate legacy passive-income PAC rows (only while economy_pacs still exists)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'economy_pacs'
  ) then
    insert into public.pac_organizations (
      owner_user_id,
      name,
      tier,
      treasury_balance,
      revenue_hourly,
      created_at,
      updated_at
    )
    select
      e.user_id,
      'PAC ' || upper(left(replace(e.user_id::text, '-', ''), 8)),
      e.level,
      (e.level * 1000000)::numeric,
      public._economy_pac_hourly(e.level),
      e.created_at,
      e.updated_at
    from public.economy_pacs e
    on conflict (owner_user_id) do nothing;

    drop policy if exists "economy_pacs select own or staff audit" on public.economy_pacs;
    drop policy if exists "economy_pacs read own" on public.economy_pacs;
    drop table public.economy_pacs;
  end if;
end $$;

alter table public.pac_organizations enable row level security;

drop policy if exists "pac_organizations select own or staff audit" on public.pac_organizations;
create policy "pac_organizations select own or staff audit"
  on public.pac_organizations
  for select
  to authenticated
  using (
    auth.uid() = owner_user_id
    or public.is_staff_economy_auditor(auth.uid())
  );

-- Public holdings (who owns what industry stake — traceable conflicts)
create table if not exists public.pac_holdings (
  pac_id uuid not null references public.pac_organizations (id) on delete cascade,
  industry_key text not null references public.industry_sectors (key) on delete restrict,
  shares numeric(20, 4) not null default 0 check (shares >= 0),
  avg_cost numeric(20, 4) not null default 0 check (avg_cost >= 0),
  primary key (pac_id, industry_key)
);

alter table public.pac_holdings enable row level security;
drop policy if exists "pac_holdings read authed" on public.pac_holdings;
create policy "pac_holdings read authed" on public.pac_holdings
  for select to authenticated using (true);

-- Public FEC-style disclosures (legal spending only)
create table if not exists public.pac_contributions (
  id uuid primary key default gen_random_uuid(),
  pac_id uuid not null references public.pac_organizations (id) on delete cascade,
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  amount numeric(20, 2) not null check (amount > 0),
  campaign_points numeric not null default 0 check (campaign_points >= 0),
  disclosed_at timestamptz not null default now(),
  cycle_key text not null
);

create index if not exists pac_contributions_election_idx on public.pac_contributions (election_id, disclosed_at desc);
create index if not exists pac_contributions_candidate_idx on public.pac_contributions (candidate_id, disclosed_at desc);
create index if not exists pac_contributions_pac_cycle_idx on public.pac_contributions (pac_id, cycle_key);

alter table public.pac_contributions enable row level security;
drop policy if exists "pac_contributions read authed" on public.pac_contributions;
create policy "pac_contributions read authed" on public.pac_contributions
  for select to authenticated using (true);

-- Hidden corruption ledger (owner-only)
create table if not exists public.pac_corruption_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  pac_id uuid not null references public.pac_organizations (id) on delete cascade,
  kind text not null check (kind in (
    'illegal_coordination',
    'dark_transfer',
    'source_concealment',
    'conflict_vote',
    'exceed_cap'
  )),
  severity smallint not null check (severity between 1 and 5),
  exposure_risk numeric(6, 2) not null default 0 check (exposure_risk >= 0),
  election_id uuid references public.elections (id) on delete set null,
  candidate_id uuid references public.election_candidates (id) on delete set null,
  bill_id uuid references public.bills (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  exposed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pac_corruption_ledger_owner_idx on public.pac_corruption_ledger (owner_user_id, created_at desc);
create index if not exists pac_corruption_ledger_pac_idx on public.pac_corruption_ledger (pac_id, created_at desc);

alter table public.pac_corruption_ledger enable row level security;
drop policy if exists "pac_corruption_ledger read own" on public.pac_corruption_ledger;
create policy "pac_corruption_ledger read own" on public.pac_corruption_ledger
  for select to authenticated using (auth.uid() = owner_user_id);

-- Public exposure feed when investigations succeed
create table if not exists public.corruption_exposures (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  investigator_user_id uuid not null references public.profiles (id) on delete cascade,
  ledger_entry_id uuid references public.pac_corruption_ledger (id) on delete set null,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists corruption_exposures_target_idx on public.corruption_exposures (target_user_id, created_at desc);

alter table public.corruption_exposures enable row level security;
drop policy if exists "corruption_exposures read authed" on public.corruption_exposures;
create policy "corruption_exposures read authed" on public.corruption_exposures
  for select to authenticated using (true);

-- ---------- Tier helpers ----------
create or replace function public._pac_tier_revenue_hourly(p_tier int)
returns numeric
language sql
immutable
as $$
  select public._economy_pac_hourly(p_tier);
$$;

create or replace function public._pac_tier_legal_cap(p_tier int)
returns numeric
language sql
immutable
as $$
  select case p_tier
    when 1 then 500000::numeric
    when 2 then 2000000::numeric
    when 3 then 5000000::numeric
    else 0::numeric
  end;
$$;

create or replace function public._pac_tier_treasury_cap(p_tier int)
returns numeric
language sql
immutable
as $$
  select case p_tier
    when 1 then 10000000::numeric
    when 2 then 50000000::numeric
    when 3 then 200000000::numeric
    else 0::numeric
  end;
$$;

create or replace function public._pac_tier_upgrade_cost(p_from int)
returns numeric
language sql
immutable
as $$
  select case p_from
    when 1 then 20000000::numeric
    when 2 then 50000000::numeric
    else null::numeric
  end;
$$;

create or replace function public._pac_contribution_points(p_amount numeric)
returns numeric
language sql
immutable
as $$
  select floor(greatest(p_amount, 0) / 100000)::numeric;
$$;

create or replace function public._pac_disclosed_total(
  p_pac_id uuid,
  p_candidate_id uuid,
  p_cycle_key text
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.pac_contributions
  where pac_id = p_pac_id
    and candidate_id = p_candidate_id
    and cycle_key = p_cycle_key;
$$;

create or replace function public._pac_cycle_key(p_election_id uuid)
returns text
language sql
immutable
as $$
  select p_election_id::text;
$$;

create or replace function public._pac_illegal_multiplier(p_kind text)
returns numeric
language sql
immutable
as $$
  select case p_kind
    when 'strategy' then 2.0::numeric
    when 'exceed_cap' then 2.5::numeric
    when 'conceal_source' then 2.5::numeric
    else 2.0::numeric
  end;
$$;

create or replace function public._pac_illegal_risk_base(p_kind text)
returns numeric
language sql
immutable
as $$
  select case p_kind
    when 'strategy' then 8::numeric
    when 'exceed_cap' then 12::numeric
    when 'conceal_source' then 15::numeric
    else 8::numeric
  end;
$$;

create or replace function public._pac_map_policy_to_industry(p_policy_tags jsonb)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_policy_tags ->> 'issue_key', ''))
    when 'defense' then 'defense'
    when 'military' then 'defense'
    when 'healthcare' then 'healthcare'
    when 'health' then 'healthcare'
    when 'energy' then 'energy'
    when 'environment' then 'energy'
    when 'finance' then 'finance'
    when 'tax' then 'finance'
    when 'economy' then 'finance'
    when 'technology' then 'tech'
    when 'science' then 'tech'
    else null
  end;
$$;

-- Campaign points from legal PAC contributions
create or replace function public._pac_contribution_points_delta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.campaign_points, 0) > 0 then
    update public.election_candidates
    set campaign_points_total = greatest(0, campaign_points_total + new.campaign_points)
    where id = new.candidate_id;
  elsif tg_op = 'DELETE' and coalesce(old.campaign_points, 0) > 0 then
    update public.election_candidates
    set campaign_points_total = greatest(0, campaign_points_total - old.campaign_points)
    where id = old.candidate_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists pac_contributions_points_sync on public.pac_contributions;
create trigger pac_contributions_points_sync
after insert or delete on public.pac_contributions
for each row execute function public._pac_contribution_points_delta();

-- ---------- Bill vote conflict-of-interest ----------
create or replace function public._bill_vote_conflict_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_industry text;
  v_pac record;
  v_holding numeric;
  v_stance int;
  v_vote_dir int;
  v_severity int;
  v_risk numeric;
  v_tags jsonb;
begin
  if new.vote not in ('yea', 'nay') then
    return new;
  end if;

  select b.policy_tags into v_tags from public.bills b where b.id = new.bill_id;
  v_industry := public._pac_map_policy_to_industry(v_tags);
  if v_industry is null then
    return new;
  end if;

  v_stance := coalesce((v_tags ->> 'policy_value')::int, 0);
  v_vote_dir := case when new.vote = 'yea' then 1 else -1 end;

  for v_pac in
    select po.id, po.owner_user_id, ph.shares, po.treasury_balance
    from public.pac_organizations po
    join public.pac_holdings ph on ph.pac_id = po.id and ph.industry_key = v_industry
    where po.owner_user_id = new.voter_id
      and ph.shares >= 5
  loop
    v_holding := v_pac.shares;
    v_severity := least(5, greatest(1, ceil(v_holding / 20)::int));
    v_risk := round(10 + (v_holding * 0.5) + abs(v_stance * v_vote_dir) * 3, 2);

    insert into public.pac_corruption_ledger (
      owner_user_id, pac_id, kind, severity, exposure_risk, bill_id, detail
    ) values (
      new.voter_id,
      v_pac.id,
      'conflict_vote',
      v_severity,
      v_risk,
      new.bill_id,
      jsonb_build_object(
        'industry', v_industry,
        'shares', v_holding,
        'vote', new.vote,
        'policy_value', v_stance
      )
    );

    update public.pac_organizations
    set exposure_risk = least(100, exposure_risk + v_risk),
        updated_at = now()
    where id = v_pac.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists bill_votes_conflict_check on public.bill_votes;
create trigger bill_votes_conflict_check
after insert on public.bill_votes
for each row execute function public._bill_vote_conflict_check();

-- ---------- Collect income: salary → wallet, PAC revenue → PAC treasury ----------
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
  v_salary_collect numeric;
  v_keys text[];
  pac_row record;
  v_party text;
  v_levy_rate numeric := 0;
  v_levy numeric := 0;
  v_after_gross numeric;
  v_after_levy numeric;
  v_pac_deposit numeric := 0;
  v_treasury_cap numeric := 0;
  v_wallet_gross numeric;
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

  select po.id, po.tier, po.treasury_balance, po.revenue_hourly
  into pac_row
  from public.pac_organizations po
  where po.owner_user_id = v_uid;

  if pac_row.id is not null then
    v_pac_hourly := coalesce(pac_row.revenue_hourly, public._pac_tier_revenue_hourly(pac_row.tier));
  end if;

  v_total_hourly := v_role_hourly + v_pac_hourly;
  v_hours := floor(extract(epoch from (now() - w.last_collected_at)) / 3600)::int;
  v_hours := least(greatest(v_hours, 0), 24);

  if v_hours < 1 or v_total_hourly <= 0 then
    return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', 0, 'balance', w.balance);
  end if;

  v_gross := v_total_hourly * v_hours;
  v_salary_collect := greatest(0::numeric, v_role_hourly * v_hours);
  v_wallet_gross := v_salary_collect;

  if pac_row.id is not null and v_pac_hourly > 0 then
    v_treasury_cap := public._pac_tier_treasury_cap(pac_row.tier);
    v_pac_deposit := least(
      v_pac_hourly * v_hours,
      greatest(0::numeric, v_treasury_cap - pac_row.treasury_balance)
    );
    if v_pac_deposit > 0 then
      update public.pac_organizations
      set treasury_balance = treasury_balance + v_pac_deposit,
          updated_at = now()
      where id = pac_row.id;
    end if;
  end if;

  select party into v_party from public.profiles where id = v_uid;
  if v_party in ('democrat', 'republican') then
    insert into public.party_organizations (party_key) values (v_party)
    on conflict (party_key) do nothing;
    begin
      select member_collect_levy_rate into strict v_levy_rate
      from public.party_organizations
      where party_key = v_party
      for update;
    exception
      when no_data_found then
        raise exception 'Party treasury row missing for party % (after upsert).', v_party;
    end;
    v_levy_rate := coalesce(v_levy_rate, 0);
    if v_levy_rate > 0 and v_salary_collect > 0 then
      v_levy := round(v_salary_collect * least(v_levy_rate, 0.25), 2);
      if v_levy > v_salary_collect then
        v_levy := v_salary_collect;
      end if;
    end if;
  end if;

  v_after_gross := w.balance + v_wallet_gross;

  update public.economy_wallets
  set balance = v_after_gross,
      last_collected_at = now(),
      updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_wallet_gross,
    v_after_gross,
    'hourly_income',
    jsonb_build_object(
      'hours', v_hours,
      'role_hourly', v_role_hourly,
      'pac_hourly', v_pac_hourly,
      'role_keys', to_jsonb(v_keys),
      'pac_treasury_deposit', v_pac_deposit
    )
  );

  if v_pac_deposit > 0 then
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (
      v_uid,
      0,
      v_after_gross,
      'pac_revenue',
      jsonb_build_object(
        'pac_id', pac_row.id,
        'hours', v_hours,
        'amount', v_pac_deposit
      )
    );
  end if;

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
      jsonb_build_object(
        'party', v_party,
        'from_gross_collect', v_wallet_gross,
        'party_levy_salary_base', v_salary_collect,
        'levy', v_levy
      )
    );

    update public.party_organizations
    set treasury_balance = treasury_balance + v_levy, updated_at = now()
    where party_key = v_party;
  end if;

  return jsonb_build_object(
    'ok', true,
    'hours', v_hours,
    'paid', v_wallet_gross - v_levy,
    'gross_collect', v_wallet_gross,
    'role_hourly', v_role_hourly,
    'pac_hourly', v_pac_hourly,
    'pac_treasury_deposit', v_pac_deposit,
    'party_levy', v_levy,
    'party_levy_salary_base', v_salary_collect,
    'balance', case when v_levy > 0 then v_after_levy else v_after_gross end
  );
end;
$$;

-- ---------- Register PAC ----------
drop function if exists public.economy_buy_pac();

create or replace function public.economy_buy_pac(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  price numeric := 5000000;
  v_name text := trim(coalesce(p_name, ''));
  w record;
  new_bal numeric;
  pac_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  if v_name = '' or char_length(v_name) < 3 then
    raise exception 'PAC name must be at least 3 characters';
  end if;

  if exists (select 1 from public.pac_organizations where owner_user_id = v_uid) then
    raise exception 'PAC already registered';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.pac_organizations (
    owner_user_id, name, tier, treasury_balance, revenue_hourly
  ) values (
    v_uid, v_name, 1, 1000000, public._pac_tier_revenue_hourly(1)
  ) returning id into pac_id;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_purchase', jsonb_build_object('tier', 1, 'pac_id', pac_id, 'name', v_name));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_tier', 1, 'pac_id', pac_id);
end;
$$;

grant execute on function public.economy_buy_pac(text) to authenticated;

-- ---------- Upgrade PAC tier ----------
create or replace function public.economy_upgrade_pac()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  pac_row record;
  price numeric;
  w record;
  new_bal numeric;
  new_tier int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'No PAC to upgrade'; end if;
  if pac_row.tier >= 3 then raise exception 'PAC already max tier'; end if;

  price := public._pac_tier_upgrade_cost(pac_row.tier);
  if price is null then raise exception 'PAC cannot be upgraded further'; end if;
  new_tier := pac_row.tier + 1;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  update public.pac_organizations
  set tier = new_tier,
      revenue_hourly = public._pac_tier_revenue_hourly(new_tier),
      updated_at = now()
  where id = pac_row.id;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, -price, new_bal, 'pac_upgrade',
    jsonb_build_object('from_tier', pac_row.tier, 'to_tier', new_tier, 'pac_id', pac_row.id)
  );

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_tier', new_tier);
end;
$$;

-- ---------- Fund PAC treasury from personal wallet ----------
create or replace function public.pac_deposit_from_wallet(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  pac_row record;
  w record;
  cap numeric;
  new_bal numeric;
  new_treasury numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if a is null or a <= 0 or a > 500000000 then raise exception 'Invalid amount'; end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'Register a PAC first'; end if;

  cap := public._pac_tier_treasury_cap(pac_row.tier);
  if pac_row.treasury_balance + a > cap then
    raise exception 'PAC treasury cap is % (tier %). Current: %', cap, pac_row.tier, pac_row.treasury_balance;
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < a then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - a;
  new_treasury := pac_row.treasury_balance + a;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.pac_organizations set treasury_balance = new_treasury, updated_at = now() where id = pac_row.id;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -a, new_bal, 'pac_treasury_deposit', jsonb_build_object('pac_id', pac_row.id, 'amount', a));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_treasury', new_treasury);
end;
$$;

grant execute on function public.pac_deposit_from_wallet(numeric) to authenticated;

-- ---------- Legal PAC contribution ----------
create or replace function public.pac_contribute_legal(
  p_election uuid,
  p_candidate uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  pac_row record;
  cand record;
  cycle_key text;
  disclosed numeric;
  cap numeric;
  pts numeric;
  new_treasury numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if a is null or a < 100000 then raise exception 'Minimum legal contribution is $100,000'; end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'Register a PAC first'; end if;
  if pac_row.treasury_balance < a then raise exception 'Insufficient PAC treasury'; end if;

  select ec.id, ec.user_id, ec.election_id, e.phase, e.general_closes_at
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;

  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'PAC contributions only during general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then
    raise exception 'General election is closed';
  end if;
  if cand.user_id = v_uid then
    raise exception 'Use campaign ads for your own candidacy — PAC spending is for other candidates';
  end if;

  cycle_key := public._pac_cycle_key(p_election);
  cap := public._pac_tier_legal_cap(pac_row.tier);
  disclosed := public._pac_disclosed_total(pac_row.id, p_candidate, cycle_key);

  if disclosed + a > cap then
    raise exception 'Legal cap for this candidate is % (disclosed so far: %). Use illegal coordination to exceed.', cap, disclosed;
  end if;

  pts := public._pac_contribution_points(a);
  if pts < 1 then raise exception 'Contribution too small for campaign points'; end if;

  new_treasury := pac_row.treasury_balance - a;
  update public.pac_organizations set treasury_balance = new_treasury, updated_at = now() where id = pac_row.id;

  insert into public.pac_contributions (
    pac_id, election_id, candidate_id, amount, campaign_points, cycle_key
  ) values (
    pac_row.id, p_election, p_candidate, a, pts, cycle_key
  );

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, 0, (select balance from public.economy_wallets where user_id = v_uid),
    'pac_contribution_disclosed',
    jsonb_build_object(
      'pac_id', pac_row.id,
      'election_id', p_election,
      'candidate_id', p_candidate,
      'amount', a,
      'campaign_points', pts
    )
  );

  return jsonb_build_object(
    'ok', true,
    'campaign_points', pts,
    'pac_treasury', new_treasury,
    'disclosed_total', disclosed + a
  );
end;
$$;

grant execute on function public.pac_contribute_legal(uuid, uuid, numeric) to authenticated;

-- ---------- Illegal PAC coordination ----------
create or replace function public.pac_contribute_illegal(
  p_election uuid,
  p_candidate uuid,
  p_amount numeric,
  p_coordination_type text default 'strategy'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  kind text := lower(trim(coalesce(p_coordination_type, 'strategy')));
  pac_row record;
  cand record;
  cycle_key text;
  cap numeric;
  disclosed numeric;
  remaining_cap numeric;
  report_amount numeric := 0;
  hidden_amount numeric;
  pts numeric;
  hidden_pts numeric;
  mult numeric;
  risk_base numeric;
  risk_bump numeric;
  severity int;
  new_treasury numeric;
  new_exposure numeric;
  ledger_kind text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if a is null or a < 100000 then raise exception 'Minimum contribution is $100,000'; end if;
  if kind not in ('strategy', 'exceed_cap', 'conceal_source') then
    raise exception 'Invalid coordination type';
  end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'Register a PAC first'; end if;
  if pac_row.treasury_balance < a then raise exception 'Insufficient PAC treasury'; end if;

  select ec.id, ec.user_id, ec.election_id, e.phase, e.general_closes_at
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;

  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'PAC contributions only during general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then
    raise exception 'General election is closed';
  end if;
  if cand.user_id = v_uid then
    raise exception 'Use campaign ads for your own candidacy';
  end if;

  cycle_key := public._pac_cycle_key(p_election);
  cap := public._pac_tier_legal_cap(pac_row.tier);
  disclosed := public._pac_disclosed_total(pac_row.id, p_candidate, cycle_key);
  remaining_cap := greatest(0::numeric, cap - disclosed);

  mult := public._pac_illegal_multiplier(kind);
  risk_base := public._pac_illegal_risk_base(kind);
  risk_bump := round(risk_base * (a / 100000), 2);
  severity := least(5, greatest(1, ceil(a / 500000)::int));

  if kind = 'strategy' then
    hidden_amount := a;
    report_amount := 0;
    hidden_pts := floor(public._pac_contribution_points(a) * mult);
    ledger_kind := 'illegal_coordination';
  elsif kind = 'exceed_cap' then
    report_amount := least(a, remaining_cap);
    hidden_amount := a - report_amount;
    if hidden_amount <= 0 then
      raise exception 'Legal cap not exceeded — use legal contribution instead';
    end if;
    hidden_pts := floor(public._pac_contribution_points(hidden_amount) * mult);
    if report_amount > 0 then
      pts := public._pac_contribution_points(report_amount);
    else
      pts := 0;
    end if;
    ledger_kind := 'exceed_cap';
  else
    -- conceal_source: public disclosure at legal rate + bonus points via hidden ledger
    report_amount := a;
    pts := public._pac_contribution_points(a);
    hidden_pts := greatest(0, floor(pts * mult) - pts);
    ledger_kind := 'source_concealment';
  end if;

  new_treasury := pac_row.treasury_balance - a;
  update public.pac_organizations
  set treasury_balance = new_treasury,
      exposure_risk = least(100, exposure_risk + risk_bump),
      updated_at = now()
  where id = pac_row.id;

  if report_amount > 0 and kind <> 'strategy' then
    insert into public.pac_contributions (
      pac_id, election_id, candidate_id, amount, campaign_points, cycle_key
    ) values (
      pac_row.id, p_election, p_candidate, report_amount,
      case when kind = 'conceal_source' then pts else public._pac_contribution_points(report_amount) end,
      cycle_key
    );
  end if;

  if hidden_pts > 0 then
    update public.election_candidates
    set campaign_points_total = greatest(0, campaign_points_total + hidden_pts)
    where id = p_candidate;
  end if;

  insert into public.pac_corruption_ledger (
    owner_user_id, pac_id, kind, severity, exposure_risk,
    election_id, candidate_id, detail
  ) values (
    v_uid, pac_row.id, ledger_kind, severity, risk_bump,
    p_election, p_candidate,
    jsonb_build_object(
      'coordination_type', kind,
      'true_amount', a,
      'reported_amount', report_amount,
      'hidden_amount', case when kind = 'strategy' then a else greatest(0, a - report_amount) end,
      'campaign_points_added', hidden_pts + coalesce(pts, 0),
      'legal_points', coalesce(pts, 0),
      'illegal_points', hidden_pts
    )
  );

  new_exposure := least(100, pac_row.exposure_risk + risk_bump);

  return jsonb_build_object(
    'ok', true,
    'campaign_points', hidden_pts + coalesce(pts, 0),
    'pac_treasury', new_treasury,
    'exposure_risk', new_exposure,
    'risk_added', risk_bump
  );
end;
$$;

grant execute on function public.pac_contribute_illegal(uuid, uuid, numeric, text) to authenticated;

-- ---------- Industry trading ----------
create or replace function public.pac_trade_shares(
  p_industry_key text,
  p_shares numeric,
  p_side text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  side text := lower(trim(p_side));
  qty numeric := round(p_shares, 4);
  pac_row record;
  sector record;
  holding record;
  cost numeric;
  proceeds numeric;
  new_shares numeric;
  new_avg numeric;
  new_treasury numeric;
  cap numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if qty is null or qty <= 0 then raise exception 'Invalid share quantity'; end if;
  if side not in ('buy', 'sell') then raise exception 'Side must be buy or sell'; end if;

  select * into sector from public.industry_sectors where key = p_industry_key;
  if sector.key is null then raise exception 'Unknown industry'; end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'Register a PAC first'; end if;

  select * into holding from public.pac_holdings
  where pac_id = pac_row.id and industry_key = p_industry_key
  for update;

  if side = 'buy' then
    cost := round(qty * sector.current_price, 2);
    if pac_row.treasury_balance < cost then raise exception 'Insufficient PAC treasury'; end if;
    new_treasury := pac_row.treasury_balance - cost;

    if holding.pac_id is null then
      insert into public.pac_holdings (pac_id, industry_key, shares, avg_cost)
      values (pac_row.id, p_industry_key, qty, sector.current_price);
    else
      new_shares := holding.shares + qty;
      new_avg := round(
        ((holding.shares * holding.avg_cost) + (qty * sector.current_price)) / nullif(new_shares, 0),
        4
      );
      update public.pac_holdings
      set shares = new_shares, avg_cost = new_avg
      where pac_id = pac_row.id and industry_key = p_industry_key;
    end if;

    update public.pac_organizations set treasury_balance = new_treasury, updated_at = now() where id = pac_row.id;

    return jsonb_build_object('ok', true, 'side', 'buy', 'cost', cost, 'pac_treasury', new_treasury);
  else
    if holding.pac_id is null or holding.shares < qty then
      raise exception 'Insufficient shares to sell';
    end if;
    proceeds := round(qty * sector.current_price, 2);
    new_treasury := pac_row.treasury_balance + proceeds;
    cap := public._pac_tier_treasury_cap(pac_row.tier);
    if new_treasury > cap then
      raise exception 'Sale would exceed PAC treasury cap of %', cap;
    end if;

    new_shares := holding.shares - qty;
    if new_shares <= 0 then
      delete from public.pac_holdings where pac_id = pac_row.id and industry_key = p_industry_key;
    else
      update public.pac_holdings set shares = new_shares where pac_id = pac_row.id and industry_key = p_industry_key;
    end if;

    update public.pac_organizations set treasury_balance = new_treasury, updated_at = now() where id = pac_row.id;

    return jsonb_build_object('ok', true, 'side', 'sell', 'proceeds', proceeds, 'pac_treasury', new_treasury);
  end if;
end;
$$;

grant execute on function public.pac_trade_shares(text, numeric, text) to authenticated;

-- ---------- Investigation ----------
create or replace function public.pac_investigate_player(
  p_target_user uuid,
  p_election_id uuid default null,
  p_pac_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_investigation_fee numeric := 500000;
  v_cooldown interval := interval '24 hours';
  v_target_exposure numeric := 0;
  v_hint_bonus numeric := 0;
  v_success_chance numeric;
  v_roll numeric;
  v_ledger_entry public.pac_corruption_ledger%rowtype;
  w record;
  v_new_bal numeric;
  v_summary text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._economy_require_active_budget();
  if p_target_user is null or p_target_user = v_uid then
    raise exception 'Invalid investigation target';
  end if;

  if exists (
    select 1
    from public.pac_organizations po
    where po.owner_user_id = v_uid
      and po.last_investigation_at is not null
      and po.last_investigation_at > now() - v_cooldown
  ) then
    raise exception 'Investigation cooldown active (24h)';
  end if;

  select coalesce(sum(po.exposure_risk), 0)
  into v_target_exposure
  from public.pac_organizations po
  where po.owner_user_id = p_target_user;

  if p_election_id is not null then
    v_hint_bonus := v_hint_bonus + 0.08;
  end if;
  if p_pac_id is not null then
    v_hint_bonus := v_hint_bonus + 0.12;
  end if;

  v_success_chance := least(0.95, greatest(0.05, (v_target_exposure / 100) + v_hint_bonus));
  v_roll := random();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < v_investigation_fee then
    raise exception 'Investigation costs %', v_investigation_fee;
  end if;

  v_new_bal := w.balance - v_investigation_fee;
  update public.economy_wallets
  set balance = v_new_bal, updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    -v_investigation_fee,
    v_new_bal,
    'investigation_fee',
    jsonb_build_object('target', p_target_user)
  );

  update public.pac_organizations
  set last_investigation_at = now(), updated_at = now()
  where owner_user_id = v_uid;

  if v_roll > v_success_chance then
    return jsonb_build_object(
      'ok', true,
      'success', false,
      'chance', v_success_chance,
      'message', 'Investigation found nothing actionable.'
    );
  end if;

  select * into v_ledger_entry
  from public.pac_corruption_ledger cl
  where cl.owner_user_id = p_target_user
    and cl.exposed_at is null
    and (p_election_id is null or cl.election_id = p_election_id)
    and (p_pac_id is null or cl.pac_id = p_pac_id)
  order by cl.exposure_risk desc, cl.created_at asc
  limit 1;

  if v_ledger_entry.id is null then
    return jsonb_build_object(
      'ok', true,
      'success', false,
      'chance', v_success_chance,
      'message', 'Target has exposure risk but no corroborating ledger entries yet.'
    );
  end if;

  update public.pac_corruption_ledger
  set exposed_at = now()
  where id = v_ledger_entry.id;

  if v_ledger_entry.kind = 'illegal_coordination' then
    v_summary := 'Undisclosed PAC coordination';
  elsif v_ledger_entry.kind = 'exceed_cap' then
    v_summary := 'PAC spending beyond legal cap';
  elsif v_ledger_entry.kind = 'source_concealment' then
    v_summary := 'Concealed donor source';
  elsif v_ledger_entry.kind = 'conflict_vote' then
    v_summary := 'Conflicted vote on industry legislation';
  else
    v_summary := 'Corruption ledger entry';
  end if;

  insert into public.corruption_exposures (
    target_user_id, investigator_user_id, ledger_entry_id, summary, detail
  ) values (
    p_target_user, v_uid, v_ledger_entry.id, v_summary, v_ledger_entry.detail
  );

  return jsonb_build_object(
    'ok', true,
    'success', true,
    'chance', v_success_chance,
    'summary', v_summary,
    'detail', v_ledger_entry.detail,
    'kind', v_ledger_entry.kind
  );
end;
$function$;

grant execute on function public.pac_investigate_player(uuid, uuid, uuid) to authenticated;

-- ---------- Owner exposure snapshot ----------
create or replace function public.pac_my_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  pac_row record;
  holdings jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid;

  if pac_row.id is null then
    return jsonb_build_object('has_pac', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'industry_key', ph.industry_key,
    'shares', ph.shares,
    'avg_cost', ph.avg_cost
  )), '[]'::jsonb) into holdings
  from public.pac_holdings ph
  where ph.pac_id = pac_row.id;

  return jsonb_build_object(
    'has_pac', true,
    'pac_id', pac_row.id,
    'name', pac_row.name,
    'tier', pac_row.tier,
    'treasury_balance', pac_row.treasury_balance,
    'treasury_cap', public._pac_tier_treasury_cap(pac_row.tier),
    'legal_cap_per_candidate', public._pac_tier_legal_cap(pac_row.tier),
    'revenue_hourly', pac_row.revenue_hourly,
    'exposure_risk', pac_row.exposure_risk,
    'holdings', holdings
  );
end;
$$;

grant execute on function public.pac_my_status() to authenticated;

-- ---------- Campaign ads: self-candidates only (no endorser dark spending via ads) ----------
create or replace function public.economy_use_campaign_ad(
  p_election uuid,
  p_candidate uuid,
  p_target_state text default null,
  p_qty int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  inv int;
  cand record;
  use_state char(2);
  use_district text;
  w record;
  new_bal numeric;
  qty int := greatest(1, least(coalesce(p_qty, 1), 5000));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select quantity into inv
  from public.economy_inventory
  where user_id = v_uid and sku = 'campaign_ad';
  if coalesce(inv, 0) < qty then raise exception 'Not enough campaign ads in inventory'; end if;

  select
    ec.id, ec.user_id, ec.running_mate_user_id, ec.election_id,
    e.office, e.phase, e.general_closes_at, e.state, e.district_code
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;

  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Campaign ads can only be used during the general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then
    raise exception 'General election is closed';
  end if;

  if cand.office = 'president' then
    if cand.user_id <> v_uid and cand.running_mate_user_id <> v_uid then
      raise exception 'Campaign ads are for your own ticket only — fund allies through your PAC';
    end if;
    use_state := null;
    use_district := null;
  else
    if cand.user_id <> v_uid then
      raise exception 'Campaign ads are for your own candidacy only — fund others through your PAC';
    end if;
    use_state := cand.state;
    use_district := cand.district_code;
  end if;

  insert into public.campaign_ads (
    election_id, candidate_id, actor_id, target_state, target_district, points
  )
  select p_election, p_candidate, v_uid, use_state, use_district, 1
  from generate_series(1, qty);

  update public.economy_inventory
  set quantity = quantity - qty
  where user_id = v_uid and sku = 'campaign_ad';

  select * into w from public.economy_wallets where user_id = v_uid;
  new_bal := coalesce(w.balance, 0);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, 0, new_bal, 'campaign_ad_spend',
    jsonb_build_object(
      'election_id', p_election,
      'candidate_id', p_candidate,
      'target_state', use_state,
      'target_district', use_district,
      'qty', qty,
      'points_added', qty
    )
  );

  return jsonb_build_object(
    'ok', true,
    'qty', qty,
    'ads_remaining', greatest(inv - qty, 0),
    'target_state', use_state,
    'target_district', use_district
  );
end;
$$;

-- ---------- Fiscal preview: use pac_organizations ----------
create or replace function public.fiscal_list_player_scheduled_hourly_gross()
returns table(user_id uuid, hourly_gross numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_caller) then
    raise exception 'Only the President, Treasury leadership, or a full staff operator may load federal tax base previews.';
  end if;

  return query
  select
    p.id as user_id,
    (
      public._economy_hourly_from_roles(public._economy_effective_role_keys(p.id))
      + coalesce(
          (
            select po.revenue_hourly
            from public.pac_organizations po
            where po.owner_user_id = p.id
            limit 1
          ),
          0::numeric
        )
    )::numeric as hourly_gross
  from public.profiles p;
end;
$$;

-- ---------- Admin resets: truncate new PAC tables ----------
create or replace function public.admin_economy_full_reset_keep_wallets()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fy1_id uuid;
  v_gdp numeric;
  v_wallet_count int;
  v_seed_brackets jsonb :=
    '[
      {"ceiling":20000,"rate":0},
      {"ceiling":50000,"rate":0.025},
      {"ceiling":100000,"rate":0.05},
      {"ceiling":200000,"rate":0.15},
      {"ceiling":null,"rate":0.405}
    ]'::jsonb;
  v_seed_lines jsonb :=
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
    ]'::jsonb;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff admins may run a full economy reset.';
  end if;

  select y.id into v_fy1_id
  from public.rp_fiscal_years y
  where y.year_index = 1
  order by y.started_at asc
  limit 1
  for update;

  if v_fy1_id is null then
    raise exception 'FY 1 (year_index = 1) does not exist.';
  end if;

  truncate table public.economy_ledger;
  truncate table public.economy_blackjack_sessions;
  truncate table public.corruption_exposures;
  truncate table public.pac_corruption_ledger;
  truncate table public.pac_contributions;
  truncate table public.pac_holdings;
  truncate table public.pac_organizations;
  truncate table public.economy_inventory;

  delete from public.party_treasury_election_grants;

  update public.party_organizations
  set treasury_balance = 0, updated_at = now()
  where party_key in ('democrat', 'republican');

  update public.federal_treasury set balance = 0 where id = 1;

  delete from public.rp_fiscal_years where year_index > 1;

  delete from public.fiscal_tax_accounts where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_tax_settlements where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_year_close_summaries where fiscal_year_id = v_fy1_id;

  update public.economy_wallets
  set last_collected_at = now() - interval '1 hour', updated_at = now();

  insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
  select p.id, 0::numeric, now() - interval '1 hour', now()
  from public.profiles p
  on conflict (user_id) do nothing;

  select count(*)::int, coalesce(sum(balance), 0) into v_wallet_count, v_gdp
  from public.economy_wallets;

  update public.rp_fiscal_years
  set
    status = 'active',
    economy_activity_frozen = false,
    appropriations_act_bill_id = null,
    appropriations_deadline_at = null,
    closed_at = null,
    gdp_opening_total = v_gdp,
    gdp_closing_total = null
  where id = v_fy1_id;

  delete from public.federal_budgets where fiscal_year_id = v_fy1_id;

  insert into public.federal_budgets (
    fiscal_year_id, status, tax_brackets, line_items, metrics, submitted_at, enrolled_at
  ) values (
    v_fy1_id, 'draft', v_seed_brackets, v_seed_lines,
    jsonb_build_object('gdp_reference', v_gdp),
    null, null
  );

  return jsonb_build_object(
    'ok', true,
    'wallets_preserved', v_wallet_count,
    'gdp_opening_total', v_gdp
  );
end;
$$;

notify pgrst, 'reload schema';
