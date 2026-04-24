-- Fix "record po is not assigned yet" when party_organizations rows are missing (partial DB reset / drift).
-- Ensures D/R org rows exist and RPCs upsert before FOR UPDATE lock.

insert into public.party_organizations (party_key) values ('democrat'), ('republican')
on conflict (party_key) do nothing;

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

  insert into public.party_organizations (party_key) values (p_party)
  on conflict (party_key) do nothing;
  select * into po from public.party_organizations where party_key = p_party for update;
  if not found then
    raise exception 'Party treasury row missing for party %.', p_party;
  end if;

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

  insert into public.party_organizations (party_key) values (p_party)
  on conflict (party_key) do nothing;
  select * into po from public.party_organizations where party_key = p_party for update;
  if not found then
    raise exception 'Party treasury row missing for party %.', p_party;
  end if;
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

  insert into public.party_organizations (party_key) values (p_party)
  on conflict (party_key) do nothing;
  select * into po from public.party_organizations where party_key = p_party for update;
  if not found then
    raise exception 'Party treasury row missing for party %.', p_party;
  end if;

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
