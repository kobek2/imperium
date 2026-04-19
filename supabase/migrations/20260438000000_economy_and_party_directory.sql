-- Economy (wallets, hourly income, PAC, campaign ad inventory, ledger) + party treasuries & officer elections.

create table public.economy_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance numeric(20, 2) not null default 0 check (balance >= 0),
  -- One hour in the past so the first collect can pay one hour immediately (RPC requires >= 1 full hour).
  last_collected_at timestamptz not null default (now() - interval '1 hour'),
  updated_at timestamptz not null default now()
);

create table public.economy_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_user_id uuid not null references public.profiles (id) on delete cascade,
  delta numeric(20, 2) not null,
  balance_after numeric(20, 2) not null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index economy_ledger_wallet_created_idx on public.economy_ledger (wallet_user_id, created_at desc);
create index economy_ledger_created_idx on public.economy_ledger (created_at desc);
create index economy_ledger_kind_idx on public.economy_ledger (kind, created_at desc);

create table public.economy_pacs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  level smallint not null default 1 check (level between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.economy_inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sku text not null check (sku in ('campaign_ad')),
  quantity integer not null default 0 check (quantity >= 0),
  primary key (user_id, sku)
);

create table public.party_organizations (
  party_key text primary key check (party_key in ('democrat', 'republican')),
  treasury_balance numeric(20, 2) not null default 0 check (treasury_balance >= 0),
  updated_at timestamptz not null default now()
);

insert into public.party_organizations (party_key) values ('democrat'), ('republican')
on conflict (party_key) do nothing;

create table public.party_officers (
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  office text not null check (office in ('chair', 'vice_chair', 'treasurer')),
  user_id uuid references public.profiles (id) on delete set null,
  since timestamptz not null default now(),
  primary key (party_key, office)
);

create table public.party_officer_candidacies (
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  office text not null check (office in ('chair', 'vice_chair', 'treasurer')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  declared_at timestamptz not null default now(),
  primary key (party_key, office, user_id)
);

create table public.party_officer_votes (
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  office text not null check (office in ('chair', 'vice_chair', 'treasurer')),
  voter_id uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (party_key, office, voter_id)
);

-- ---------- RLS ----------
alter table public.economy_wallets enable row level security;
alter table public.economy_ledger enable row level security;
alter table public.economy_pacs enable row level security;
alter table public.economy_inventory enable row level security;
alter table public.party_organizations enable row level security;
alter table public.party_officers enable row level security;
alter table public.party_officer_candidacies enable row level security;
alter table public.party_officer_votes enable row level security;

create policy "economy_wallets read authed" on public.economy_wallets
  for select using (auth.role() = 'authenticated');

create policy "economy_ledger read authed" on public.economy_ledger
  for select using (auth.role() = 'authenticated');

create policy "economy_pacs read own" on public.economy_pacs
  for select using (auth.uid() = user_id);

create policy "economy_inventory read own" on public.economy_inventory
  for select using (auth.uid() = user_id);

create policy "party_organizations read authed" on public.party_organizations
  for select using (auth.role() = 'authenticated');

create policy "party_officers read authed" on public.party_officers
  for select using (auth.role() = 'authenticated');

create policy "party_officer_candidacies read authed" on public.party_officer_candidacies
  for select using (auth.role() = 'authenticated');

create policy "party_officer_votes read authed" on public.party_officer_votes
  for select using (auth.role() = 'authenticated');

-- Writes go through SECURITY DEFINER RPCs only (no insert/update policies for end users).

-- ---------- Helpers: merge role keys ----------
create or replace function public._economy_effective_role_keys(p_uid uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  keys text[] := array[]::text[];
  k text;
  v_profile_office_role text;
begin
  for k in select g.role_key from public.government_role_grants g where g.user_id = p_uid
  loop
    if not (k = any(keys)) then
      keys := array_append(keys, k);
    end if;
  end loop;
  select p.office_role into v_profile_office_role from public.profiles p where p.id = p_uid;
  if v_profile_office_role is not null and not (v_profile_office_role = any(keys)) then
    keys := array_append(keys, v_profile_office_role);
  end if;
  return keys;
end;
$$;

create or replace function public._economy_hourly_from_roles(p_keys text[])
returns numeric
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_hourly numeric := 5000;
  has_rep boolean;
  has_sen boolean;
  has_spk boolean;
begin
  has_rep := p_keys && array['representative']::text[];
  has_sen := p_keys && array['senator']::text[];
  has_spk := p_keys && array['speaker']::text[];

  if has_rep then
    v_hourly := 142000;
  elsif has_sen then
    v_hourly := 165000;
  else
    v_hourly := 5000;
  end if;

  if has_spk then
    v_hourly := v_hourly + 90000;
  end if;

  if p_keys && array['president']::text[] then
    v_hourly := v_hourly + 400000;
  end if;
  if p_keys && array['vice_president']::text[] then
    v_hourly := v_hourly + 230000;
  end if;

  return v_hourly;
end;
$$;

create or replace function public._economy_pac_hourly(p_level int)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 1 then 300000::numeric
    when 2 then 500000::numeric
    when 3 then 1000000::numeric
    else 0::numeric
  end;
$$;

create or replace function public.economy_collect_income()
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

grant execute on function public.economy_collect_income() to authenticated;
grant execute on function public.economy_collect_income() to service_role;

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

grant execute on function public.economy_transfer_to_user(uuid, numeric) to authenticated;

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

grant execute on function public.economy_party_deposit(text, numeric) to authenticated;

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

grant execute on function public.economy_buy_campaign_ads(int) to authenticated;

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

grant execute on function public.economy_use_campaign_ad(uuid, uuid) to authenticated;

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

grant execute on function public.economy_buy_pac() to authenticated;

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

grant execute on function public.economy_upgrade_pac() to authenticated;

create or replace function public.economy_gamble_coinflip(p_bet numeric, p_heads boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  bet numeric := round(p_bet, 2);
  w record;
  roll_heads boolean := random() < 0.5;
  won boolean;
  new_bal numeric;
  net_delta numeric := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if bet is null or bet < 1000 or bet > 5000000 then raise exception 'Bet must be between 1,000 and 5,000,000'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < bet then raise exception 'Insufficient balance'; end if;

  won := (p_heads = roll_heads);
  if won then
    net_delta := bet;
  else
    net_delta := -bet;
  end if;

  new_bal := w.balance + net_delta;
  if new_bal < 0 then raise exception 'Insufficient balance'; end if;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    net_delta,
    new_bal,
    'gamble_coinflip',
    jsonb_build_object('bet', bet, 'picked_heads', p_heads, 'roll_heads', roll_heads, 'won', won)
  );

  return jsonb_build_object('ok', true, 'won', won, 'roll_heads', roll_heads, 'balance', new_bal);
end;
$$;

grant execute on function public.economy_gamble_coinflip(numeric, boolean) to authenticated;

-- Party officer: declare candidacy (must be registered party member)
create or replace function public.party_declare_candidacy(p_party text, p_office text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;
  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  insert into public.party_officer_candidacies (party_key, office, user_id)
  values (p_party, p_office, v_uid)
  on conflict (party_key, office, user_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_declare_candidacy(text, text) to authenticated;

create or replace function public.party_cast_officer_vote(p_party text, p_office text, p_candidate uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;
  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  if not exists (
    select 1 from public.party_officer_candidacies c
    where c.party_key = p_party and c.office = p_office and c.user_id = p_candidate
  ) then
    raise exception 'Candidate is not running for this office';
  end if;

  insert into public.party_officer_votes (party_key, office, voter_id, candidate_id)
  values (p_party, p_office, v_uid, p_candidate)
  on conflict (party_key, office, voter_id) do update set candidate_id = excluded.candidate_id, voted_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_cast_officer_vote(text, text, uuid) to authenticated;

-- Admin-only: finalize officer election (plurality) and install officers
create or replace function public.party_finalize_officer_election(p_party text, p_office text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  keys text[];
  winner uuid;
  vote_count bigint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;

  select public._economy_effective_role_keys(v_uid) into keys;
  if not (keys && array['admin']::text[]) then
    raise exception 'Admin only';
  end if;

  select v.candidate_id, count(*)::bigint
  into winner, vote_count
  from public.party_officer_votes v
  where v.party_key = p_party and v.office = p_office
  group by v.candidate_id
  order by count(*) desc, v.candidate_id asc
  limit 1;

  if winner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_votes');
  end if;

  insert into public.party_officers (party_key, office, user_id, since)
  values (p_party, p_office, winner, now())
  on conflict (party_key, office) do update
  set user_id = excluded.user_id, since = excluded.since;

  delete from public.party_officer_votes where party_key = p_party and office = p_office;
  delete from public.party_officer_candidacies where party_key = p_party and office = p_office;

  return jsonb_build_object('ok', true, 'winner', winner, 'votes', vote_count);
end;
$$;

grant execute on function public.party_finalize_officer_election(text, text) to authenticated;

-- Backfill wallets for existing profiles
insert into public.economy_wallets (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
