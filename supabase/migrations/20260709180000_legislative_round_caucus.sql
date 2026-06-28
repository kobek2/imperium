-- Campaign Manager Congress minigame: caucus roster, NPC political capital, turn-based legislative rounds.

alter table public.sim_politicians
  add column if not exists political_capital numeric not null default 10 check (political_capital >= 0),
  add column if not exists whip_loyalty numeric not null default 75 check (whip_loyalty >= 0 and whip_loyalty <= 100);

alter table public.simulation_settings
  add column if not exists rival_strategist_political_capital numeric not null default 25 check (rival_strategist_political_capital >= 0);

create table if not exists public.campaign_caucus_members (
  sim_politician_id uuid primary key references public.sim_politicians (id) on delete cascade,
  chamber text not null check (chamber in ('house', 'senate')),
  party text not null check (party in ('democrat', 'republican')),
  seat_label text not null default '',
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.campaign_caucus_members enable row level security;
drop policy if exists "campaign_caucus_members read" on public.campaign_caucus_members;
create policy "campaign_caucus_members read" on public.campaign_caucus_members for select to authenticated using (true);

create table if not exists public.legislative_rounds (
  id uuid primary key default gen_random_uuid(),
  cst_date date not null,
  phase text not null default 'leadership' check (phase in (
    'leadership', 'proposals', 'house_vote', 'senate_vote', 'presidential', 'completed'
  )),
  active_bill_id uuid,
  house_majority_party text check (house_majority_party is null or house_majority_party in ('democrat', 'republican')),
  leadership_resolved boolean not null default false,
  human_proposal_submitted boolean not null default false,
  rival_proposal_submitted boolean not null default false,
  last_phase_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists legislative_rounds_one_active_cst_date
  on public.legislative_rounds (cst_date)
  where phase <> 'completed';

create table if not exists public.legislative_round_leadership (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.legislative_rounds (id) on delete cascade,
  role_key text not null check (role_key in (
    'speaker', 'house_majority_leader', 'house_minority_leader'
  )),
  sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  party text not null check (party in ('democrat', 'republican')),
  won boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, role_key, sim_politician_id)
);

create table if not exists public.legislative_round_bills (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.legislative_rounds (id) on delete cascade,
  party text not null check (party in ('democrat', 'republican')),
  sponsor_sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  title text not null,
  summary text not null default '',
  originating_chamber text not null default 'house' check (originating_chamber in ('house', 'senate')),
  house_yeas smallint not null default 0,
  house_nays smallint not null default 0,
  senate_yeas smallint not null default 0,
  senate_nays smallint not null default 0,
  house_passed boolean not null default false,
  senate_passed boolean not null default false,
  signed boolean not null default false,
  vetoed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.legislative_rounds
  drop constraint if exists legislative_rounds_active_bill_fkey;
alter table public.legislative_rounds
  add constraint legislative_rounds_active_bill_fkey
  foreign key (active_bill_id) references public.legislative_round_bills (id) on delete set null;

create table if not exists public.legislative_round_vote_overrides (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.legislative_rounds (id) on delete cascade,
  bill_id uuid not null references public.legislative_round_bills (id) on delete cascade,
  sim_politician_id uuid not null references public.sim_politicians (id) on delete cascade,
  vote text not null check (vote in ('yea', 'nay', 'abstain')),
  method text not null check (method in ('whip', 'bribe', 'rival_whip', 'rival_bribe')),
  created_at timestamptz not null default now(),
  unique (round_id, bill_id, sim_politician_id)
);

alter table public.legislative_rounds enable row level security;
alter table public.legislative_round_leadership enable row level security;
alter table public.legislative_round_bills enable row level security;
alter table public.legislative_round_vote_overrides enable row level security;

drop policy if exists "legislative_rounds read" on public.legislative_rounds;
create policy "legislative_rounds read" on public.legislative_rounds for select to authenticated using (true);
drop policy if exists "legislative_round_leadership read" on public.legislative_round_leadership;
create policy "legislative_round_leadership read" on public.legislative_round_leadership for select to authenticated using (true);
drop policy if exists "legislative_round_bills read" on public.legislative_round_bills;
create policy "legislative_round_bills read" on public.legislative_round_bills for select to authenticated using (true);
drop policy if exists "legislative_round_vote_overrides read" on public.legislative_round_vote_overrides;
create policy "legislative_round_vote_overrides read" on public.legislative_round_vote_overrides for select to authenticated using (true);

alter table public.rival_strategist_actions drop constraint if exists rival_strategist_actions_action_kind_check;
alter table public.rival_strategist_actions add constraint rival_strategist_actions_action_kind_check check (
  action_kind in (
    'pac_spend', 'pac_counter', 'bill_filed', 'daily_refill', 'intel',
    'leadership', 'whip', 'bribe', 'round_advance', 'law_signed', 'law_vetoed'
  )
);

create or replace function public._apply_sim_politician_capital(
  p_sim_id uuid,
  p_delta numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sim_id is null or p_delta = 0 then return; end if;
  update public.sim_politicians
  set political_capital = greatest(0, coalesce(political_capital, 0) + p_delta)
  where id = p_sim_id;
end;
$$;

create or replace function public.bootstrap_campaign_caucus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_caucus_members;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, sub.rn::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id,
      row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'democrat'
    order by d.code
    limit 5
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'house', sp.party, sub.code, (50 + sub.rn)::smallint
  from (
    select d.code, d.incumbent_politician_id as sp_id,
      row_number() over (order by d.code) as rn
    from public.districts d
    join public.sim_politicians sp on sp.id = d.incumbent_politician_id
    where sp.party = 'republican'
    order by d.code
    limit 5
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (100 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label,
      seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'democrat'
    order by seat.state_code, seat.senate_class
    limit 3
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  insert into public.campaign_caucus_members (sim_politician_id, chamber, party, seat_label, sort_order)
  select sp.id, 'senate', sp.party, sub.label, (150 + sub.rn)::smallint
  from (
    select seat.state_code || '-S' || seat.senate_class::text as label,
      seat.incumbent_politician_id as sp_id,
      row_number() over (order by seat.state_code, seat.senate_class) as rn
    from public.senate_seats seat
    join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where sp.party = 'republican'
    order by seat.state_code, seat.senate_class
    limit 3
  ) sub
  join public.sim_politicians sp on sp.id = sub.sp_id;

  return jsonb_build_object('ok', true, 'members', (select count(*)::int from public.campaign_caucus_members));
end;
$$;

create or replace function public._campaign_cst_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

create or replace function public._require_human_strategist()
returns public.simulation_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into sim from public.simulation_settings where id = 1;
  if sim.campaign_manager_active is not true then raise exception 'Campaign Manager season is not active'; end if;
  if sim.human_strategist_user_id is distinct from v_uid then
    raise exception 'Only the enrolled party strategist may act';
  end if;
  if public._campaign_manager_cst_phase() <> 'congress' then
    raise exception 'Congress actions are only available noon–midnight CST';
  end if;
  return sim;
end;
$$;

create or replace function public.campaign_legislative_round_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sim record;
  rnd record;
  cst date := public._campaign_cst_today();
  my_cap numeric := 0;
begin
  select * into sim from public.simulation_settings where id = 1;
  if sim.id is null then return jsonb_build_object('active', false); end if;
  if v_uid is not null then
    select coalesce(political_capital, 0) into my_cap from public.profiles where id = v_uid;
  end if;
  select * into rnd from public.legislative_rounds r
  where r.cst_date = cst and r.phase <> 'completed'
  order by r.created_at desc limit 1;

  return jsonb_build_object(
    'season_active', coalesce(sim.campaign_manager_active, false),
    'cst_phase', public._campaign_manager_cst_phase(),
    'cst_date', cst,
    'round_id', rnd.id,
    'round_phase', rnd.phase,
    'active_bill_id', rnd.active_bill_id,
    'leadership_resolved', coalesce(rnd.leadership_resolved, false),
    'human_proposal_submitted', coalesce(rnd.human_proposal_submitted, false),
    'rival_proposal_submitted', coalesce(rnd.rival_proposal_submitted, false),
    'house_majority_party', rnd.house_majority_party,
    'my_political_capital', my_cap,
    'rival_political_capital', coalesce(sim.rival_strategist_political_capital, 0),
    'caucus_count', (select count(*)::int from public.campaign_caucus_members)
  );
end;
$$;

create or replace function public.campaign_start_legislative_round()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  cst date := public._campaign_cst_today();
  rnd_id uuid;
  dem_h int;
  rep_h int;
  maj text;
begin
  sim := public._require_human_strategist();
  if (select count(*) from public.campaign_caucus_members) < 4 then
    perform public.bootstrap_campaign_caucus();
  end if;
  if exists (select 1 from public.legislative_rounds r where r.cst_date = cst and r.phase <> 'completed') then
    raise exception 'A legislative round is already in progress today';
  end if;

  select
    count(*) filter (where party = sim.human_strategist_party),
    count(*) filter (where party = sim.rival_strategist_party)
  into dem_h, rep_h
  from public.campaign_caucus_members where chamber = 'house';

  if sim.human_strategist_party = 'democrat' then
    maj := case when dem_h > rep_h then 'democrat' when rep_h > dem_h then 'republican' else null end;
  else
    maj := case when rep_h > dem_h then 'republican' when dem_h > rep_h then 'democrat' else null end;
  end if;

  insert into public.legislative_rounds (cst_date, phase, house_majority_party)
  values (cst, 'leadership', maj)
  returning id into rnd_id;

  perform public._rival_strategist_log(
    'round_advance', 'Legislative round opened — nominate caucus leadership.',
    jsonb_build_object('round_id', rnd_id)
  );
  return jsonb_build_object('ok', true, 'round_id', rnd_id, 'phase', 'leadership');
end;
$$;

create or replace function public.campaign_nominate_leadership(p_sim_politician_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  role_key text := lower(trim(coalesce(p_role, '')));
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase = 'leadership' order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No round in leadership phase'; end if;
  if role_key not in ('speaker', 'house_majority_leader', 'house_minority_leader') then
    raise exception 'Invalid leadership role';
  end if;
  select * into mem from public.campaign_caucus_members
  where sim_politician_id = p_sim_politician_id and chamber = 'house';
  if mem.sim_politician_id is null then raise exception 'Not a house caucus member'; end if;
  if mem.party <> sim.human_strategist_party then raise exception 'Nominee must be from your party'; end if;
  if role_key = 'house_majority_leader' and rnd.house_majority_party is distinct from sim.human_strategist_party then
    raise exception 'Your party is not the House majority';
  end if;
  if role_key = 'house_minority_leader' and rnd.house_majority_party = sim.human_strategist_party then
    raise exception 'Your party is not the House minority';
  end if;

  delete from public.legislative_round_leadership
  where round_id = rnd.id and role_key = role_key and party = sim.human_strategist_party;
  insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
  values (rnd.id, role_key, p_sim_politician_id, sim.human_strategist_party);
  return jsonb_build_object('ok', true, 'role', role_key);
end;
$$;

notify pgrst, 'reload schema';
