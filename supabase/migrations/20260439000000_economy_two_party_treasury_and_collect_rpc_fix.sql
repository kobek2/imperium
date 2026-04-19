-- Independents do not get a pooled party treasury (only D/R). Refresh economy_collect_income for PostgREST.

-- ---------- Remove Independent party org (and dependent rows) ----------
delete from public.party_officer_votes where party_key = 'independent';
delete from public.party_officer_candidacies where party_key = 'independent';
delete from public.party_officers where party_key = 'independent';
delete from public.party_organizations where party_key = 'independent';

alter table public.party_organizations drop constraint if exists party_organizations_party_key_check;
alter table public.party_organizations
  add constraint party_organizations_party_key_check check (party_key in ('democrat', 'republican'));

-- ---------- Party RPCs: D/R only ----------
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

-- ---------- economy_collect_income: explicit VOLATILE + broad EXECUTE (PostgREST schema cache) ----------
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

grant execute on function public.economy_party_deposit(text, numeric) to authenticated;
grant execute on function public.party_declare_candidacy(text, text) to authenticated;
grant execute on function public.party_cast_officer_vote(text, text, uuid) to authenticated;
grant execute on function public.party_finalize_officer_election(text, text) to authenticated;

notify pgrst, 'reload schema';
