-- Mayor executive directives to department heads + RP briefing reports.

create table if not exists public.city_mayor_department_tasks (
  id uuid primary key default gen_random_uuid(),
  department_key text not null check (department_key in (
    'finance', 'police', 'public_works', 'parks', 'planning'
  )),
  title text not null check (char_length(trim(title)) > 0),
  instructions text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  assigned_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists city_mayor_department_tasks_dept_idx
  on public.city_mayor_department_tasks (department_key, created_at desc);

create table if not exists public.city_department_reports (
  id uuid primary key default gen_random_uuid(),
  department_key text not null check (department_key in (
    'finance', 'police', 'public_works', 'parks', 'planning'
  )),
  sim_politician_id uuid references public.sim_politicians (id) on delete set null,
  task_id uuid references public.city_mayor_department_tasks (id) on delete set null,
  title text not null,
  body text not null,
  report_kind text not null default 'briefing' check (report_kind in (
    'briefing', 'task_ack', 'task_update', 'situation'
  )),
  created_at timestamptz not null default now()
);

create index if not exists city_department_reports_created_idx
  on public.city_department_reports (created_at desc);

alter table public.city_mayor_department_tasks enable row level security;
alter table public.city_department_reports enable row level security;

drop policy if exists "city_mayor_department_tasks read" on public.city_mayor_department_tasks;
create policy "city_mayor_department_tasks read" on public.city_mayor_department_tasks
  for select to authenticated using (true);

drop policy if exists "city_department_reports read" on public.city_department_reports;
create policy "city_department_reports read" on public.city_department_reports
  for select to authenticated using (true);

create or replace function public._department_head_for(p_department_key text)
returns table(sim_politician_id uuid, character_name text)
language sql
stable
security definer
set search_path = public
as $$
  select sp.id, sp.character_name
  from public.city_department_heads h
  join public.sim_politicians sp on sp.id = h.sim_politician_id
  where h.department_key = p_department_key;
$$;

create or replace function public.mayor_assign_department_task(
  p_department_key text,
  p_title text,
  p_instructions text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  dept text := lower(trim(coalesce(p_department_key, '')));
  title text := trim(coalesce(p_title, ''));
  instructions text := trim(coalesce(p_instructions, ''));
  head record;
  task_id uuid;
  ack_body text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may assign department tasks';
  end if;

  if dept not in ('finance', 'police', 'public_works', 'parks', 'planning') then
    raise exception 'Invalid department';
  end if;

  if title = '' then raise exception 'Task title is required'; end if;

  select * into head from public._department_head_for(dept);
  if head.sim_politician_id is null then
    raise exception 'No department head seated for %', dept;
  end if;

  insert into public.city_mayor_department_tasks (
    department_key, title, instructions, assigned_by
  ) values (dept, title, instructions, v_uid)
  returning id into task_id;

  ack_body := case dept
    when 'finance' then format(
      '%s confirms receipt of your directive. Finance will run revenue scenarios and coordinate with OMB on "%s".',
      head.character_name, title)
    when 'police' then format(
      '%s acknowledges the order. NYPD command staff will brief precinct captains on "%s" and report compliance metrics.',
      head.character_name, title)
    when 'public_works' then format(
      '%s has logged the priority. Field crews and capital projects will be sequenced around "%s".',
      head.character_name, title)
    when 'parks' then format(
      '%s thanks you for the clear ask. Parks staff will align programming and maintenance schedules with "%s".',
      head.character_name, title)
    when 'planning' then format(
      '%s will circulate the directive to borough planning desks. Zoning and land-use reviews tied to "%s" begin this week.',
      head.character_name, title)
    else format('%s acknowledges your directive.', head.character_name)
  end;

  if instructions <> '' then
    ack_body := ack_body || E'\n\nYour instructions: ' || instructions;
  end if;

  insert into public.city_department_reports (
    department_key, sim_politician_id, task_id, title, body, report_kind
  ) values (
    dept,
    head.sim_politician_id,
    task_id,
    format('Directive acknowledged — %s', title),
    ack_body,
    'task_ack'
  );

  return jsonb_build_object('ok', true, 'task_id', task_id);
end;
$$;

create or replace function public.mayor_request_task_update(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t record;
  head record;
  update_body text;
  update_title text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may request task updates';
  end if;

  select * into t from public.city_mayor_department_tasks where id = p_task_id;
  if t.id is null then raise exception 'Task not found'; end if;
  if t.status <> 'open' then raise exception 'Task is already closed'; end if;

  select * into head from public._department_head_for(t.department_key);

  update_title := format('Status update — %s', t.title);
  update_body := case t.department_key
    when 'finance' then format(
      '%s reports steady progress on "%s". Preliminary numbers look manageable; full memo to your desk by end of week.',
      coalesce(head.character_name, 'Finance'), t.title)
    when 'police' then format(
      '%s: precinct roll-out for "%s" is underway. Early shift briefings complete in Manhattan and Brooklyn; Queens and Bronx next.',
      coalesce(head.character_name, 'NYPD'), t.title)
    when 'public_works' then format(
      '%s: crews have reprioritized capital work for "%s". Contracting is lining up vendors; expect a lane-closure schedule soon.',
      coalesce(head.character_name, 'Public Works'), t.title)
    when 'parks' then format(
      '%s: rec centers and field staff are aligned on "%s". Community board notifications going out; volunteer sign-ups trending up.',
      coalesce(head.character_name, 'Parks'), t.title)
    when 'planning' then format(
      '%s: land-use review for "%s" is in scoping. ULURP timeline draft attached to internal share; public review window TBD.',
      coalesce(head.character_name, 'City Planning'), t.title)
    else format('Progress noted on "%s".', t.title)
  end;

  insert into public.city_department_reports (
    department_key, sim_politician_id, task_id, title, body, report_kind
  ) values (
    t.department_key,
    head.sim_politician_id,
    t.id,
    update_title,
    update_body,
    'task_update'
  );

  return jsonb_build_object('ok', true, 'task_id', t.id);
end;
$$;

create or replace function public.mayor_close_department_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may close department tasks';
  end if;

  update public.city_mayor_department_tasks
  set status = 'closed', closed_at = now()
  where id = p_task_id and status = 'open';

  if not found then raise exception 'Open task not found'; end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Seed situational briefings (skip if any reports already exist).
insert into public.city_department_reports (
  department_key, sim_politician_id, title, body, report_kind
)
select v.department_key, v.sim_politician_id, v.title, v.body, 'situation'
from (
  values
    (
      'finance',
      (select id from public.sim_politicians where slug = 'dept-finance-powell'),
      'Q1 revenue collection ahead of forecast',
      'Property-tax receipts are tracking 2.1% above the January forecast. Reserve drawdown not required this quarter, but monitor commercial vacancy in Midtown.',
      'situation'
    ),
    (
      'police',
      (select id from public.sim_politicians where slug = 'dept-police-pope'),
      'Weekend precinct staffing note',
      'Felony complaints down 4% citywide WoW. Three precincts flagged for overtime caps — recommend a targeted deployment memo before summer events season.',
      'situation'
    ),
    (
      'public_works',
      (select id from public.sim_politicians where slug = 'dept-public-works-clinton'),
      'Pothole backlog & bridge inspections',
      '311 pothole closure rate is 78% within SLA. Williamsburg Bridge lane study complete; capital request may need your sign-off if council adds lane restrictions.',
      'situation'
    ),
    (
      'parks',
      (select id from public.sim_politicians where slug = 'dept-parks-knope'),
      'Summer programming rollout',
      'Pool openings on schedule for June 15. Volunteer corps enrollment up 12% in Queens and Staten Island — recommend a ribbon-cutting in W03 if you want a press hit.',
      'situation'
    ),
    (
      'planning',
      (select id from public.sim_politicians where slug = 'dept-planning-mccord'),
      'Waterfront rezoning docket',
      'Two mixed-use rezonings queued for ULURP in Brooklyn and the Bronx. Affordable-housing set-aside negotiations ongoing with council land-use staff.',
      'situation'
    )
) as v(department_key, sim_politician_id, title, body, report_kind)
where not exists (select 1 from public.city_department_reports limit 1)
  and v.sim_politician_id is not null;

grant execute on function public.mayor_assign_department_task(text, text, text) to authenticated;
grant execute on function public.mayor_request_task_update(uuid) to authenticated;
grant execute on function public.mayor_close_department_task(uuid) to authenticated;

notify pgrst, 'reload schema';
