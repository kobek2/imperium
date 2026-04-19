-- Blackjack vs house dealer (replaces coin flip). One active hand per user; server holds shoe + hands.

create table if not exists public.economy_blackjack_sessions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bet_amount numeric(20, 2) not null check (bet_amount > 0),
  shoe smallint[] not null,
  player_hand smallint[] not null,
  dealer_hand smallint[] not null,
  updated_at timestamptz not null default now()
);

alter table public.economy_blackjack_sessions enable row level security;

create or replace function public._bj_hand_value(cards smallint[])
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  tot int := 0;
  aces int := 0;
  c smallint;
begin
  if cards is null then
    return 0;
  end if;
  foreach c in array cards
  loop
    if c = 1 then
      tot := tot + 11;
      aces := aces + 1;
    elsif c between 2 and 10 then
      tot := tot + c::int;
    else
      tot := tot + 10;
    end if;
  end loop;
  while tot > 21 and aces > 0 loop
    tot := tot - 10;
    aces := aces - 1;
  end loop;
  return tot;
end;
$$;

create or replace function public._bj_is_natural(cards smallint[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(array_length(cards, 1), 0) = 2 and public._bj_hand_value(cards) = 21;
$$;

create or replace function public._bj_shuffled_shoe()
returns smallint[]
language plpgsql
volatile
set search_path = public
as $$
declare
  shoe smallint[] := array[]::smallint[];
  r int;
  i int;
begin
  for r in 1..13 loop
    for i in 1..24 loop
      shoe := shoe || r::smallint;
    end loop;
  end loop;
  return (
    select coalesce(array_agg(c order by random()), array[]::smallint[])
    from unnest(shoe) as u(c)
  );
end;
$$;

drop function if exists public.economy_gamble_coinflip(numeric, boolean);

create or replace function public.economy_blackjack_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s record;
  up int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  select * into s from public.economy_blackjack_sessions where user_id = v_uid;
  if not found then
    return jsonb_build_object('active', false);
  end if;
  up := public._bj_hand_value(s.player_hand);
  return jsonb_build_object(
    'active', true,
    'bet', s.bet_amount,
    'player_hand', to_jsonb(s.player_hand),
    'player_value', up,
    'dealer_up', s.dealer_hand[1],
    'dealer_hole_hidden', coalesce(array_length(s.dealer_hand, 1), 0) > 1
  );
end;
$$;

grant execute on function public.economy_blackjack_state() to authenticated;

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

grant execute on function public.economy_blackjack_start(numeric) to authenticated;

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

grant execute on function public.economy_blackjack_action(text) to authenticated;

notify pgrst, 'reload schema';
