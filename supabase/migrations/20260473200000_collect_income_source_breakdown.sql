create or replace function public.economy_collect_income(p_body jsonb default '{}'::jsonb)
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
  v_salary_collect numeric;
  v_keys text[];
  pac_lvl int;
  v_party text;
  v_levy_rate numeric := 0;
  v_levy numeric := 0;
  v_after_gross numeric;
  v_after_levy numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._economy_require_active_budget();

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
  v_salary_collect := greatest(0::numeric, v_role_hourly * v_hours);

  select party into v_party from public.profiles where id = v_uid;
  if v_party in ('democrat', 'republican') then
    insert into public.party_organizations (party_key) values (v_party)
    on conflict (party_key) do nothing;
    begin
      select member_collect_levy_rate
        into strict v_levy_rate
      from public.party_organizations
      where party_key = v_party
      for update;
    exception
      when no_data_found then
        raise exception 'Party treasury row missing for party % (after upsert).', v_party;
    end;
    v_levy_rate := coalesce(v_levy_rate, 0);
    if v_levy_rate > 0 and v_salary_collect > 0 then
      v_levy := round(v_salary_collect * least(v_levy_rate, 0.25), 2);
      if v_levy > v_salary_collect then
        v_levy := v_salary_collect;
      end if;
    end if;
  end if;

  v_after_gross := w.balance + v_gross;

  update public.economy_wallets
  set balance = v_after_gross,
      last_collected_at = now(),
      updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_gross,
    v_after_gross,
    'hourly_income',
    jsonb_build_object(
      'hours', v_hours,
      'role_hourly', v_role_hourly,
      'pac_hourly', v_pac_hourly,
      'role_keys', to_jsonb(v_keys)
    )
  );

  if v_levy > 0 then
    v_after_levy := v_after_gross - v_levy;
    update public.economy_wallets
    set balance = v_after_levy, updated_at = now()
    where user_id = v_uid;

    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (
      v_uid,
      -v_levy,
      v_after_levy,
      'party_collect_levy',
      jsonb_build_object(
        'party', v_party,
        'from_gross_collect', v_gross,
        'party_levy_salary_base', v_salary_collect,
        'levy', v_levy
      )
    );

    update public.party_organizations
    set treasury_balance = treasury_balance + v_levy, updated_at = now()
    where party_key = v_party;
  end if;

  return jsonb_build_object(
    'ok', true,
    'hours', v_hours,
    'paid', v_gross - v_levy,
    'gross_collect', v_gross,
    'role_hourly', v_role_hourly,
    'pac_hourly', v_pac_hourly,
    'party_levy', v_levy,
    'party_levy_salary_base', v_salary_collect,
    'balance', case when v_levy > 0 then v_after_levy else v_after_gross end
  );
end;
$$;
