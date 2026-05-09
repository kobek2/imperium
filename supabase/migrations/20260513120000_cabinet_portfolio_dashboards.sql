-- Lightweight RP state for cabinet portfolio dashboards (State / Defense / Homeland / Justice).
-- Weekly "engagement hours" per cabinet role; metrics are global sim flavor text.

create or replace function public._cabinet_portfolio_officer(p_uid uuid, p_role text)
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
    or exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'president'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role in ('president', 'admin')
    )
    or public.is_staff_admin(p_uid),
    false
  );
$$;

create table public.rp_foreign_nations (
  code text primary key check (char_length(code) >= 2 and char_length(code) <= 8),
  name text not null,
  us_relation integer not null default 0 check (us_relation between -100 and 100),
  updated_at timestamptz not null default now()
);

insert into public.rp_foreign_nations (code, name, us_relation) values
  ('ATL', 'Republic of Atlantica', 12),
  ('PAC', 'Pacifica Concord', -5),
  ('EUR', 'Europa Federation', 35),
  ('STH', 'Southern Axis League', -22),
  ('ARK', 'Arctic Cooperative', 8),
  ('ORI', 'Oriental Democratic Union', 18)
on conflict (code) do nothing;

create table public.rp_cabinet_department_metrics (
  portfolio_key text primary key check (portfolio_key in ('defense', 'homeland', 'justice')),
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.rp_cabinet_department_metrics (portfolio_key, body) values
  (
    'defense',
    '{"readiness":62,"logistics_stress":44,"alliance_exercises_completed":1}'::jsonb
  ),
  (
    'homeland',
    '{"threat_index":38,"border_caseload":1240,"cyber_open_alerts":7}'::jsonb
  ),
  (
    'justice',
    '{"active_investigations":14,"civil_rights_queue":6,"public_confidence":55}'::jsonb
  )
on conflict (portfolio_key) do nothing;

create table public.cabinet_weekly_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  week_start date not null,
  hours_budget numeric not null default 20 check (hours_budget >= 0 and hours_budget <= 40),
  hours_used numeric not null default 0 check (hours_used >= 0),
  unique (user_id, role_key, week_start),
  check (hours_used <= hours_budget)
);

alter table public.rp_foreign_nations enable row level security;
alter table public.rp_cabinet_department_metrics enable row level security;
alter table public.cabinet_weekly_hours enable row level security;

create policy "rp_foreign_nations read authed"
  on public.rp_foreign_nations for select
  to authenticated
  using (true);

create policy "rp_foreign_nations update state officers"
  on public.rp_foreign_nations for update
  to authenticated
  using (public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_state'))
  with check (public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_state'));

create policy "rp_dept_metrics read authed"
  on public.rp_cabinet_department_metrics for select
  to authenticated
  using (true);

create policy "rp_dept_metrics update defense"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'defense'
    and public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_defense')
  )
  with check (
    portfolio_key = 'defense'
    and public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_defense')
  );

create policy "rp_dept_metrics update homeland"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'homeland'
    and public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_homeland_security')
  )
  with check (
    portfolio_key = 'homeland'
    and public._cabinet_portfolio_officer(auth.uid(), 'secretary_of_homeland_security')
  );

create policy "rp_dept_metrics update justice"
  on public.rp_cabinet_department_metrics for update
  to authenticated
  using (
    portfolio_key = 'justice'
    and public._cabinet_portfolio_officer(auth.uid(), 'attorney_general')
  )
  with check (
    portfolio_key = 'justice'
    and public._cabinet_portfolio_officer(auth.uid(), 'attorney_general')
  );

create policy "cabinet_weekly_hours read self or staff"
  on public.cabinet_weekly_hours for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_admin(auth.uid()));

create policy "cabinet_weekly_hours insert self"
  on public.cabinet_weekly_hours for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "cabinet_weekly_hours update self"
  on public.cabinet_weekly_hours for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
