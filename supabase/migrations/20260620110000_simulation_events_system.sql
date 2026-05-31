-- Daily simulation events: assign players/cabinet to respond; miss deadlines → penalties; poor choices escalate.

create type public.simulation_event_status as enum ('active', 'resolved', 'escalated', 'failed');

create table public.simulation_event_templates (
  template_key text primary key,
  title text not null,
  summary text not null,
  category text not null check (category in ('executive', 'cabinet', 'congress', 'campaign', 'economy')),
  default_hours int not null default 24 check (default_hours between 4 and 72),
  spawn_weight int not null default 10 check (spawn_weight >= 0),
  enabled boolean not null default true
);

create table public.simulation_event_instances (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.simulation_event_templates (template_key),
  title text not null,
  summary text not null,
  status public.simulation_event_status not null default 'active',
  severity int not null default 1 check (severity between 1 and 5),
  rp_day_utc date not null default (timezone('UTC', now()))::date,
  opened_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  resolved_at timestamptz,
  outcome text,
  metadata jsonb not null default '{}'::jsonb
);

create index simulation_event_instances_status_deadline_idx
  on public.simulation_event_instances (status, deadline_at);

create table public.simulation_event_assignments (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.simulation_event_instances (id) on delete cascade,
  assignee_user_id uuid not null references auth.users (id) on delete cascade,
  role_label text not null,
  is_primary boolean not null default false,
  completed_at timestamptz,
  response_key text,
  unique (instance_id, assignee_user_id)
);

create index simulation_event_assignments_user_open_idx
  on public.simulation_event_assignments (assignee_user_id, completed_at)
  where completed_at is null;

alter table public.simulation_event_templates enable row level security;
alter table public.simulation_event_instances enable row level security;
alter table public.simulation_event_assignments enable row level security;

create policy "simulation_event_templates read authed"
  on public.simulation_event_templates for select to authenticated using (true);

create policy "simulation_event_instances read authed"
  on public.simulation_event_instances for select to authenticated using (true);

create policy "simulation_event_assignments read own or staff"
  on public.simulation_event_assignments for select to authenticated
  using (assignee_user_id = auth.uid() or public.is_staff_admin(auth.uid()));

insert into public.rp_daily_counters (key, last_day)
values ('simulation_events', '1970-01-01'::date)
on conflict (key) do nothing;

insert into public.simulation_event_templates (template_key, title, summary, category, default_hours, spawn_weight) values
  (
    'diplomatic_flashpoint',
    'Diplomatic flashpoint',
    'A partner nation is pushing a crisis communique. State must respond before relations crater; the White House can steer the outcome.',
    'cabinet',
    24,
    14
  ),
  (
    'treasury_cash_crunch',
    'Treasury cash crunch',
    'Outlays are outpacing receipts this cycle. Treasury needs a posture; the President sets whether to hold the line or absorb political heat.',
    'economy',
    24,
    12
  ),
  (
    'defense_readiness',
    'Defense readiness review',
    'Joint staff flagged a readiness gap. Defense must brief and commit to a posture before the story leaks.',
    'cabinet',
    20,
    12
  ),
  (
    'constituent_pressure',
    'Constituent pressure wave',
    'District offices report a surge of angry mail. Members need to show they are on the floor and answering mail.',
    'congress',
    18,
    16
  ),
  (
    'campaign_scrutiny',
    'Campaign scrutiny',
    'Press is circling active campaigns. Candidates must show movement on the trail before narratives harden.',
    'campaign',
    18,
    14
  )
on conflict (template_key) do nothing;

-- Resolve assignee for a cabinet role_key (grant or legacy office_role).
create or replace function public._simulation_event_holder_for_role(p_role text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select g.user_id from public.government_role_grants g where g.role_key = p_role limit 1),
    (select p.id from public.profiles p where p.office_role = p_role limit 1)
  );
$$;

create or replace function public._simulation_event_inbox(
  p_user_id uuid,
  p_instance_id uuid,
  p_title text,
  p_body text,
  p_dedupe text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (p_user_id, 'simulation_event', p_title, p_body, '/events', p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

create or replace function public._simulation_event_spawn_one(p_today date default (timezone('UTC', now()))::date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  inst_id uuid;
  deadline timestamptz;
  president_uid uuid;
  assignee uuid;
  congress_member record;
  cand record;
  picked int := 0;
begin
  if (select count(*) from public.simulation_event_instances where status = 'active') >= 4 then
    return null;
  end if;

  select t.*
    into tpl
    from public.simulation_event_templates t
    where t.enabled
    order by (-ln(random())) / greatest(t.spawn_weight, 1)
    limit 1;

  if not found then
    return null;
  end if;

  deadline := now() + make_interval(hours => tpl.default_hours);

  insert into public.simulation_event_instances (
    template_key, title, summary, deadline_at, metadata
  ) values (
    tpl.template_key,
    tpl.title,
    tpl.summary,
    deadline,
    jsonb_build_object('spawn_day', p_today)
  )
  returning id into inst_id;

  president_uid := public._simulation_event_holder_for_role('president');

  if tpl.template_key = 'diplomatic_flashpoint' then
    assignee := public._simulation_event_holder_for_role('secretary_of_state');
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, 'Secretary of State', true);
      perform public._simulation_event_inbox(
        assignee, inst_id, tpl.title,
        'Respond before the deadline or relations and your approval will suffer.',
        'sim_evt_' || inst_id::text || '_state'
      );
    end if;
    if president_uid is not null and president_uid is distinct from assignee then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, president_uid, 'President (oversight)', false);
      perform public._simulation_event_inbox(
        president_uid, inst_id, tpl.title,
        'Cabinet is handling a diplomatic flashpoint. Your call can resolve or escalate it.',
        'sim_evt_' || inst_id::text || '_potus'
      );
    end if;
  elsif tpl.template_key = 'treasury_cash_crunch' then
    assignee := public._simulation_event_holder_for_role('secretary_of_treasury');
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, 'Secretary of the Treasury', true);
      perform public._simulation_event_inbox(assignee, inst_id, tpl.title, 'Treasury needs your call today.', 'sim_evt_' || inst_id::text || '_treasury');
    end if;
    if president_uid is not null and president_uid is distinct from assignee then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, president_uid, 'President', false);
      perform public._simulation_event_inbox(
        president_uid, inst_id, tpl.title,
        'Treasury needs a White House steer on the cash crunch.',
        'sim_evt_' || inst_id::text || '_potus_treasury'
      );
    end if;
  elsif tpl.template_key = 'defense_readiness' then
    assignee := public._simulation_event_holder_for_role('secretary_of_defense');
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, 'Secretary of Defense', true);
      perform public._simulation_event_inbox(assignee, inst_id, tpl.title, 'Defense readiness review is due.', 'sim_evt_' || inst_id::text || '_defense');
    end if;
  elsif tpl.template_key = 'constituent_pressure' then
    for congress_member in
      select distinct uid from (
        select g.user_id as uid
        from public.government_role_grants g
        where g.role_key in ('representative', 'senator')
        union
        select p.id as uid from public.profiles p
        where p.office_role in ('representative', 'senator')
      ) s
      order by random()
      limit 6
    loop
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, congress_member.uid, 'Member of Congress', true);
      perform public._simulation_event_inbox(
        congress_member.uid, inst_id, tpl.title,
        'Constituents expect action. Vote or engage before the window closes.',
        'sim_evt_' || inst_id::text || '_' || congress_member.uid::text
      );
      picked := picked + 1;
    end loop;
  elsif tpl.template_key = 'campaign_scrutiny' then
    for cand in
      select distinct ec.user_id as uid
      from public.election_candidates ec
      join public.elections e on e.id = ec.election_id
      where coalesce(ec.is_npc, false) = false
        and ec.user_id is not null
        and e.phase in ('primary', 'general')
      order by random()
      limit 8
    loop
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, cand.uid, 'Candidate', true);
      perform public._simulation_event_inbox(
        cand.uid, inst_id, tpl.title,
        'Press is watching your race. Campaign on the trail today.',
        'sim_evt_' || inst_id::text || '_' || cand.uid::text
      );
      picked := picked + 1;
    end loop;
  end if;

  if not exists (select 1 from public.simulation_event_assignments a where a.instance_id = inst_id) then
    delete from public.simulation_event_instances where id = inst_id;
    return null;
  end if;

  return inst_id;
end;
$$;

create or replace function public.rp_simulation_events_daily_tick(p_today date default (timezone('UTC', now()))::date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  inst record;
  assign record;
  primary_done boolean;
  primary_choice text;
  missed int := 0;
  spawned uuid;
  active_after int;
begin
  update public.rp_daily_counters
  set last_day = p_today
  where key = 'simulation_events' and last_day < p_today;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('skipped', true, 'reason', 'already_tick_today');
  end if;

  for inst in
    select i.*
    from public.simulation_event_instances i
    where i.status = 'active' and i.deadline_at < now()
  loop
    for assign in
      select a.* from public.simulation_event_assignments a where a.instance_id = inst.id
    loop
      if assign.completed_at is null then
        perform public.apply_profile_approval_delta(
          assign.assignee_user_id,
          case when assign.is_primary then -4 else -2 end,
          'Missed simulation event: ' || inst.title
        );
        missed := missed + 1;
        perform public._simulation_event_inbox(
          assign.assignee_user_id,
          inst.id,
          'Event missed: ' || inst.title,
          'You did not respond before the deadline. Approval took a hit.',
          'sim_evt_missed_' || inst.id::text || '_' || assign.assignee_user_id::text
        );
      end if;
    end loop;

    select exists (
      select 1 from public.simulation_event_assignments a
      where a.instance_id = inst.id and a.is_primary and a.completed_at is not null
    ),
    (
      select a.response_key from public.simulation_event_assignments a
      where a.instance_id = inst.id and a.is_primary and a.completed_at is not null
      order by a.completed_at desc limit 1
    )
    into primary_done, primary_choice;

    if primary_done and primary_choice in ('strong', 'steady') then
      update public.simulation_event_instances
      set status = 'resolved', resolved_at = now(), outcome = 'Handled competently.'
      where id = inst.id;
    elsif primary_done and primary_choice in ('weak', 'delay') then
      update public.simulation_event_instances
      set status = 'escalated', resolved_at = now(), outcome = 'Partial response; story is still bleeding.',
          severity = least(5, inst.severity + 1)
      where id = inst.id;
      update public.national_metrics nm
      set government_approval = greatest(0, coalesce(nm.government_approval, 50) - 2),
          updated_at = now()
      from public.rp_fiscal_years fy
      where fy.status = 'active' and nm.fiscal_year_id = fy.id;
    else
      update public.simulation_event_instances
      set status = 'failed', resolved_at = now(), outcome = 'No timely leadership response.',
          severity = least(5, inst.severity + 2)
      where id = inst.id;
      update public.national_metrics nm
      set government_approval = greatest(0, coalesce(nm.government_approval, 50) - 4),
          updated_at = now()
      from public.rp_fiscal_years fy
      where fy.status = 'active' and nm.fiscal_year_id = fy.id;
    end if;
  end loop;

  select count(*)::int into active_after
  from public.simulation_event_instances where status = 'active';

  if active_after < 2 then
    spawned := public._simulation_event_spawn_one(p_today);
  end if;

  return jsonb_build_object(
    'ok', true,
    'missed_penalties', missed,
    'spawned', spawned,
    'active', (select count(*) from public.simulation_event_instances where status = 'active')
  );
end;
$$;

create or replace function public.respond_simulation_event(
  p_instance_id uuid,
  p_choice_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  assign_id uuid;
  choice text := lower(trim(coalesce(p_choice_key, '')));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if choice not in ('strong', 'steady', 'weak', 'delay') then
    raise exception 'Invalid response';
  end if;

  select i.* into inst
  from public.simulation_event_instances i
  where i.id = p_instance_id and i.status = 'active';
  if not found then
    raise exception 'Event not active';
  end if;
  if inst.deadline_at < now() then
    raise exception 'Deadline passed';
  end if;

  update public.simulation_event_assignments a
  set completed_at = now(), response_key = choice
  where a.instance_id = p_instance_id
    and a.assignee_user_id = auth.uid()
    and a.completed_at is null
  returning a.id into assign_id;

  if assign_id is null then
    raise exception 'You are not assigned to this event';
  end if;

  if choice in ('strong', 'steady') then
    perform public.apply_profile_approval_delta(auth.uid(), 1, 'Handled event: ' || inst.title);
  elsif choice in ('weak', 'delay') then
    perform public.apply_profile_approval_delta(auth.uid(), -2, 'Weak event response: ' || inst.title);
  end if;

  if exists (
    select 1 from public.simulation_event_assignments a
    where a.instance_id = p_instance_id and a.is_primary and a.completed_at is not null
  ) and not exists (
    select 1 from public.simulation_event_assignments a
    where a.instance_id = p_instance_id and a.is_primary and a.completed_at is null
  ) then
    if choice in ('strong', 'steady') then
      update public.simulation_event_instances
      set status = 'resolved', resolved_at = now(), outcome = 'Primary assignee closed the loop.'
      where id = p_instance_id;
    else
      update public.simulation_event_instances
      set status = 'escalated', resolved_at = now(), outcome = 'Primary response was too weak.',
          severity = least(5, inst.severity + 1)
      where id = p_instance_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'choice', choice);
end;
$$;

revoke all on function public.rp_simulation_events_daily_tick(date) from public;
revoke all on function public.respond_simulation_event(uuid, text) from public;
revoke all on function public._simulation_event_spawn_one(date) from public;

grant execute on function public.rp_simulation_events_daily_tick(date) to service_role;
grant execute on function public.respond_simulation_event(uuid, text) to authenticated;
grant execute on function public.rp_simulation_events_daily_tick(date) to authenticated;

notify pgrst, 'reload schema';
