-- Price history for stock charts (recorded whenever share price updates).

create table if not exists public.business_price_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  price_per_share numeric(20, 4) not null check (price_per_share > 0),
  recorded_at timestamptz not null default now()
);

create index if not exists business_price_history_biz_time_idx
  on public.business_price_history (business_id, recorded_at);

alter table public.business_price_history enable row level security;
drop policy if exists "business_price_history read authed" on public.business_price_history;
create policy "business_price_history read authed"
  on public.business_price_history for select to authenticated using (true);

create or replace function public._business_record_price_history(p_business_id uuid, p_price numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_price is null or p_price <= 0 then return; end if;

  insert into public.business_price_history (business_id, price_per_share, recorded_at)
  select p_business_id, p_price, now()
  where not exists (
    select 1
    from public.business_price_history h
    where h.business_id = p_business_id
      and h.price_per_share = p_price
      and h.recorded_at > now() - interval '5 minutes'
  );
end;
$$;

create or replace function public._business_refresh_share_price(p_business_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  new_price numeric;
begin
  select * into biz from public.businesses where id = p_business_id for update;
  if biz.id is null then return 0; end if;

  new_price := round(
    public._business_book_per_share(biz.treasury, biz.founding_capital, biz.total_shares) * coalesce(biz.market_premium, 1.0),
    4
  );

  update public.businesses
  set price_per_share = new_price
  where id = p_business_id;

  perform public._business_record_price_history(p_business_id, new_price);

  return new_price;
end;
$$;

-- Backfill founding prices and past trades
insert into public.business_price_history (business_id, price_per_share, recorded_at)
select b.id, round(b.founding_capital / b.total_shares, 4), b.created_at
from public.businesses b
where not exists (
  select 1 from public.business_price_history h where h.business_id = b.id
);

insert into public.business_price_history (business_id, price_per_share, recorded_at)
select t.business_id, t.price_at_trade, t.created_at
from public.stock_trades t;

-- Ensure every business has at least its current price on the timeline
insert into public.business_price_history (business_id, price_per_share, recorded_at)
select b.id, b.price_per_share, now()
from public.businesses b;
