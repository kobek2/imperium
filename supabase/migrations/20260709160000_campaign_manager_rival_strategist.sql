-- Campaign Manager season: human Democratic strategist vs Republican rival AI PAC.

alter table public.simulation_settings
  add column if not exists campaign_manager_active boolean not null default false,
  add column if not exists human_strategist_party text not null default 'democrat'
    check (human_strategist_party in ('democrat', 'republican')),
  add column if not exists human_strategist_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists rival_strategist_enabled boolean not null default true,
  add column if not exists rival_strategist_party text not null default 'republican'
    check (rival_strategist_party in ('democrat', 'republican')),
  add column if not exists rival_strategist_treasury numeric(20, 2) not null default 25000000
    check (rival_strategist_treasury >= 0),
  add column if not exists rival_strategist_difficulty text not null default 'normal'
    check (rival_strategist_difficulty in ('passive', 'normal', 'aggressive')),
  add column if not exists rival_strategist_label text not null default 'Republican War Room',
  add column if not exists last_rival_strategist_tick_at timestamptz,
  add column if not exists campaign_manager_starter_pac_grant numeric(20, 2) not null default 25000000
    check (campaign_manager_starter_pac_grant >= 0);

alter table public.pac_contributions
  alter column pac_user_id drop not null;

alter table public.pac_contributions
  add column if not exists funded_by_rival boolean not null default false,
  add column if not exists contributor_label text;

alter table public.pac_contributions drop constraint if exists pac_contributions_source_chk;
alter table public.pac_contributions add constraint pac_contributions_source_chk check (
  (pac_user_id is not null and funded_by_rival is false)
  or (pac_user_id is null and funded_by_rival is true and contributor_label is not null)
);

create index if not exists pac_contributions_rival_cap_idx
  on public.pac_contributions (election_id, candidate_id)
  where funded_by_rival = true and is_dark = false;

-- Apply one rival-strategist PAC contribution (mirrors disclosed pac_contribute_to_candidate rules).
create or replace function public._rival_strategist_contribute_one(
  p_election uuid,
  p_candidate uuid,
  p_amount numeric,
  p_target_state text default null,
  p_label text default 'Republican War Room'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  cand record;
  legal_cap numeric := 10000000;
  disclosed numeric := 0;
  pts numeric;
  pts_per numeric := 250000;
  v_state char(2);
  norm_state text := nullif(upper(trim(coalesce(p_target_state, ''))), '');
  sim record;
  new_treasury numeric;
begin
  if amt < 100000 then return false; end if;

  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then
    return false;
  end if;
  if sim.rival_strategist_treasury < amt then return false; end if;

  select ec.id, ec.user_id, ec.election_id, ec.primary_winner, e.phase, e.office, e.leadership_role, e.general_closes_at
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then return false; end if;
  if cand.phase <> 'general' then return false; end if;
  if cand.leadership_role is not null then return false; end if;
  if cand.general_closes_at <= now() then return false; end if;

  if exists (
    select 1 from public.election_candidates x
    where x.election_id = p_election and x.primary_winner is true
  ) and coalesce(cand.primary_winner, false) is not true then
    return false;
  end if;

  if cand.office = 'president' then
    if norm_state is null or length(norm_state) <> 2 then return false; end if;
    if not exists (select 1 from public.states s where s.code = norm_state) then return false; end if;
    v_state := norm_state::char(2);
  elsif norm_state is not null then
    return false;
  end if;

  select coalesce(sum(pc.amount), 0) into disclosed
  from public.pac_contributions pc
  where pc.funded_by_rival = true
    and pc.election_id = p_election
    and pc.candidate_id = p_candidate
    and pc.is_dark = false;

  if disclosed + amt > legal_cap then
    amt := greatest(0, legal_cap - disclosed);
    if amt < 100000 then return false; end if;
  end if;

  pts := floor(amt / pts_per);
  if pts < 1 then return false; end if;

  new_treasury := sim.rival_strategist_treasury - amt;
  update public.simulation_settings
  set rival_strategist_treasury = new_treasury, updated_at = now()
  where id = 1;

  if cand.office <> 'president' then
    update public.election_candidates
    set campaign_points_total = coalesce(campaign_points_total, 0) + pts
    where id = p_candidate;
  end if;

  insert into public.pac_contributions (
    pac_user_id, election_id, candidate_id, amount, campaign_points, is_dark, target_state,
    funded_by_rival, contributor_label
  )
  values (
    null, p_election, p_candidate, amt, pts, false, v_state, true, coalesce(nullif(trim(p_label), ''), 'Rival War Room')
  );

  return true;
end;
$$;

create or replace function public._maybe_tick_rival_strategist()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  last_tick timestamptz;
  v_hours int;
  tick_hours int := 1;
  spend_amount numeric := 750000;
  max_pres_states int := 2;
  max_downballot int := 2;
  pres_states_done int := 0;
  downballot_done int := 0;
  r record;
  st record;
  disclosed numeric;
  legal_cap numeric := 10000000;
begin
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then
    return;
  end if;
  if sim.human_strategist_party = sim.rival_strategist_party then return; end if;

  last_tick := sim.last_rival_strategist_tick_at;
  v_hours := floor(extract(epoch from (now() - coalesce(last_tick, '1970-01-01'::timestamptz))) / 3600)::int;

  case sim.rival_strategist_difficulty
    when 'passive' then
      tick_hours := 2;
      spend_amount := 500000;
      max_pres_states := 1;
      max_downballot := 1;
    when 'aggressive' then
      tick_hours := 1;
      spend_amount := 1000000;
      max_pres_states := 3;
      max_downballot := 4;
    else
      tick_hours := 1;
      spend_amount := 750000;
      max_pres_states := 2;
      max_downballot := 2;
  end case;

  if v_hours < tick_hours then return; end if;
  if sim.rival_strategist_treasury < 100000 then return; end if;

  for r in
    select e.id as election_id, e.office, ec.id as candidate_id
    from public.elections e
    join public.election_candidates ec on ec.election_id = e.id
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.leadership_role is null
      and e.general_closes_at > now()
      and ec.party = sim.rival_strategist_party
      and (
        not exists (
          select 1 from public.election_candidates x
          where x.election_id = e.id and x.primary_winner is true
        )
        or ec.primary_winner is true
      )
    order by case e.office when 'president' then 0 when 'senate' then 1 else 2 end, random()
  loop
    if r.office = 'president' then
      if pres_states_done >= max_pres_states then continue; end if;
      for st in
        select s.code
        from public.states s
        order by abs(coalesce(s.pvi, 0)), random()
        limit 20
      loop
        exit when pres_states_done >= max_pres_states;
        select coalesce(sum(pc.amount), 0) into disclosed
        from public.pac_contributions pc
        where pc.funded_by_rival = true
          and pc.election_id = r.election_id
          and pc.candidate_id = r.candidate_id
          and pc.is_dark = false
          and pc.target_state = st.code;
        if disclosed >= legal_cap then continue; end if;
        if public._rival_strategist_contribute_one(
          r.election_id, r.candidate_id, spend_amount, st.code::text, sim.rival_strategist_label
        ) then
          pres_states_done := pres_states_done + 1;
        end if;
      end loop;
    else
      if downballot_done >= max_downballot then continue; end if;
      if public._rival_strategist_contribute_one(
        r.election_id, r.candidate_id, spend_amount, null, sim.rival_strategist_label
      ) then
        downballot_done := downballot_done + 1;
      end if;
    end if;
    exit when pres_states_done >= max_pres_states and downballot_done >= max_downballot;
  end loop;

  update public.simulation_settings
  set last_rival_strategist_tick_at = now(), updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.campaign_manager_enroll_strategist(p_pac_name text default 'Democratic Victory Fund')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(coalesce(p_pac_name, ''));
  sim record;
  grant_amt numeric;
  pac_row record;
  new_treasury numeric;
  granted boolean := false;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true then
    raise exception 'Campaign Manager season is not active yet';
  end if;

  if (select party from public.profiles where id = v_uid) is distinct from sim.human_strategist_party then
    raise exception 'Only % party members may enroll as the human strategist', sim.human_strategist_party;
  end if;

  if sim.human_strategist_user_id is not null and sim.human_strategist_user_id <> v_uid then
    raise exception 'Another player is already the party strategist';
  end if;

  if v_name = '' or char_length(v_name) < 3 then
    v_name := case sim.human_strategist_party
      when 'democrat' then 'Democratic Victory Fund'
      else 'Republican Victory Fund'
    end;
  end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid;
  if pac_row.user_id is null then
    insert into public.economy_pacs (user_id, pac_name, is_dark_money, treasury_balance)
    values (v_uid, v_name, false, 0);
    select * into pac_row from public.economy_pacs where user_id = v_uid;
  end if;

  grant_amt := coalesce(sim.campaign_manager_starter_pac_grant, 0);
  if grant_amt > 0 and not exists (
    select 1 from public.economy_ledger el
    where el.wallet_user_id = v_uid and el.kind = 'campaign_manager_starter_grant'
  ) then
    new_treasury := coalesce(pac_row.treasury_balance, 0) + grant_amt;
    update public.economy_pacs
    set treasury_balance = new_treasury, updated_at = now()
    where user_id = v_uid;
    insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    select v_uid, 0, w.balance, 'campaign_manager_starter_grant',
      jsonb_build_object('pac_treasury_after', new_treasury, 'grant', grant_amt)
    from public.economy_wallets w where w.user_id = v_uid;
    granted := true;
    pac_row.treasury_balance := new_treasury;
  end if;

  update public.simulation_settings
  set human_strategist_user_id = v_uid, updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'pac_name', pac_row.pac_name,
    'treasury_balance', pac_row.treasury_balance,
    'starter_grant_applied', granted,
    'party', sim.human_strategist_party
  );
end;
$$;

create or replace function public.campaign_manager_boot_season(
  p_human_party text default 'democrat',
  p_rival_party text default 'republican',
  p_starter_grant numeric default 25000000,
  p_rival_treasury numeric default 25000000,
  p_difficulty text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;

  if p_human_party not in ('democrat', 'republican') then raise exception 'Invalid human party'; end if;
  if p_rival_party not in ('democrat', 'republican') then raise exception 'Invalid rival party'; end if;
  if p_human_party = p_rival_party then raise exception 'Human and rival parties must differ'; end if;
  if p_difficulty not in ('passive', 'normal', 'aggressive') then raise exception 'Invalid difficulty'; end if;

  update public.simulation_settings
  set
    campaign_manager_active = true,
    human_strategist_party = p_human_party,
    human_strategist_user_id = null,
    rival_strategist_enabled = true,
    rival_strategist_party = p_rival_party,
    rival_strategist_treasury = greatest(coalesce(p_rival_treasury, 0), 0),
    rival_strategist_difficulty = p_difficulty,
    rival_strategist_label = case p_rival_party
      when 'democrat' then 'Democratic War Room (AI)'
      else 'Republican War Room (AI)'
    end,
    campaign_manager_starter_pac_grant = greatest(coalesce(p_starter_grant, 0), 0),
    last_rival_strategist_tick_at = null,
    updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'human_party', p_human_party,
    'rival_party', p_rival_party,
    'rival_treasury', greatest(coalesce(p_rival_treasury, 0), 0),
    'starter_grant', greatest(coalesce(p_starter_grant, 0), 0),
    'difficulty', p_difficulty
  );
end;
$$;

create or replace function public.campaign_manager_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  pac_row record;
  is_human boolean := false;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then
    return jsonb_build_object('active', false);
  end if;

  is_human := v_uid is not null and sim.human_strategist_user_id = v_uid;

  if v_uid is not null then
    select * into pac_row from public.economy_pacs where user_id = v_uid;
  end if;

  return jsonb_build_object(
    'active', coalesce(sim.campaign_manager_active, false),
    'human_party', sim.human_strategist_party,
    'human_strategist_user_id', sim.human_strategist_user_id,
    'is_human_strategist', is_human,
    'rival_enabled', coalesce(sim.rival_strategist_enabled, false),
    'rival_party', sim.rival_strategist_party,
    'rival_treasury', coalesce(sim.rival_strategist_treasury, 0),
    'rival_label', sim.rival_strategist_label,
    'rival_difficulty', sim.rival_strategist_difficulty,
    'starter_grant', coalesce(sim.campaign_manager_starter_pac_grant, 0),
    'my_pac_treasury', coalesce(pac_row.treasury_balance, 0),
    'my_pac_name', pac_row.pac_name
  );
end;
$$;

-- Hook rival tick into economy income collection (global hourly cadence).
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
  v_gross numeric;
  v_salary_collect numeric;
  v_keys text[];
  v_party text;
  v_levy_rate numeric := 0;
  v_levy numeric := 0;
  v_after_levy numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  select public._economy_effective_role_keys(v_uid) into v_keys;
  v_role_hourly := public._economy_hourly_from_roles(v_keys);

  v_hours := floor(extract(epoch from (now() - w.last_collected_at)) / 3600)::int;
  v_hours := least(greatest(v_hours, 0), 24);

  if v_hours < 1 or v_role_hourly <= 0 then
    perform public._maybe_tick_sector_markets();
    perform public._maybe_tick_rival_strategist();
    return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', 0, 'balance', w.balance, 'role_hourly', v_role_hourly, 'pac_hourly', 0);
  end if;

  v_gross := v_role_hourly * v_hours;
  v_salary_collect := v_gross;

  select party into v_party from public.profiles where id = v_uid;
  if v_party in ('democrat', 'republican') then
    insert into public.party_organizations (party_key) values (v_party) on conflict (party_key) do nothing;
    begin
      select member_collect_levy_rate into strict v_levy_rate from public.party_organizations where party_key = v_party;
    exception when no_data_found then v_levy_rate := 0;
    end;
    v_levy := round(v_salary_collect * v_levy_rate, 2);
  end if;

  v_after_levy := v_salary_collect - v_levy;
  update public.economy_wallets
  set balance = balance + v_after_levy, last_collected_at = now(), updated_at = now()
  where user_id = v_uid;

  if v_levy > 0 then
    update public.party_organizations set treasury_balance = treasury_balance + v_levy, updated_at = now() where party_key = v_party;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, -v_levy, w.balance + v_after_levy, 'party_levy', jsonb_build_object('party', v_party, 'rate', v_levy_rate));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, v_after_levy, w.balance + v_after_levy, 'income_collect', jsonb_build_object('hours', v_hours, 'role_hourly', v_role_hourly));

  perform public._maybe_tick_sector_markets();
  perform public._maybe_tick_rival_strategist();

  return jsonb_build_object(
    'ok', true, 'hours', v_hours, 'paid', v_after_levy, 'balance', w.balance + v_after_levy,
    'party_levy', v_levy, 'role_hourly', v_role_hourly, 'pac_hourly', 0,
    'gross_collect', v_salary_collect, 'party_levy_salary_base', v_salary_collect
  );
end;
$$;

grant execute on function public.campaign_manager_enroll_strategist(text) to authenticated;
grant execute on function public.campaign_manager_boot_season(text, text, numeric, numeric, text) to authenticated;
grant execute on function public.campaign_manager_status() to authenticated;

notify pgrst, 'reload schema';
