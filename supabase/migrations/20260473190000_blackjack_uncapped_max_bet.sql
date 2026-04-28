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
  if bet is null or bet < 1000 then
    raise exception 'Bet must be at least 1,000';
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
