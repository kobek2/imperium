-- Company sector lobbying: founders pay shareholders to file sector-benefit bills.

create table if not exists public.company_lobby_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.businesses (id) on delete cascade,
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(20, 2) not null check (amount > 0),
  measure_key text not null,
  affected_sector public.business_sector not null,
  stock_market_effect numeric(6, 2) not null,
  bill_title text not null,
  bill_content_md text not null,
  message text,
  status text not null default 'funded'
    check (status in ('funded', 'filed', 'cancelled')),
  bill_id uuid references public.bills (id) on delete set null,
  created_at timestamptz not null default now(),
  funded_at timestamptz not null default now(),
  filed_at timestamptz,
  check (owner_user_id <> recipient_user_id)
);

alter table public.bills
  add column if not exists lobby_offer_id uuid references public.company_lobby_offers (id) on delete set null,
  add column if not exists filing_kind text not null default 'custom'
    check (filing_kind in ('custom', 'policy', 'company_sector'));

create index if not exists company_lobby_offers_recipient_idx
  on public.company_lobby_offers (recipient_user_id, status, created_at desc);
create index if not exists company_lobby_offers_company_idx
  on public.company_lobby_offers (company_id, created_at desc);
create index if not exists company_lobby_offers_owner_idx
  on public.company_lobby_offers (owner_user_id, created_at desc);

alter table public.company_lobby_offers enable row level security;

drop policy if exists "company_lobby_offers read parties" on public.company_lobby_offers;
create policy "company_lobby_offers read parties"
  on public.company_lobby_offers for select to authenticated
  using (owner_user_id = auth.uid() or recipient_user_id = auth.uid());

create or replace function public.fund_company_lobby_offer(
  p_company_id uuid,
  p_recipient_user_id uuid,
  p_amount numeric,
  p_measure_key text,
  p_stock_market_effect numeric,
  p_bill_title text,
  p_bill_content_md text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  biz record;
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  effect numeric := round(coalesce(p_stock_market_effect, 0), 2);
  w_owner record;
  w_recipient record;
  new_owner_bal numeric;
  new_recipient_bal numeric;
  offer_id uuid;
  shares_held int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if amt < 100000 then raise exception 'Minimum lobby payment is $100,000'; end if;
  if char_length(trim(coalesce(p_bill_title, ''))) < 5 then raise exception 'Bill title is required'; end if;
  if char_length(trim(coalesce(p_bill_content_md, ''))) < 50 then raise exception 'Bill text is required'; end if;
  if effect = 0 then raise exception 'Stock market effect cannot be zero'; end if;

  select * into biz from public.businesses where id = p_company_id;
  if biz.id is null then raise exception 'Company not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Only the company founder may fund lobby offers'; end if;
  if p_recipient_user_id is null or p_recipient_user_id = v_uid then
    raise exception 'Choose a shareholder other than yourself';
  end if;

  select coalesce(sh.shares, 0) into shares_held
  from public.stock_holdings sh
  where sh.business_id = p_company_id and sh.user_id = p_recipient_user_id;
  if shares_held < 1 then raise exception 'Recipient must hold shares in this company'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  insert into public.economy_wallets (user_id) values (p_recipient_user_id) on conflict do nothing;
  select * into w_owner from public.economy_wallets where user_id = v_uid for update;
  if w_owner.balance < amt then raise exception 'Insufficient balance for lobby payment'; end if;
  select * into w_recipient from public.economy_wallets where user_id = p_recipient_user_id for update;

  new_owner_bal := w_owner.balance - amt;
  new_recipient_bal := w_recipient.balance + amt;
  update public.economy_wallets set balance = new_owner_bal, updated_at = now() where user_id = v_uid;
  update public.economy_wallets set balance = new_recipient_bal, updated_at = now() where user_id = p_recipient_user_id;

  insert into public.company_lobby_offers (
    company_id, owner_user_id, recipient_user_id, amount,
    measure_key, affected_sector, stock_market_effect,
    bill_title, bill_content_md, message, status, funded_at
  ) values (
    p_company_id, v_uid, p_recipient_user_id, amt,
    trim(coalesce(p_measure_key, 'subsidy')),
    biz.sector,
    effect,
    trim(p_bill_title),
    trim(p_bill_content_md),
    nullif(trim(coalesce(p_message, '')), ''),
    'funded',
    now()
  ) returning id into offer_id;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, -amt, new_owner_bal, 'lobby_payment',
    jsonb_build_object(
      'offer_id', offer_id,
      'company_id', p_company_id,
      'recipient_user_id', p_recipient_user_id,
      'measure_key', trim(coalesce(p_measure_key, 'subsidy')),
      'stock_market_effect', effect
    )
  );

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    p_recipient_user_id, amt, new_recipient_bal, 'lobby_payment',
    jsonb_build_object(
      'offer_id', offer_id,
      'company_id', p_company_id,
      'from_owner_user_id', v_uid,
      'note', 'Lobby payment to file sector legislation'
    )
  );

  insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, metadata)
  values (
    v_uid,
    p_recipient_user_id,
    'lobby_payment',
    amt,
    jsonb_build_object(
      'offer_id', offer_id,
      'company_id', p_company_id,
      'measure_key', trim(coalesce(p_measure_key, 'subsidy')),
      'affected_sector', biz.sector::text,
      'stock_market_effect', effect
    )
  );

  return jsonb_build_object(
    'ok', true,
    'offer_id', offer_id,
    'balance', new_owner_bal,
    'recipient_paid', amt
  );
end;
$$;

create or replace function public.complete_company_lobby_filing(
  p_offer_id uuid,
  p_bill_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  offer record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into offer from public.company_lobby_offers where id = p_offer_id for update;
  if offer.id is null then raise exception 'Lobby offer not found'; end if;
  if offer.recipient_user_id <> v_uid then raise exception 'Only the funded recipient may file this bill'; end if;
  if offer.status <> 'funded' then raise exception 'Lobby offer is not available for filing'; end if;

  if not exists (select 1 from public.bills where id = p_bill_id and author_id = v_uid) then
    raise exception 'Bill not found or not authored by recipient';
  end if;

  update public.company_lobby_offers
  set status = 'filed', bill_id = p_bill_id, filed_at = now()
  where id = p_offer_id;

  return jsonb_build_object('ok', true, 'offer_id', p_offer_id, 'bill_id', p_bill_id);
end;
$$;

grant execute on function public.fund_company_lobby_offer(
  uuid, uuid, numeric, text, numeric, text, text, text
) to authenticated;
grant execute on function public.complete_company_lobby_filing(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
