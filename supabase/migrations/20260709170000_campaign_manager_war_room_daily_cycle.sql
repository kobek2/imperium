-- War Room daily cycle (CST), reactive rival AI, strategist legislation, intel feed.

alter table public.simulation_settings
  add column if not exists last_rival_election_tick_at timestamptz,
  add column if not exists last_rival_congress_tick_at timestamptz,
  add column if not exists last_rival_daily_refill_cst_date date,
  add column if not exists rival_daily_treasury_allowance numeric(20, 2) not null default 5000000
    check (rival_daily_treasury_allowance >= 0);

alter table public.bills
  add column if not exists filed_by_party_strategist boolean not null default false,
  add column if not exists strategist_party text check (strategist_party is null or strategist_party in ('democrat', 'republican')),
  add column if not exists strategist_sponsor_label text;

create table if not exists public.rival_strategist_actions (
  id uuid primary key default gen_random_uuid(),
  action_kind text not null check (action_kind in (
    'pac_spend', 'pac_counter', 'bill_filed', 'daily_refill', 'intel'
  )),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rival_strategist_actions_created_idx
  on public.rival_strategist_actions (created_at desc);

alter table public.rival_strategist_actions enable row level security;

drop policy if exists "rival_strategist_actions read authenticated" on public.rival_strategist_actions;
create policy "rival_strategist_actions read authenticated"
  on public.rival_strategist_actions for select to authenticated using (true);

create or replace function public._rival_strategist_log(
  p_kind text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rival_strategist_actions (action_kind, summary, metadata)
  values (p_kind, left(trim(coalesce(p_summary, '')), 500), coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public._campaign_manager_cst_phase()
returns text
language sql
stable
set search_path = public
as $$
  select case
    when extract(hour from (now() at time zone 'America/Chicago'))::int < 12 then 'elections'
    else 'congress'
  end;
$$;

create or replace function public._campaign_manager_daily_refill()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  cst_today date := (now() at time zone 'America/Chicago')::date;
  floor_amt numeric;
  allowance numeric;
  new_treasury numeric;
begin
  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then return; end if;
  if sim.last_rival_daily_refill_cst_date = cst_today then return; end if;

  floor_amt := case sim.rival_strategist_difficulty
    when 'passive' then 15000000
    when 'aggressive' then 35000000
    else 25000000
  end;
  allowance := coalesce(sim.rival_daily_treasury_allowance, 5000000);

  new_treasury := greatest(coalesce(sim.rival_strategist_treasury, 0), floor_amt * 0.4) + allowance;

  update public.simulation_settings
  set
    rival_strategist_treasury = new_treasury,
    last_rival_daily_refill_cst_date = cst_today,
    updated_at = now()
  where id = 1;

  perform public._rival_strategist_log(
    'daily_refill',
    format('Rival war chest replenished to $%s for the new CST day.', to_char(new_treasury, 'FM999,999,999,990')),
    jsonb_build_object('treasury', new_treasury, 'allowance', allowance)
  );
end;
$$;

create or replace function public._rival_strategist_election_tick(p_reactive boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  spend_base numeric := 750000;
  counter_mult numeric := 1.15;
  max_counters int := 4;
  counters_done int := 0;
  r record;
  rival_cand uuid;
  human_amt numeric;
  rival_amt numeric;
  gap numeric;
  spend_amt numeric;
  st record;
  legal_cap numeric := 10000000;
  pres_states_done int := 0;
  max_pres_states int := 2;
begin
  if public._campaign_manager_cst_phase() <> 'elections' then return; end if;

  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then return; end if;
  if sim.human_strategist_user_id is null then return; end if;
  if sim.rival_strategist_treasury < 100000 then return; end if;

  case sim.rival_strategist_difficulty
    when 'passive' then spend_base := 500000; counter_mult := 1.05; max_counters := 2; max_pres_states := 1;
    when 'aggressive' then spend_base := 1000000; counter_mult := 1.35; max_counters := 6; max_pres_states := 4;
    else spend_base := 750000; counter_mult := 1.15; max_counters := 4; max_pres_states := 2;
  end case;

  -- Counter human PAC spend (prioritize races/states where human outspent rival).
  for r in
    select
      pc.election_id,
      pc.candidate_id as human_candidate_id,
      pc.target_state,
      sum(pc.amount) as human_amt,
      e.office
    from public.pac_contributions pc
    join public.elections e on e.id = pc.election_id
    join public.election_candidates hc on hc.id = pc.candidate_id
    where pc.pac_user_id = sim.human_strategist_user_id
      and pc.funded_by_rival = false
      and pc.is_dark = false
      and e.phase = 'general'::public.election_phase
      and e.general_closes_at > now()
      and hc.party = sim.human_strategist_party
    group by pc.election_id, pc.candidate_id, pc.target_state, e.office
    order by sum(pc.amount) desc
    limit 20
  loop
    exit when counters_done >= max_counters;

    select ec.id into rival_cand
    from public.election_candidates ec
    where ec.election_id = r.election_id
      and ec.party = sim.rival_strategist_party
      and (
        not exists (select 1 from public.election_candidates x where x.election_id = r.election_id and x.primary_winner is true)
        or ec.primary_winner is true
      )
    limit 1;
    if rival_cand is null then continue; end if;

    select coalesce(sum(pc.amount), 0) into rival_amt
    from public.pac_contributions pc
    where pc.funded_by_rival = true
      and pc.election_id = r.election_id
      and pc.candidate_id = rival_cand
      and pc.is_dark = false
      and (
        (r.target_state is null and pc.target_state is null)
        or pc.target_state = r.target_state
      );

    human_amt := coalesce(r.human_amt, 0);
    if rival_amt + 100000 >= human_amt * counter_mult then continue; end if;

    gap := greatest(250000, ceil((human_amt * counter_mult - rival_amt) / 250000) * 250000);
    spend_amt := least(gap, spend_base * 2, sim.rival_strategist_treasury);

    if r.office = 'president' and r.target_state is not null then
      if pres_states_done >= max_pres_states then continue; end if;
      if public._rival_strategist_contribute_one(
        r.election_id, rival_cand, spend_amt, r.target_state::text, sim.rival_strategist_label
      ) then
        counters_done := counters_done + 1;
        pres_states_done := pres_states_done + 1;
        perform public._rival_strategist_log(
          'pac_counter',
          format('Countered your %s presidential spend in %s with $%s.', sim.human_strategist_party, r.target_state, to_char(spend_amt, 'FM999,999,999,990')),
          jsonb_build_object('election_id', r.election_id, 'state', r.target_state, 'amount', spend_amt, 'human_amt', human_amt)
        );
        select rival_strategist_treasury into sim.rival_strategist_treasury from public.simulation_settings where id = 1;
      end if;
    elsif r.office <> 'president' then
      if public._rival_strategist_contribute_one(
        r.election_id, rival_cand, spend_amt, null, sim.rival_strategist_label
      ) then
        counters_done := counters_done + 1;
        perform public._rival_strategist_log(
          'pac_counter',
          format('Matched your down-ballot PAC surge with $%s for the %s nominee.', to_char(spend_amt, 'FM999,999,999,990'), sim.rival_strategist_party),
          jsonb_build_object('election_id', r.election_id, 'amount', spend_amt, 'human_amt', human_amt)
        );
        select rival_strategist_treasury into sim.rival_strategist_treasury from public.simulation_settings where id = 1;
      end if;
    end if;
  end loop;

  if p_reactive then return; end if;

  -- Proactive pressure on swing targets not yet countered.
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
        not exists (select 1 from public.election_candidates x where x.election_id = e.id and x.primary_winner is true)
        or ec.primary_winner is true
      )
    order by case e.office when 'president' then 0 when 'senate' then 1 else 2 end, random()
    limit 6
  loop
    exit when sim.rival_strategist_treasury < 100000;
    if r.office = 'president' then
      for st in
        select s.code from public.states s order by abs(coalesce(s.pvi, 0)), random() limit 8
      loop
        exit when pres_states_done >= max_pres_states;
        if public._rival_strategist_contribute_one(
          r.election_id, r.candidate_id, spend_base, st.code::text, sim.rival_strategist_label
        ) then
          pres_states_done := pres_states_done + 1;
          perform public._rival_strategist_log(
            'pac_spend',
            format('Independent expenditure: $%s in %s (presidential).', to_char(spend_base, 'FM999,999,999,990'), st.code),
            jsonb_build_object('election_id', r.election_id, 'state', st.code, 'amount', spend_base)
          );
          select rival_strategist_treasury into sim.rival_strategist_treasury from public.simulation_settings where id = 1;
        end if;
      end loop;
    else
      if public._rival_strategist_contribute_one(
        r.election_id, r.candidate_id, spend_base, null, sim.rival_strategist_label
      ) then
        perform public._rival_strategist_log(
          'pac_spend',
          format('Boosted %s down-ballot nominee with $%s.', sim.rival_strategist_party, to_char(spend_base, 'FM999,999,999,990')),
          jsonb_build_object('election_id', r.election_id, 'amount', spend_base)
        );
        select rival_strategist_treasury into sim.rival_strategist_treasury from public.simulation_settings where id = 1;
      end if;
    end if;
  end loop;

  update public.simulation_settings set last_rival_election_tick_at = now(), updated_at = now() where id = 1;
end;
$$;

create or replace function public._rival_strategist_congress_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  sponsor text;
  bill_titles text[] := array[
    'Border Security and Enforcement Act',
    'Energy Independence Restoration Act',
    'Tax Relief for Working Families Act',
    'Defense Readiness Modernization Act'
  ];
  bill_bodies text[] := array[
    'Requires enhanced border security measures and expedited removal proceedings for unlawful entry.',
    'Expands domestic energy production permits and reduces regulatory barriers for oil, gas, and nuclear projects.',
    'Lowers marginal tax rates for middle-income households and adjusts corporate deductions.',
    'Increases defense procurement authorizations and accelerates munitions replenishment programs.'
  ];
  idx int;
  chamber public.bill_chamber;
  new_bill_id uuid;
  recent_count int;
begin
  if public._campaign_manager_cst_phase() <> 'congress' then return; end if;

  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then return; end if;
  if sim.human_strategist_user_id is null then return; end if;

  select count(*) into recent_count
  from public.bills b
  where b.filed_by_party_strategist = true
    and b.strategist_party = sim.rival_strategist_party
    and b.created_at > now() - interval '12 hours';
  if recent_count >= 2 then
    update public.simulation_settings set last_rival_congress_tick_at = now(), updated_at = now() where id = 1;
    return;
  end if;

  select sp.character_name into sponsor
  from public.sim_politicians sp
  where sp.party = sim.rival_strategist_party and sp.office = 'house'
  order by random()
  limit 1;

  idx := 1 + floor(random() * array_length(bill_titles, 1))::int;
  chamber := case when random() < 0.6 then 'house'::public.bill_chamber else 'senate'::public.bill_chamber end;

  insert into public.bills (
    title, content_md, content_html, originating_chamber, author_id, status,
    expires_at, chamber_vote_deadline_at, filed_by_party_strategist, strategist_party, strategist_sponsor_label
  )
  values (
    bill_titles[idx],
    bill_bodies[idx],
    format('<p>%s</p>', bill_bodies[idx]),
    chamber,
    sim.human_strategist_user_id,
    case chamber when 'house' then 'house_floor'::public.bill_status else 'senate_floor'::public.bill_status end,
    now() + interval '30 days',
    now() + interval '24 hours',
    true,
    sim.rival_strategist_party,
    coalesce(sponsor, sim.rival_strategist_label) || ' (R)'
  )
  returning id into new_bill_id;

  perform public._rival_strategist_log(
    'bill_filed',
    format('Filed %s originating in the %s: "%s".', sim.rival_strategist_party, chamber, bill_titles[idx]),
    jsonb_build_object('bill_id', new_bill_id, 'chamber', chamber, 'title', bill_titles[idx])
  );

  update public.simulation_settings set last_rival_congress_tick_at = now(), updated_at = now() where id = 1;
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
  phase text;
  last_tick timestamptz;
  min_minutes int := 30;
  elapsed_minutes int;
begin
  perform public._campaign_manager_daily_refill();

  select * into sim from public.simulation_settings where id = 1 for update;
  if sim.campaign_manager_active is not true or sim.rival_strategist_enabled is not true then return; end if;

  phase := public._campaign_manager_cst_phase();

  case sim.rival_strategist_difficulty
    when 'passive' then min_minutes := 45;
    when 'aggressive' then min_minutes := 20;
    else min_minutes := 30;
  end case;

  if phase = 'elections' then
    last_tick := sim.last_rival_election_tick_at;
    elapsed_minutes := floor(extract(epoch from (now() - coalesce(last_tick, '1970-01-01'::timestamptz))) / 60)::int;
    if elapsed_minutes >= min_minutes then
      perform public._rival_strategist_election_tick(false);
    end if;
  else
    last_tick := sim.last_rival_congress_tick_at;
    elapsed_minutes := floor(extract(epoch from (now() - coalesce(last_tick, '1970-01-01'::timestamptz))) / 60)::int;
    if elapsed_minutes >= greatest(min_minutes, 40) then
      perform public._rival_strategist_congress_tick();
    end if;
  end if;
end;
$$;

create or replace function public.rival_strategist_react_to_human()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._campaign_manager_cst_phase() <> 'elections' then return; end if;
  perform public._rival_strategist_election_tick(true);
end;
$$;

create or replace function public.campaign_manager_file_bill(
  p_title text,
  p_content_md text,
  p_chamber text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  title text := trim(coalesce(p_title, ''));
  body text := trim(coalesce(p_content_md, ''));
  chamber public.bill_chamber;
  new_id uuid;
  sponsor text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public._campaign_manager_cst_phase() <> 'congress' then
    raise exception 'Strategist legislation is only available during the Congress cycle (12:00 PM – 11:59 PM CST)';
  end if;

  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_manager_active is not true then raise exception 'Campaign Manager season is not active'; end if;
  if sim.human_strategist_user_id is distinct from v_uid then
    raise exception 'Only the enrolled party strategist may file war-room legislation';
  end if;
  if (select party from public.profiles where id = v_uid) is distinct from sim.human_strategist_party then
    raise exception 'Party mismatch';
  end if;

  if title = '' or char_length(title) < 5 then raise exception 'Title must be at least 5 characters'; end if;
  if body = '' or char_length(body) < 20 then raise exception 'Bill text must be at least 20 characters'; end if;

  if lower(trim(p_chamber)) = 'house' then chamber := 'house';
  elsif lower(trim(p_chamber)) = 'senate' then chamber := 'senate';
  else raise exception 'Invalid chamber';
  end if;

  select sp.character_name into sponsor
  from public.sim_politicians sp
  where sp.party = sim.human_strategist_party and sp.office = 'house'
  order by random()
  limit 1;

  insert into public.bills (
    title, content_md, content_html, originating_chamber, author_id, status,
    expires_at, chamber_vote_deadline_at, filed_by_party_strategist, strategist_party, strategist_sponsor_label
  )
  values (
    title,
    body,
    format('<p>%s</p>', replace(body, E'\n', '</p><p>')),
    chamber,
    v_uid,
    case chamber when 'house' then 'house_floor'::public.bill_status else 'senate_floor'::public.bill_status end,
    now() + interval '30 days',
    now() + interval '24 hours',
    true,
    sim.human_strategist_party,
    coalesce(sponsor, 'Democratic Caucus') || ' (D)'
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'bill_id', new_id);
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
  phase text;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then return jsonb_build_object('active', false); end if;

  is_human := v_uid is not null and sim.human_strategist_user_id = v_uid;
  phase := public._campaign_manager_cst_phase();

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
    'my_pac_name', pac_row.pac_name,
    'cst_phase', phase,
    'election_window', phase = 'elections',
    'congress_window', phase = 'congress'
  );
end;
$$;

grant execute on function public.campaign_manager_file_bill(text, text, text) to authenticated;
grant execute on function public.rival_strategist_react_to_human() to authenticated;

notify pgrst, 'reload schema';
