-- Cabinet engagement: daily hour buckets (was weekly).
-- Diplomacy: real-world partner list (0–100 relations), UTC daily decay, session audit trail,
-- crisis inbox broadcast. Cabinet portfolio RLS: viewers vs secretaries-only updates.
-- Presidential election close: strip all cabinet portfolio grants (new administration).

-- ---------- 1) Rename cabinet weekly hours → daily ----------
drop policy if exists "cabinet_weekly_hours read self or staff" on public.cabinet_weekly_hours;
drop policy if exists "cabinet_weekly_hours insert self" on public.cabinet_weekly_hours;
drop policy if exists "cabinet_weekly_hours update self" on public.cabinet_weekly_hours;

alter table public.cabinet_weekly_hours rename column week_start to day_utc;
alter table public.cabinet_weekly_hours rename to cabinet_daily_hours;

comment on table public.cabinet_daily_hours is 'Per-user diplomatic/defense/etc. engagement hours; resets each UTC calendar day.';

create policy "cabinet_daily_hours read self or staff"
  on public.cabinet_daily_hours for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_admin(auth.uid()));

create policy "cabinet_daily_hours insert self"
  on public.cabinet_daily_hours for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "cabinet_daily_hours update self"
  on public.cabinet_daily_hours for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- 2) Portfolio viewer vs secretary (replace officer helper) ----------
create or replace function public._cabinet_portfolio_secretary(p_uid uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = p_role
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = p_role
    )
    or public.is_staff_admin(p_uid),
    false
  );
$$;

create or replace function public._cabinet_portfolio_viewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_staff_admin(p_uid)
    or exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid
        and g.role_key in (
          'president',
          'vice_president',
          'cabinet',
          'chief_of_staff',
          'secretary_of_state',
          'secretary_of_treasury',
          'attorney_general',
          'secretary_of_defense',
          'secretary_of_homeland_security',
          'secretary_of_health_and_human_services',
          'secretary_of_transportation',
          'secretary_of_energy',
          'secretary_of_interior',
          'secretary_of_agriculture',
          'secretary_of_commerce',
          'secretary_of_education',
          'secretary_of_veterans_affairs',
          'secretary_of_housing_and_urban_development'
        )
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid
        and p.office_role in (
          'president',
          'vice_president',
          'cabinet',
          'chief_of_staff',
          'secretary_of_state',
          'secretary_of_treasury',
          'attorney_general',
          'secretary_of_defense',
          'secretary_of_homeland_security',
          'secretary_of_health_and_human_services',
          'secretary_of_transportation',
          'secretary_of_energy',
          'secretary_of_interior',
          'secretary_of_agriculture',
          'secretary_of_commerce',
          'secretary_of_education',
          'secretary_of_veterans_affairs',
          'secretary_of_housing_and_urban_development'
        )
    ),
    false
  );
$$;

create or replace function public._cabinet_portfolio_officer(p_uid uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._cabinet_portfolio_secretary(p_uid, p_role);
$$;

-- ---------- 3) Foreign nations: 0–100 scale + decay cursor ----------
alter table public.rp_foreign_nations drop constraint if exists rp_foreign_nations_us_relation_check;

alter table public.rp_foreign_nations
  add column if not exists last_decay_utc_date date not null default (timezone('UTC', now()))::date;

update public.rp_foreign_nations
set us_relation = greatest(0, least(100, (us_relation + 100) / 2))
where us_relation is not null;

alter table public.rp_foreign_nations
  add constraint rp_foreign_nations_us_relation_check
  check (us_relation between 0 and 100);

delete from public.rp_foreign_nations;

insert into public.rp_foreign_nations (code, name, us_relation, last_decay_utc_date) values
  ('GBR', 'United Kingdom', 82, (timezone('UTC', now()))::date),
  ('CAN', 'Canada', 78, (timezone('UTC', now()))::date),
  ('MEX', 'Mexico', 62, (timezone('UTC', now()))::date),
  ('JPN', 'Japan', 70, (timezone('UTC', now()))::date),
  ('UKR', 'Ukraine', 78, (timezone('UTC', now()))::date),
  ('RUS', 'Russia', 22, (timezone('UTC', now()))::date),
  ('CHN', 'China', 30, (timezone('UTC', now()))::date);

drop policy if exists "rp_foreign_nations read authed" on public.rp_foreign_nations;
drop policy if exists "rp_foreign_nations update state officers" on public.rp_foreign_nations;

create policy "rp_foreign_nations read cabinet circle"
  on public.rp_foreign_nations for select
  to authenticated
  using (public._cabinet_portfolio_viewer(auth.uid()));

create policy "rp_foreign_nations update secretary of state"
  on public.rp_foreign_nations for update
  to authenticated
  using (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_state'))
  with check (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_state'));

-- ---------- 4) Department metrics: limit read to cabinet circle ----------
drop policy if exists "rp_dept_metrics read authed" on public.rp_cabinet_department_metrics;

create policy "rp_dept_metrics read cabinet circle"
  on public.rp_cabinet_department_metrics for select
  to authenticated
  using (public._cabinet_portfolio_viewer(auth.uid()));

drop policy if exists "rp_dept_metrics update defense" on public.rp_cabinet_department_metrics;
drop policy if exists "rp_dept_metrics update homeland" on public.rp_cabinet_department_metrics;
drop policy if exists "rp_dept_metrics update justice" on public.rp_cabinet_department_metrics;

create policy "rp_dept_metrics update defense"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'defense'
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense')
  )
  with check (
    portfolio_key = 'defense'
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense')
  );

create policy "rp_dept_metrics update homeland"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'homeland'
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_homeland_security')
  )
  with check (
    portfolio_key = 'homeland'
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_homeland_security')
  );

create policy "rp_dept_metrics update justice"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'justice'
    and public._cabinet_portfolio_secretary(auth.uid(), 'attorney_general')
  )
  with check (
    portfolio_key = 'justice'
    and public._cabinet_portfolio_secretary(auth.uid(), 'attorney_general')
  );

-- ---------- 5) Diplomatic sessions (SoS audit trail) ----------
create table public.rp_diplomatic_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nation_code text not null references public.rp_foreign_nations (code) on delete restrict,
  mode text not null check (mode in ('passive', 'intensive')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  agenda jsonb not null default '{}'::jsonb,
  step_index int not null default 0 check (step_index >= 0 and step_index <= 8),
  choice_path int[] not null default '{}',
  hours_committed numeric not null default 0 check (hours_committed >= 0 and hours_committed <= 24),
  outcome_rating smallint check (outcome_rating is null or (outcome_rating between 1 and 5)),
  relation_delta smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rp_diplomatic_sessions_user_created_idx on public.rp_diplomatic_sessions (user_id, created_at desc);
create index rp_diplomatic_sessions_nation_created_idx on public.rp_diplomatic_sessions (nation_code, created_at desc);

alter table public.rp_diplomatic_sessions enable row level security;

create policy "rp_diplomatic_sessions select own or staff"
  on public.rp_diplomatic_sessions for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_admin(auth.uid()));

create policy "rp_diplomatic_sessions insert secretary"
  on public.rp_diplomatic_sessions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_state')
  );

create policy "rp_diplomatic_sessions update own secretary"
  on public.rp_diplomatic_sessions for update
  to authenticated
  using (
    user_id = auth.uid()
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_state')
  )
  with check (
    user_id = auth.uid()
    and public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_state')
  );

-- ---------- 6) Inbox: diplomatic crisis kind (before tick; tick calls broadcast) ----------
alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check
  check (
    kind in (
      'election_win',
      'bill_milestone',
      'party_leadership',
      'whip_instruction',
      'executive_order',
      'diplomatic_crisis'
    )
  );

create or replace function public.rp_diplomacy_broadcast_crisis_inbox(
  p_nation_code text,
  p_nation_name text,
  p_day text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  v_title := 'Diplomatic alert — ' || p_nation_name;
  v_body :=
    'Bilateral standing with '
    || p_nation_name
    || ' has fallen to a critical range on the State Department tracker. The Situation Room thread should reflect consequences; the Secretary of State may still pursue outreach.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'diplomatic_crisis',
    v_title,
    v_body,
    '/cabinet/state',
    'dip_crisis:' || upper(trim(p_nation_code)) || ':' || p_day
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.rp_diplomacy_broadcast_crisis_inbox(text, text, text) from public;
grant execute on function public.rp_diplomacy_broadcast_crisis_inbox(text, text, text) to authenticated;
grant execute on function public.rp_diplomacy_broadcast_crisis_inbox(text, text, text) to service_role;

-- ---------- 7) Daily decay (UTC calendar days, −10 per missed day) ----------
create or replace function public.rp_diplomacy_daily_tick(p_today date default (timezone('UTC', now()))::date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  lost int;
  v_old int;
  v_new int;
  v_day text := to_char(p_today, 'YYYY-MM-DD');
begin
  for r in
    select code, name, us_relation, last_decay_utc_date
    from public.rp_foreign_nations
  loop
    if r.last_decay_utc_date >= p_today then
      continue;
    end if;
    lost := (p_today - r.last_decay_utc_date);
    if lost < 1 then
      continue;
    end if;
    v_old := r.us_relation;
    v_new := greatest(0, r.us_relation - 10 * lost);
    update public.rp_foreign_nations
    set
      us_relation = v_new,
      last_decay_utc_date = p_today,
      updated_at = now()
    where code = r.code;
    if v_old > 10 and v_new <= 10 then
      perform public.rp_diplomacy_broadcast_crisis_inbox(r.code::text, r.name::text, v_day);
    end if;
  end loop;
end;
$$;

revoke all on function public.rp_diplomacy_daily_tick(date) from public;
grant execute on function public.rp_diplomacy_daily_tick(date) to authenticated;
grant execute on function public.rp_diplomacy_daily_tick(date) to service_role;

-- ---------- 8) Presidential term: vacate cabinet portfolio keys ----------
create or replace function public._apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  winner_role text;
  incompat text[];
  leadership text[];
  winner_mate uuid;
  incompat_mate text[];
  prior_seat_winner uuid;
  cabinet_roles text[] := array[
    'chief_of_staff',
    'secretary_of_state',
    'secretary_of_treasury',
    'attorney_general',
    'secretary_of_defense',
    'secretary_of_homeland_security',
    'secretary_of_health_and_human_services',
    'secretary_of_transportation',
    'secretary_of_energy',
    'secretary_of_interior',
    'secretary_of_agriculture',
    'secretary_of_commerce',
    'secretary_of_education',
    'secretary_of_veterans_affairs',
    'secretary_of_housing_and_urban_development'
  ];
begin
  select id, office, state, district_code, senate_class, phase, winner_user_id,
         roles_applied_at, leadership_role
    into race
    from public.elections
    where id = e_election;
  if not found then
    return;
  end if;
  if race.phase <> 'closed'::public.election_phase then
    return;
  end if;
  if race.roles_applied_at is not null then
    return;
  end if;

  leadership := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.leadership_role is not null then
    if race.winner_user_id is not null then
      delete from public.government_role_grants g
        using public.election_candidates ec
       where ec.election_id = e_election
         and ec.user_id = g.user_id
         and ec.user_id <> race.winner_user_id
         and g.role_key = race.leadership_role;

      delete from public.government_role_grants g
       where g.role_key = race.leadership_role
         and g.user_id <> race.winner_user_id;

      insert into public.government_role_grants (user_id, role_key)
        values (race.winner_user_id, race.leadership_role)
        on conflict (user_id, role_key) do nothing;
    else
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role;
    end if;

    update public.elections
      set roles_applied_at = now()
      where id = e_election;
    return;
  end if;

  if race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president'];
  end if;

  if race.winner_user_id is not null then
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    update public.profiles p
      set office_role = winner_role,
          updated_at = now()
      where p.id = race.winner_user_id
        and (
          p.office_role is null
          or p.office_role = 'citizen'
          or p.office_role = winner_role
          or p.office_role = any(incompat)
          or p.office_role = any(leadership)
        );
  end if;

  if race.office = 'president' and race.winner_user_id is not null then
    select ec.running_mate_user_id into winner_mate
    from public.election_candidates ec
    where ec.election_id = e_election
      and ec.user_id = race.winner_user_id
    limit 1;

    if winner_mate is not null then
      incompat_mate := array['representative', 'senator', 'president', 'vice_president'];
      delete from public.government_role_grants g
        where g.user_id = winner_mate
          and (g.role_key = any(leadership) or g.role_key = any(incompat_mate));

      insert into public.government_role_grants (user_id, role_key)
        values (winner_mate, 'vice_president')
        on conflict (user_id, role_key) do nothing;

      update public.profiles p
        set office_role = 'vice_president',
            updated_at = now()
        where p.id = winner_mate
          and (
            p.office_role is null
            or p.office_role = 'citizen'
            or p.office_role = 'vice_president'
            or p.office_role = any(incompat_mate)
            or p.office_role = any(leadership)
          );
    end if;
  end if;

  for cand in
    select ec.user_id, ec.running_mate_user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'house' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.district_code, '')) then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';

      if cand.running_mate_user_id is not null then
        delete from public.government_role_grants g
          where g.user_id = cand.running_mate_user_id and g.role_key = 'vice_president';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.running_mate_user_id and p.office_role = 'vice_president';
      end if;
    end if;

    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p
      set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  if race.office = 'president' then
    delete from public.government_role_grants g
      where g.role_key = any(cabinet_roles);

    update public.profiles p
      set office_role = null, updated_at = now()
      where p.office_role = any(cabinet_roles);
  end if;

  if race.office = 'house' and race.district_code is not null then
    delete from public.government_role_grants g
      using public.profiles p
      where g.user_id = p.id
        and g.role_key = 'representative'
        and upper(trim(coalesce(p.home_district_code, ''))) = upper(trim(race.district_code))
        and (race.winner_user_id is null or g.user_id <> race.winner_user_id);

    update public.profiles p
      set office_role = null, updated_at = now()
      where upper(trim(coalesce(p.home_district_code, ''))) = upper(trim(race.district_code))
        and p.office_role = 'representative'
        and (race.winner_user_id is null or p.id <> race.winner_user_id);
  elsif race.office = 'senate' and race.state is not null and race.senate_class is not null then
    select e.winner_user_id into prior_seat_winner
    from public.elections e
    where e.office = 'senate'
      and upper(trim(coalesce(e.state, ''))) = upper(trim(coalesce(race.state, '')))
      and e.senate_class = race.senate_class
      and e.phase = 'closed'::public.election_phase
      and e.id <> e_election
      and e.winner_user_id is not null
    order by e.general_closes_at desc nulls last
    limit 1;

    if prior_seat_winner is not null
       and (race.winner_user_id is null or prior_seat_winner <> race.winner_user_id) then
      delete from public.government_role_grants g
        where g.user_id = prior_seat_winner and g.role_key = 'senator';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = prior_seat_winner and p.office_role = 'senator';
    end if;
  end if;

  update public.elections
    set roles_applied_at = now()
    where id = e_election;
end;
$$;

notify pgrst, 'reload schema';
