-- Baseline wire events: disable cabinet-only templates, add public/admin spawn paths,
-- and staff tick that bypasses the once-per-real-day gate for manual sim pacing.

update public.simulation_event_templates
set enabled = false, spawn_weight = 0
where template_key in ('diplomatic_flashpoint', 'treasury_cash_crunch', 'defense_readiness');

insert into public.simulation_event_templates (template_key, title, summary, category, default_hours, spawn_weight, enabled)
values
  (
    'capitol_agenda',
    'Capitol agenda pressure',
    'Leadership expects visible floor activity before the window closes. Members who engage on legislation or votes show the chamber is working.',
    'congress',
    24,
    18,
    true
  ),
  (
    'trail_watch',
    'Trail watch',
    'National press is tracking movement on active campaigns. Candidates who show up on the trail before narratives harden keep momentum.',
    'campaign',
    20,
    16,
    true
  ),
  (
    'wire_bulletin',
    'Wire bulletin',
    'A developing story is moving through the Imperium wire. Watch the feed for updates as players respond.',
    'executive',
    48,
    8,
    true
  )
on conflict (template_key) do update set
  title = excluded.title,
  summary = excluded.summary,
  category = excluded.category,
  default_hours = excluded.default_hours,
  spawn_weight = excluded.spawn_weight,
  enabled = excluded.enabled;

create or replace function public._simulation_event_spawn_one(
  p_today date default (timezone('UTC', now()))::date,
  p_template_key text default null
)
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
  allow_public_only boolean := false;
  tkey text := nullif(trim(coalesce(p_template_key, '')), '');
begin
  if (select count(*) from public.simulation_event_instances where status = 'active') >= 6 then
    return null;
  end if;

  if tkey is not null then
    select t.* into tpl from public.simulation_event_templates t
    where t.template_key = tkey and t.enabled;
  else
    select t.*
      into tpl
      from public.simulation_event_templates t
      where t.enabled
      order by (-ln(random())) / greatest(t.spawn_weight, 1)
      limit 1;
  end if;

  if not found then
    return null;
  end if;

  allow_public_only := tpl.template_key = 'wire_bulletin';
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
    if assignee is null then
      assignee := president_uid;
    end if;
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, case when assignee = president_uid then 'President' else 'Secretary of State' end, true);
    end if;
  elsif tpl.template_key = 'treasury_cash_crunch' then
    assignee := coalesce(
      public._simulation_event_holder_for_role('secretary_of_treasury'),
      president_uid
    );
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, case when assignee = president_uid then 'President' else 'Secretary of the Treasury' end, true);
    end if;
  elsif tpl.template_key = 'defense_readiness' then
    assignee := coalesce(
      public._simulation_event_holder_for_role('secretary_of_defense'),
      president_uid
    );
    if assignee is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, assignee, case when assignee = president_uid then 'President' else 'Secretary of Defense' end, true);
    end if;
  elsif tpl.template_key = 'constituent_pressure' or tpl.template_key = 'capitol_agenda' then
    for congress_member in
      select u.uid
      from (
        select distinct s.uid
        from (
          select g.user_id as uid
          from public.government_role_grants g
          where g.role_key in ('representative', 'senator')
          union
          select p.id as uid from public.profiles p
          where p.office_role in ('representative', 'senator')
        ) s
      ) u
      order by random()
      limit case when tpl.template_key = 'capitol_agenda' then 12 else 6 end
    loop
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (inst_id, congress_member.uid, 'Member of Congress', true);
      perform public._simulation_event_inbox(
        congress_member.uid, inst_id, tpl.title,
        'The wire is tracking Capitol activity. Vote, file, or engage before the window closes.',
        'sim_evt_' || inst_id::text || '_' || congress_member.uid::text
      );
      picked := picked + 1;
    end loop;
  elsif tpl.template_key = 'campaign_scrutiny' or tpl.template_key = 'trail_watch' then
    for cand in
      select c.uid
      from (
        select distinct ec.user_id as uid
        from public.election_candidates ec
        join public.elections e on e.id = ec.election_id
        where coalesce(ec.is_npc, false) = false
          and ec.user_id is not null
          and e.phase in ('primary', 'general')
      ) c
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
  elsif tpl.template_key = 'wire_bulletin' then
    null;
  end if;

  if not allow_public_only and not exists (select 1 from public.simulation_event_assignments a where a.instance_id = inst_id) then
    delete from public.simulation_event_instances where id = inst_id;
    return null;
  end if;

  return inst_id;
end;
$$;

create or replace function public._wire_events_tick_body(p_today date, p_spawn_if_low boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  assign record;
  primary_done boolean;
  primary_choice text;
  missed int := 0;
  spawned uuid;
  active_after int;
begin
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

    if not exists (select 1 from public.simulation_event_assignments a where a.instance_id = inst.id) then
      update public.simulation_event_instances
      set status = 'resolved', resolved_at = now(), outcome = 'Story cycle closed on the wire.'
      where id = inst.id;
    elsif primary_done and primary_choice in ('strong', 'steady') then
      update public.simulation_event_instances
      set status = 'resolved', resolved_at = now(), outcome = 'Handled competently.'
      where id = inst.id;
    elsif primary_done and primary_choice in ('weak', 'delay') then
      update public.simulation_event_instances
      set status = 'escalated', resolved_at = now(), outcome = 'Partial response; story is still bleeding.',
          severity = least(5, inst.severity + 1)
      where id = inst.id;
    else
      update public.simulation_event_instances
      set status = 'failed', resolved_at = now(), outcome = 'No timely leadership response.',
          severity = least(5, inst.severity + 2)
      where id = inst.id;
    end if;
  end loop;

  select count(*)::int into active_after
  from public.simulation_event_instances where status = 'active';

  if p_spawn_if_low and active_after < 2 then
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

create or replace function public.rp_simulation_events_daily_tick(p_today date default (timezone('UTC', now()))::date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.rp_daily_counters
  set last_day = p_today
  where key = 'simulation_events' and last_day < p_today;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('skipped', true, 'reason', 'already_tick_today');
  end if;

  return public._wire_events_tick_body(p_today, true);
end;
$$;

create or replace function public.admin_wire_events_tick(p_force boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p_today date := (timezone('UTC', now()))::date;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  if not coalesce(p_force, true) then
    return public.rp_simulation_events_daily_tick(p_today);
  end if;

  update public.rp_daily_counters
  set last_day = p_today
  where key = 'simulation_events';

  return public._wire_events_tick_body(p_today, true);
end;
$$;

create or replace function public.admin_spawn_wire_event(
  p_template_key text default null,
  p_title text default null,
  p_summary text default null,
  p_hours int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  inst_id uuid;
  deadline timestamptz;
  spawned uuid;
  tkey text := nullif(trim(coalesce(p_template_key, '')), '');
  custom_title text := nullif(trim(coalesce(p_title, '')), '');
  custom_summary text := nullif(trim(coalesce(p_summary, '')), '');
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  if (select count(*) from public.simulation_event_instances where status = 'active') >= 6 then
    raise exception 'Too many active wire stories (max 6). Resolve or wait for deadlines first.';
  end if;

  if custom_title is not null and custom_summary is not null then
    deadline := now() + make_interval(hours => greatest(4, least(72, coalesce(p_hours, 24))));
    insert into public.simulation_event_instances (
      template_key, title, summary, deadline_at, metadata
    ) values (
      coalesce(tkey, 'wire_bulletin'),
      custom_title,
      custom_summary,
      deadline,
      jsonb_build_object('admin_spawned', true, 'spawned_by', auth.uid())
    )
    returning id into inst_id;
    spawned := inst_id;
  elsif tkey is not null then
    spawned := public._simulation_event_spawn_one((timezone('UTC', now()))::date, tkey);
    if spawned is null then
      raise exception 'Could not spawn template % — no eligible assignees or too many active stories.', tkey;
    end if;
  else
    spawned := public._simulation_event_spawn_one((timezone('UTC', now()))::date);
    if spawned is null then
      raise exception 'Could not spawn event — no eligible template or assignees.';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'instance_id', spawned);
end;
$$;

revoke all on function public.admin_wire_events_tick(boolean) from public;
revoke all on function public.admin_spawn_wire_event(text, text, text, int) from public;

grant execute on function public.admin_wire_events_tick(boolean) to authenticated;
grant execute on function public.admin_spawn_wire_event(text, text, text, int) to authenticated;

notify pgrst, 'reload schema';
