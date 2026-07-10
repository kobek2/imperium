-- Mayor cabinet: department head removal, public statements, flavor-only executive orders.

-- ---------- Report kinds for appointment / vacancy ----------

alter table public.city_department_reports
  drop constraint if exists city_department_reports_report_kind_check;

alter table public.city_department_reports
  add constraint city_department_reports_report_kind_check check (
    report_kind in (
      'briefing',
      'task_ack',
      'task_update',
      'situation',
      'vacancy',
      'appointment'
    )
  );

-- ---------- Public statements ----------

create table if not exists public.city_mayor_public_statements (
  id uuid primary key default gen_random_uuid(),
  city_code char(2) not null default 'MB',
  issued_by uuid not null references auth.users (id) on delete cascade,
  template_key text,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists city_mayor_public_statements_created_idx
  on public.city_mayor_public_statements (created_at desc);

alter table public.city_mayor_public_statements enable row level security;

drop policy if exists "city_mayor_public_statements read" on public.city_mayor_public_statements;
create policy "city_mayor_public_statements read" on public.city_mayor_public_statements
  for select to authenticated using (true);

-- ---------- City executive orders (flavor / RP only) ----------

create table if not exists public.city_mayor_executive_orders (
  id uuid primary key default gen_random_uuid(),
  city_code char(2) not null default 'MB',
  issued_by uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 8000),
  template_key text,
  created_at timestamptz not null default now()
);

create index if not exists city_mayor_executive_orders_created_idx
  on public.city_mayor_executive_orders (created_at desc);

alter table public.city_mayor_executive_orders enable row level security;

drop policy if exists "city_mayor_executive_orders read" on public.city_mayor_executive_orders;
create policy "city_mayor_executive_orders read" on public.city_mayor_executive_orders
  for select to authenticated using (true);

-- ---------- Helpers ----------

create or replace function public._mayor_may_act(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.government_role_grants g
    where g.user_id = p_uid and g.role_key in ('mayor', 'admin')
  ) or public.is_staff_admin(p_uid);
$$;

create or replace function public._department_label(p_department_key text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_department_key, '')))
    when 'finance' then 'Department of Finance'
    when 'police' then 'NYPD'
    when 'public_works' then 'Department of Public Works'
    when 'parks' then 'Department of Parks & Recreation'
    when 'planning' then 'Department of City Planning'
    else initcap(replace(coalesce(p_department_key, 'department'), '_', ' '))
  end;
$$;

-- ---------- Appoint / remove department heads ----------

create or replace function public.mayor_appoint_department_head(
  p_department text,
  p_sim_politician_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  dept text := lower(trim(coalesce(p_department, '')));
  sp record;
  prior_name text;
  report_body text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._mayor_may_act(v_uid) then
    raise exception 'Only the mayor may appoint department heads';
  end if;
  if dept not in ('finance', 'police', 'public_works', 'parks', 'planning') then
    raise exception 'Invalid department';
  end if;

  select * into sp
  from public.sim_politicians
  where id = p_sim_politician_id and office = 'department_head';
  if sp.id is null then
    raise exception 'Candidate must be a department-head NPC';
  end if;

  if exists (
    select 1 from public.city_department_heads h
    where h.sim_politician_id = p_sim_politician_id
      and h.department_key <> dept
  ) then
    raise exception 'That official already leads another department';
  end if;

  select sp2.character_name into prior_name
  from public.city_department_heads h
  left join public.sim_politicians sp2 on sp2.id = h.sim_politician_id
  where h.department_key = dept;

  insert into public.city_department_heads (department_key, sim_politician_id, appointed_by, appointed_at)
  values (dept, p_sim_politician_id, v_uid, now())
  on conflict (department_key) do update set
    sim_politician_id = excluded.sim_politician_id,
    appointed_by = excluded.appointed_by,
    appointed_at = excluded.appointed_at;

  delete from public.sim_government_role_grants g where g.role_key = 'dept_' || dept;
  insert into public.sim_government_role_grants (sim_politician_id, role_key)
  values (p_sim_politician_id, 'dept_' || dept)
  on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

  report_body := format(
    'Mayoral appointment: %s will lead %s effective immediately.',
    sp.character_name,
    public._department_label(dept)
  );
  if prior_name is not null and prior_name <> sp.character_name then
    report_body := report_body || format(' Replaces %s.', prior_name);
  end if;

  insert into public.city_department_reports (
    department_key, sim_politician_id, title, body, report_kind
  ) values (
    dept,
    p_sim_politician_id,
    format('Appointment — %s', sp.character_name),
    report_body,
    'appointment'
  );

  return jsonb_build_object('ok', true, 'department', dept, 'sim_id', p_sim_politician_id);
end;
$$;

create or replace function public.mayor_remove_department_head(p_department text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  dept text := lower(trim(coalesce(p_department, '')));
  head record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._mayor_may_act(v_uid) then
    raise exception 'Only the mayor may remove department heads';
  end if;
  if dept not in ('finance', 'police', 'public_works', 'parks', 'planning') then
    raise exception 'Invalid department';
  end if;

  select h.sim_politician_id, sp.character_name
  into head
  from public.city_department_heads h
  left join public.sim_politicians sp on sp.id = h.sim_politician_id
  where h.department_key = dept;

  if head.sim_politician_id is null then
    raise exception 'Department already vacant';
  end if;

  update public.city_department_heads
  set
    sim_politician_id = null,
    appointed_by = null,
    appointed_at = null
  where department_key = dept;

  delete from public.sim_government_role_grants g where g.role_key = 'dept_' || dept;

  insert into public.city_department_reports (
    department_key, sim_politician_id, title, body, report_kind
  ) values (
    dept,
    null,
    format('Vacancy — %s', public._department_label(dept)),
    format(
      '%s has been removed as head of %s. The position is vacant pending mayoral appointment. Routine directives and implementation memos for this agency are paused until a commissioner is seated.',
      head.character_name,
      public._department_label(dept)
    ),
    'vacancy'
  );

  return jsonb_build_object('ok', true, 'department', dept, 'removed', head.character_name);
end;
$$;

-- ---------- Public statement ----------

create or replace function public.mayor_issue_public_statement(
  p_body text,
  p_template_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  body text := trim(coalesce(p_body, ''));
  stmt_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._mayor_may_act(v_uid) then
    raise exception 'Only the mayor may issue public statements';
  end if;
  if body = '' then raise exception 'Statement text is required'; end if;
  if char_length(body) > 4000 then raise exception 'Statement too long (max 4000 characters)'; end if;

  insert into public.city_mayor_public_statements (issued_by, template_key, body)
  values (v_uid, nullif(trim(coalesce(p_template_key, '')), ''), body)
  returning id into stmt_id;

  return jsonb_build_object('ok', true, 'statement_id', stmt_id);
end;
$$;

-- ---------- Executive order (flavor only) ----------

create or replace function public.mayor_issue_executive_order(
  p_title text,
  p_body text,
  p_template_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  title text := trim(coalesce(p_title, ''));
  body text := trim(coalesce(p_body, ''));
  eo_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._mayor_may_act(v_uid) then
    raise exception 'Only the mayor may issue executive orders';
  end if;
  if title = '' then raise exception 'Executive order title is required'; end if;
  if body = '' then raise exception 'Executive order body is required'; end if;
  if char_length(title) > 200 then raise exception 'Title too long (max 200 characters)'; end if;
  if char_length(body) > 8000 then raise exception 'Body too long (max 8000 characters)'; end if;

  insert into public.city_mayor_executive_orders (issued_by, title, body, template_key)
  values (v_uid, title, body, nullif(trim(coalesce(p_template_key, '')), ''))
  returning id into eo_id;

  return jsonb_build_object('ok', true, 'order_id', eo_id);
end;
$$;

grant execute on function public.mayor_appoint_department_head(text, uuid) to authenticated;
grant execute on function public.mayor_remove_department_head(text) to authenticated;
grant execute on function public.mayor_issue_public_statement(text, text) to authenticated;
grant execute on function public.mayor_issue_executive_order(text, text, text) to authenticated;

notify pgrst, 'reload schema';
