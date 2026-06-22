-- Corruption system rebuild: unified hidden ledger + economy_pacs (replaces pac_organizations).

-- ---------- Drop legacy PAC corruption tables ----------
drop function if exists public.pac_my_status();
drop function if exists public.pac_list_market();
drop function if exists public.pac_my_investments();
drop function if exists public.pac_market_buy(uuid, int);
drop function if exists public.pac_market_sell(uuid, int);
drop function if exists public.pac_contribute_legal(uuid, uuid, numeric);
drop function if exists public.pac_contribute_illegal(uuid, uuid, numeric, text);
drop function if exists public.pac_deposit_from_wallet(numeric);
drop function if exists public.pac_trade_shares(text, text, numeric);
drop function if exists public.pac_investigate_player(uuid);
drop function if exists public.economy_upgrade_pac();

drop table if exists public.pac_investor_holdings cascade;
drop table if exists public.pac_holdings cascade;
drop table if exists public.corruption_exposures cascade;
drop table if exists public.pac_corruption_ledger cascade;
drop table if exists public.pac_contributions cascade;
drop table if exists public.pac_organizations cascade;
drop table if exists public.industry_sectors cascade;

-- ---------- economy_pacs (canonical PAC row per player) ----------
create table if not exists public.economy_pacs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  pac_name text not null check (char_length(trim(pac_name)) between 3 and 80),
  treasury_balance numeric(20, 2) not null default 0 check (treasury_balance >= 0),
  is_dark_money boolean not null default false,
  exposure_risk numeric(6, 2) not null default 0 check (exposure_risk >= 0 and exposure_risk <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.economy_pacs enable row level security;

drop policy if exists "economy_pacs select own or staff audit" on public.economy_pacs;
create policy "economy_pacs select own or staff audit"
  on public.economy_pacs for select to authenticated
  using (user_id = auth.uid() or public.is_staff_economy_auditor(auth.uid()));

-- ---------- corruption ledger (hidden until exposed) ----------
create table if not exists public.corruption_ledger (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid references public.profiles (id) on delete set null,
  action_type text not null check (action_type in (
    'dark_money', 'coordination', 'stock_vote_conflict', 'insider_trade', 'suppression_ad', 'attack_ad'
  )),
  amount numeric(20, 2),
  election_id uuid references public.elections (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  is_exposed boolean not null default false,
  exposed_at timestamptz,
  exposed_by_user_id uuid references public.profiles (id) on delete set null,
  found_by_user_id uuid references public.profiles (id) on delete set null
);

create index if not exists corruption_ledger_actor_idx on public.corruption_ledger (actor_user_id, created_at desc);
create index if not exists corruption_ledger_exposed_idx on public.corruption_ledger (is_exposed, created_at desc);

alter table public.corruption_ledger enable row level security;

drop policy if exists "corruption_ledger actors see own or exposed" on public.corruption_ledger;
create policy "corruption_ledger actors see own or exposed"
  on public.corruption_ledger for select to authenticated
  using (actor_user_id = auth.uid() or is_exposed = true or found_by_user_id = auth.uid());

-- ---------- Public legal PAC contributions (FEC-style) ----------
create table if not exists public.pac_contributions (
  id uuid primary key default gen_random_uuid(),
  pac_user_id uuid not null references public.economy_pacs (user_id) on delete cascade,
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  amount numeric(20, 2) not null check (amount > 0),
  campaign_points numeric not null default 0 check (campaign_points >= 0),
  is_dark boolean not null default false,
  disclosed_at timestamptz not null default now()
);

create index if not exists pac_contributions_election_idx on public.pac_contributions (election_id, disclosed_at desc);

alter table public.pac_contributions enable row level security;
drop policy if exists "pac_contributions read authed" on public.pac_contributions;
create policy "pac_contributions read authed" on public.pac_contributions
  for select to authenticated using (true);

-- ---------- Coordination tracking (once per candidate per election) ----------
create table if not exists public.pac_coordinations (
  id uuid primary key default gen_random_uuid(),
  pac_user_id uuid not null references public.economy_pacs (user_id) on delete cascade,
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (pac_user_id, election_id, candidate_id)
);

-- ---------- Register PAC ----------
create or replace function public.economy_register_pac(p_name text, p_dark boolean default false)
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if v_name = '' or char_length(v_name) < 3 then raise exception 'PAC name must be at least 3 characters'; end if;
  if exists (select 1 from public.economy_pacs where user_id = v_uid) then raise exception 'PAC already registered'; end if;

  price := case when public._economy_dev_mode_enabled() then 0::numeric else price end;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if price > 0 and w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_pacs (user_id, pac_name, is_dark_money)
  values (v_uid, v_name, coalesce(p_dark, false));

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_purchase', jsonb_build_object('name', v_name, 'dark_money', coalesce(p_dark, false)));

  return jsonb_build_object('ok', true, 'balance', new_bal);
end;
$$;

grant execute on function public.economy_register_pac(text, boolean) to authenticated;

-- Back-compat alias
create or replace function public.economy_buy_pac(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.economy_register_pac(p_name, false);
end;
$$;

grant execute on function public.economy_buy_pac(text) to authenticated;

-- ---------- PAC status for UI ----------
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into pac_row from public.economy_pacs where user_id = v_uid;
  if pac_row.user_id is null then
    return jsonb_build_object('has_pac', false);
  end if;
  return jsonb_build_object(
    'has_pac', true,
    'pac_name', pac_row.pac_name,
    'treasury_balance', pac_row.treasury_balance,
    'is_dark_money', pac_row.is_dark_money,
    'exposure_risk', pac_row.exposure_risk
  );
end;
$$;

grant execute on function public.pac_my_status() to authenticated;
