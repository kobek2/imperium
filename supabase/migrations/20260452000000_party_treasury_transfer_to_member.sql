-- Chair/treasurer may pay party treasury into a same-party member's economy wallet (no campaign points).

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

  -- Lock wallet then party (same order as economy_party_deposit) to reduce deadlock risk with deposits.
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

grant execute on function public.party_transfer_treasury_to_member(text, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
