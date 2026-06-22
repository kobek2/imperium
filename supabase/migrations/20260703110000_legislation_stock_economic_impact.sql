-- Legislation ↔ stock market: economic impact fields, market events, company positions.

alter table public.bills
  add column if not exists affected_sector public.business_sector,
  add column if not exists stock_market_effect numeric(6, 2);

comment on column public.bills.affected_sector is 'Sector whose public companies move when this bill becomes law.';
comment on column public.bills.stock_market_effect is 'Percent change applied to sector companies on enactment (e.g. 20 = +20%, -15 = -15%).';

update public.bills
set affected_sector = sector_tag
where affected_sector is null and sector_tag is not null;

-- Public market events when legislation moves stocks
create table if not exists public.market_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references public.bills (id) on delete set null,
  headline text not null,
  affected_sector public.business_sector not null,
  sector_effect_pct numeric(6, 2) not null,
  created_at timestamptz not null default now()
);

create index if not exists market_events_created_idx on public.market_events (created_at desc);
create index if not exists market_events_bill_idx on public.market_events (bill_id);

create table if not exists public.market_event_companies (
  market_event_id uuid not null references public.market_events (id) on delete cascade,
  company_id uuid not null references public.businesses (id) on delete cascade,
  company_name text not null,
  ticker_symbol text,
  price_before numeric(20, 4) not null,
  price_after numeric(20, 4) not null,
  primary key (market_event_id, company_id)
);

alter table public.market_events enable row level security;
alter table public.market_event_companies enable row level security;

drop policy if exists "market_events read authed" on public.market_events;
create policy "market_events read authed"
  on public.market_events for select to authenticated using (true);

drop policy if exists "market_event_companies read authed" on public.market_event_companies;
create policy "market_event_companies read authed"
  on public.market_event_companies for select to authenticated using (true);

-- Company public positions on legislation (informational only)
create table if not exists public.company_bill_positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.businesses (id) on delete cascade,
  bill_id uuid not null references public.bills (id) on delete cascade,
  position text not null check (position in ('support', 'oppose', 'neutral')),
  disclosed_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, bill_id)
);

create index if not exists company_bill_positions_bill_idx on public.company_bill_positions (bill_id, created_at desc);
create index if not exists company_bill_positions_company_idx on public.company_bill_positions (company_id, created_at desc);

alter table public.company_bill_positions enable row level security;

drop policy if exists "company_bill_positions read authed" on public.company_bill_positions;
create policy "company_bill_positions read authed"
  on public.company_bill_positions for select to authenticated using (true);

create or replace function public.disclose_company_bill_position(
  p_company_id uuid,
  p_bill_id uuid,
  p_position text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  biz record;
  pos text := lower(trim(coalesce(p_position, '')));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if pos not in ('support', 'oppose', 'neutral') then
    raise exception 'Position must be support, oppose, or neutral';
  end if;

  select * into biz from public.businesses where id = p_company_id;
  if biz.id is null then raise exception 'Company not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Only the company founder may disclose a position'; end if;

  if not exists (select 1 from public.bills where id = p_bill_id) then
    raise exception 'Bill not found';
  end if;

  insert into public.company_bill_positions (company_id, bill_id, position, disclosed_by)
  values (p_company_id, p_bill_id, pos, v_uid)
  on conflict (company_id, bill_id) do update
  set position = excluded.position, disclosed_by = excluded.disclosed_by, created_at = now();

  return jsonb_build_object('ok', true, 'position', pos);
end;
$$;

grant execute on function public.disclose_company_bill_position(uuid, uuid, text) to authenticated;

-- Apply configured sector stock effect when a bill becomes law.
create or replace function public._legislation_apply_stock_market_effect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  v_sector public.business_sector;
  effect_pct numeric;
  multiplier numeric;
  event_id uuid;
  price_before numeric;
  price_after numeric;
  company_names text[] := '{}';
begin
  if new.status is distinct from 'law'::public.bill_status then
    return new;
  end if;
  if old.status = 'law'::public.bill_status then
    return new;
  end if;

  v_sector := coalesce(new.affected_sector, new.sector_tag);
  effect_pct := new.stock_market_effect;

  if v_sector is null then
    return new;
  end if;

  if effect_pct is null then
    effect_pct := case
      when lower(coalesce(new.policy_tags ->> 'stance_key', '')) like '%oppose%'
        or coalesce((new.policy_tags ->> 'policy_value')::numeric, 0) < 0 then -20
      else 20
    end;
  end if;

  if effect_pct = 0 then
    return new;
  end if;

  multiplier := 1 + (effect_pct / 100.0);

  insert into public.market_events (bill_id, headline, affected_sector, sector_effect_pct)
  values (new.id, new.title || ' Passed', v_sector, effect_pct)
  returning id into event_id;

  for biz in
    select b.id, b.name, b.ticker_symbol, b.price_per_share, b.market_premium
    from public.businesses b
    where b.sector = v_sector
  loop
    price_before := coalesce(biz.price_per_share, 0);

    update public.businesses
    set market_premium = greatest(0.25, least(4.0, coalesce(biz.market_premium, 1.0) * multiplier))
    where id = biz.id;

    price_after := public._business_refresh_share_price(biz.id);

    insert into public.market_event_companies (
      market_event_id, company_id, company_name, ticker_symbol, price_before, price_after
    ) values (
      event_id, biz.id, biz.name, biz.ticker_symbol, price_before, price_after
    );

    company_names := array_append(company_names, biz.name);
  end loop;

  return new;
end;
$$;

drop trigger if exists corruption_bill_sector_stock on public.bills;
drop trigger if exists legislation_bill_sector_stock on public.bills;
create trigger legislation_bill_sector_stock
  after update of status on public.bills
  for each row execute function public._legislation_apply_stock_market_effect();

-- Keep sector_tag aligned for legacy conflict checks
create or replace function public._bills_sync_sector_tags()
returns trigger
language plpgsql
as $$
begin
  if new.affected_sector is not null then
    new.sector_tag := new.affected_sector;
  elsif new.sector_tag is not null and new.affected_sector is null then
    new.affected_sector := new.sector_tag;
  end if;
  return new;
end;
$$;

drop trigger if exists bills_sync_sector_tags on public.bills;
create trigger bills_sync_sector_tags
  before insert or update of affected_sector, sector_tag on public.bills
  for each row execute function public._bills_sync_sector_tags();

notify pgrst, 'reload schema';
