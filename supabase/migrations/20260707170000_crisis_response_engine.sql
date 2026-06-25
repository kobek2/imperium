-- Crisis response engine: player-authored instruments (EO, statements, bills) tied to news arcs.

create type public.crisis_instrument as enum (
  'executive_order',
  'presidential_statement',
  'letter_to_congress',
  'bill_filed',
  'bill_enacted'
);

create table public.simulation_event_responses (
  id uuid primary key default gen_random_uuid(),
  story_arc_id uuid not null,
  instance_id uuid references public.simulation_event_instances (id) on delete set null,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  instrument public.crisis_instrument not null,
  intent_tag text,
  document_table text not null,
  document_id uuid not null,
  created_at timestamptz not null default now()
);

create index simulation_event_responses_arc_idx
  on public.simulation_event_responses (story_arc_id, created_at desc);

create index simulation_event_responses_instrument_idx
  on public.simulation_event_responses (story_arc_id, instrument);

alter table public.simulation_event_responses enable row level security;

create policy "simulation_event_responses read authed"
  on public.simulation_event_responses for select to authenticated using (true);

create table public.presidential_statements (
  id uuid primary key default gen_random_uuid(),
  issued_by uuid not null references public.profiles (id) on delete restrict,
  story_arc_id uuid,
  kind text not null check (kind in ('address', 'letter_to_congress')),
  title text not null,
  body text not null,
  signature_captured text not null,
  created_at timestamptz not null default now(),
  constraint presidential_statements_title_len check (char_length(title) <= 300),
  constraint presidential_statements_body_len check (char_length(body) between 1 and 8000)
);

create index presidential_statements_arc_idx on public.presidential_statements (story_arc_id, created_at desc);

alter table public.presidential_statements enable row level security;

create policy "presidential_statements select authenticated"
  on public.presidential_statements for select to authenticated using (true);

alter table public.executive_orders
  add column if not exists story_arc_id uuid;

alter table public.bills
  add column if not exists crisis_story_arc_id uuid;

alter table public.simulation_event_templates
  add column if not exists crisis_trigger_instrument text,
  add column if not exists crisis_trigger_timeout boolean not null default false;

-- News starters: president leads; follow-ups keyed by instrument or timeout.
update public.simulation_event_templates
set assignment_mode = 'executive'
where template_key like 'news_%' and is_starter = true;

update public.simulation_event_templates
set crisis_trigger_instrument = 'executive_order'
where template_key in (
  'news_border_surge_congress',
  'news_capital_shooting_manifesto',
  'news_grid_cyberattack_restore',
  'news_healthcare_strike_deal',
  'news_taiwan_strait_sanctions',
  'news_taiwan_strait_diplomacy'
);

update public.simulation_event_templates
set crisis_trigger_timeout = true
where template_key in (
  'news_hostage_ransom',
  'news_border_surge_protests'
);

insert into public.rp_daily_counters (key, last_day)
values ('newsroom_spawn', '1970-01-01'::date)
on conflict (key) do nothing;

-- ---------- Crisis helpers ----------
create or replace function public._crisis_active_instance(p_story_arc_id uuid)
returns public.simulation_event_instances
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.simulation_event_instances i
  where i.story_arc_id = p_story_arc_id
    and i.status = 'active'
  order by i.beat_number desc, i.opened_at desc
  limit 1;
$$;

create or replace function public._crisis_starter_template_key(p_story_arc_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select i.template_key
  from public.simulation_event_instances i
  where i.story_arc_id = p_story_arc_id
    and i.beat_number = 1
  order by i.opened_at asc
  limit 1;
$$;

create or replace function public._wire_assign_for_template(p_instance_id uuid, p_template_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  tpl_title text;
  congress_member record;
  cand record;
  president_uid uuid;
  assignee uuid;
begin
  select t.* into tpl from public.simulation_event_templates t where t.template_key = p_template_key;
  if not found then
    return;
  end if;

  select i.title into tpl_title from public.simulation_event_instances i where i.id = p_instance_id;
  president_uid := public._simulation_event_holder_for_role('president');

  if tpl.assignment_mode = 'executive' or p_template_key like 'news_%' then
    if president_uid is not null then
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (p_instance_id, president_uid, 'President', true)
      on conflict (instance_id, assignee_user_id) do nothing;
      perform public._simulation_event_inbox(
        president_uid, p_instance_id, tpl_title,
        'Crisis on the wire — issue an executive order, address the nation, or direct Congress before the deadline.',
        'sim_evt_' || p_instance_id::text || '_potus'
      );
    end if;
    if tpl.category = 'international' then
      assignee := public._simulation_event_holder_for_role('secretary_of_state');
      if assignee is not null and assignee is distinct from president_uid then
        insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
        values (p_instance_id, assignee, 'Secretary of State', false)
        on conflict (instance_id, assignee_user_id) do nothing;
      end if;
    end if;
    if tpl.category = 'domestic' then
      for congress_member in
        select u.uid
        from (
          select distinct s.uid
          from (
            select g.user_id as uid from public.government_role_grants g
            where g.role_key in ('representative', 'senator')
            union
            select p.id as uid from public.profiles p
            where p.office_role in ('representative', 'senator')
          ) s
        ) u
        order by random()
        limit 8
      loop
        insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
        values (p_instance_id, congress_member.uid, 'Member of Congress', false)
        on conflict (instance_id, assignee_user_id) do nothing;
        perform public._simulation_event_inbox(
          congress_member.uid, p_instance_id, tpl_title,
          'Congress may file emergency legislation in response to this crisis.',
          'sim_evt_' || p_instance_id::text || '_' || congress_member.uid::text
        );
      end loop;
    end if;
    return;
  end if;

  if tpl.assignment_mode = 'none' then
    return;
  end if;

  if tpl.assignment_mode = 'congress' then
    for congress_member in
      select u.uid
      from (
        select distinct s.uid
        from (
          select g.user_id as uid from public.government_role_grants g
          where g.role_key in ('representative', 'senator')
          union
          select p.id as uid from public.profiles p
          where p.office_role in ('representative', 'senator')
        ) s
      ) u
      order by random()
      limit 8
    loop
      insert into public.simulation_event_assignments (instance_id, assignee_user_id, role_label, is_primary)
      values (p_instance_id, congress_member.uid, 'Member of Congress', true)
      on conflict (instance_id, assignee_user_id) do nothing;
    end loop;
  elsif tpl.assignment_mode = 'campaign' then
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
      values (p_instance_id, cand.uid, 'Candidate', true)
      on conflict (instance_id, assignee_user_id) do nothing;
    end loop;
  end if;
end;
$$;

create or replace function public._crisis_auto_publish_beat(
  p_parent_instance_id uuid,
  p_template_key text,
  p_beat_label text default 'developing'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  parent_row record;
  inst_id uuid;
  arc_id uuid;
  beat int;
  label text := coalesce(nullif(trim(p_beat_label), ''), 'developing');
begin
  select t.* into tpl
  from public.simulation_event_templates t
  where t.template_key = p_template_key and t.enabled;
  if not found then
    return null;
  end if;

  select i.* into parent_row
  from public.simulation_event_instances i
  where i.id = p_parent_instance_id;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from public.simulation_event_instances i
    where i.story_arc_id = parent_row.story_arc_id
      and i.template_key = p_template_key
  ) then
    return null;
  end if;

  arc_id := parent_row.story_arc_id;
  select coalesce(max(i.beat_number), 0) + 1 into beat
  from public.simulation_event_instances i
  where i.story_arc_id = arc_id;

  insert into public.simulation_event_instances (
    template_key, title, summary, body, dateline,
    deadline_at, severity, story_arc_id, parent_instance_id, beat_number, beat_label, metadata
  ) values (
    tpl.template_key,
    tpl.title,
    tpl.summary,
    tpl.body,
    tpl.dateline,
    now() + make_interval(hours => greatest(4, least(72, tpl.default_hours))),
    tpl.default_severity,
    arc_id,
    p_parent_instance_id,
    beat,
    label,
    jsonb_build_object(
      'auto_published', true,
      'topic', tpl.topic,
      'category', tpl.category
    )
  )
  returning id into inst_id;

  perform public._wire_assign_for_template(inst_id, tpl.template_key);

  update public.simulation_event_instances
  set status = 'active', resolved_at = null
  where story_arc_id = arc_id and status in ('resolved', 'escalated', 'failed');

  return inst_id;
end;
$$;

create or replace function public._crisis_evaluate_arc(p_story_arc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_inst public.simulation_event_instances;
  starter_key text;
  parent_beat_id uuid;
  latest_resp record;
  follow_tpl record;
  new_beat_id uuid;
  beat_count int;
begin
  active_inst := public._crisis_active_instance(p_story_arc_id);
  if active_inst.id is null then
    return;
  end if;

  starter_key := public._crisis_starter_template_key(p_story_arc_id);

  select i.id into parent_beat_id
  from public.simulation_event_instances i
  where i.story_arc_id = p_story_arc_id
  order by i.beat_number desc, i.opened_at desc
  limit 1;

  select r.* into latest_resp
  from public.simulation_event_responses r
  where r.story_arc_id = p_story_arc_id
  order by r.created_at desc
  limit 1;

  if latest_resp.id is not null then
    select t.* into follow_tpl
    from public.simulation_event_templates t
    where t.enabled
      and t.follow_up_of_template_key = starter_key
      and t.crisis_trigger_instrument = latest_resp.instrument::text
      and not exists (
        select 1 from public.simulation_event_instances i
        where i.story_arc_id = p_story_arc_id and i.template_key = t.template_key
      )
    order by t.default_severity desc
    limit 1;

    if follow_tpl.template_key is not null then
      new_beat_id := public._crisis_auto_publish_beat(parent_beat_id, follow_tpl.template_key, 'developing');
      if new_beat_id is not null then
        update public.simulation_event_instances
        set outcome = 'Administration and agencies move to implement the response.'
        where id = active_inst.id and status = 'active';
      end if;
    end if;

    if latest_resp.instrument = 'bill_enacted' then
      update public.simulation_event_instances
      set status = 'resolved',
          resolved_at = now(),
          outcome = 'Congress enacted legislation addressing the crisis.'
      where story_arc_id = p_story_arc_id and status = 'active';

      select count(*)::int into beat_count
      from public.simulation_event_instances i where i.story_arc_id = p_story_arc_id;

      if beat_count >= 2 then
        return;
      end if;
    elsif latest_resp.instrument in ('executive_order', 'presidential_statement', 'letter_to_congress') then
      update public.simulation_event_assignments a
      set completed_at = coalesce(a.completed_at, now())
      where a.instance_id = active_inst.id
        and a.is_primary
        and a.completed_at is null;
    end if;
  end if;
end;
$$;

create or replace function public.record_crisis_response(
  p_story_arc_id uuid,
  p_instrument public.crisis_instrument,
  p_document_table text,
  p_document_id uuid,
  p_actor_user_id uuid default auth.uid(),
  p_intent_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_inst public.simulation_event_instances;
  resp_id uuid;
  actor uuid := coalesce(p_actor_user_id, auth.uid());
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;

  active_inst := public._crisis_active_instance(p_story_arc_id);
  if active_inst.id is null then
    raise exception 'No active crisis on this story arc';
  end if;

  if not exists (
    select 1 from public.simulation_event_assignments a
    where a.instance_id in (
      select i.id from public.simulation_event_instances i where i.story_arc_id = p_story_arc_id
    )
    and a.assignee_user_id = actor
  ) and not public._user_is_acting_president(actor) then
    raise exception 'You are not assigned to this crisis';
  end if;

  insert into public.simulation_event_responses (
    story_arc_id, instance_id, actor_user_id, instrument, intent_tag, document_table, document_id
  ) values (
    p_story_arc_id, active_inst.id, actor, p_instrument, nullif(trim(coalesce(p_intent_tag, '')), ''),
    p_document_table, p_document_id
  )
  returning id into resp_id;

  update public.simulation_event_assignments a
  set completed_at = coalesce(a.completed_at, now())
  where a.instance_id = active_inst.id
    and a.assignee_user_id = actor
    and a.completed_at is null;

  perform public._crisis_evaluate_arc(p_story_arc_id);

  return resp_id;
end;
$$;

grant execute on function public.record_crisis_response(uuid, public.crisis_instrument, text, uuid, uuid, text) to authenticated;

-- ---------- Publish EO with optional crisis link ----------
create or replace function public.publish_executive_order(
  p_title text,
  p_body text,
  p_story_arc_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig text;
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_eo_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public._user_is_acting_president(auth.uid()) then
    raise exception 'Only the acting president may publish executive orders';
  end if;

  select trim(coalesce(presidential_signature, '')) into v_sig
  from public.profiles where id = auth.uid();

  if v_sig is null or char_length(v_sig) < 2 then
    raise exception 'Set your presidential signature on the Executive desk before publishing an executive order';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 300 then
    raise exception 'Title must be 1–300 characters';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 8000 then
    raise exception 'Body must be 1–8000 characters';
  end if;

  insert into public.executive_orders (issued_by, title, body, signature_captured, story_arc_id)
  values (auth.uid(), v_title, v_body, v_sig, p_story_arc_id)
  returning id into v_eo_id;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id, 'executive_order'::text, v_title, left(v_body, 400),
    '/oval/executive-orders/' || v_eo_id::text, 'eo:' || v_eo_id::text
  from public.profiles p;

  if p_story_arc_id is not null then
    perform public.record_crisis_response(
      p_story_arc_id, 'executive_order', 'executive_orders', v_eo_id, auth.uid(), null
    );
  end if;

  return v_eo_id;
end;
$$;

create or replace function public.publish_presidential_statement(
  p_title text,
  p_body text,
  p_kind text,
  p_story_arc_id uuid default null,
  p_intent_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig text;
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_stmt_id uuid;
  v_instrument public.crisis_instrument;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public._user_is_acting_president(auth.uid()) then
    raise exception 'Only the acting president may publish statements';
  end if;
  if v_kind not in ('address', 'letter_to_congress') then
    raise exception 'Invalid statement kind';
  end if;

  select trim(coalesce(presidential_signature, '')) into v_sig
  from public.profiles where id = auth.uid();

  if v_sig is null or char_length(v_sig) < 2 then
    raise exception 'Set your presidential signature before publishing';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 300 then
    raise exception 'Title must be 1–300 characters';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 8000 then
    raise exception 'Body must be 1–8000 characters';
  end if;

  v_instrument := case
    when v_kind = 'letter_to_congress' then 'letter_to_congress'::public.crisis_instrument
    else 'presidential_statement'::public.crisis_instrument
  end;

  insert into public.presidential_statements (
    issued_by, story_arc_id, kind, title, body, signature_captured
  ) values (auth.uid(), p_story_arc_id, v_kind, v_title, v_body, v_sig)
  returning id into v_stmt_id;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'executive_order'::text,
    case when v_kind = 'letter_to_congress' then 'Letter to Congress: ' else 'Presidential address: ' end || v_title,
    left(v_body, 400),
    '/events',
    'stmt:' || v_stmt_id::text
  from public.profiles p;

  if p_story_arc_id is not null then
    perform public.record_crisis_response(
      p_story_arc_id, v_instrument, 'presidential_statements', v_stmt_id, auth.uid(), p_intent_tag
    );
  end if;

  return v_stmt_id;
end;
$$;

grant execute on function public.publish_presidential_statement(text, text, text, uuid, text) to authenticated;

-- ---------- Daily newsroom spawn ----------
create or replace function public._newsroom_spawn_breaking_story(p_today date default (timezone('UTC', now()))::date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  inst_id uuid;
  arc_id uuid;
  active_news int;
begin
  select count(*)::int into active_news
  from public.simulation_event_instances i
  join public.simulation_event_templates t on t.template_key = i.template_key
  where i.status = 'active' and i.template_key like 'news_%';

  if active_news >= 2 then
    return null;
  end if;

  select t.* into tpl
  from public.simulation_event_templates t
  where t.enabled
    and t.is_starter = true
    and t.template_key like 'news_%'
    and not exists (
      select 1
      from public.simulation_event_instances i
      join public.simulation_event_instances i2 on i2.story_arc_id = i.story_arc_id and i2.beat_number = 1
      where i2.template_key = t.template_key
        and i.opened_at > now() - interval '14 days'
    )
  order by random()
  limit 1;

  if not found then
    select t.* into tpl
    from public.simulation_event_templates t
    where t.enabled and t.is_starter = true and t.template_key like 'news_%'
    order by random()
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  arc_id := gen_random_uuid();

  insert into public.simulation_event_instances (
    template_key, title, summary, body, dateline,
    deadline_at, severity, story_arc_id, beat_number, beat_label, metadata
  ) values (
    tpl.template_key,
    tpl.title,
    tpl.summary,
    tpl.body,
    tpl.dateline,
    now() + make_interval(hours => greatest(4, least(72, tpl.default_hours))),
    tpl.default_severity,
    arc_id,
    1,
    'breaking',
    jsonb_build_object(
      'auto_spawned', true,
      'spawn_day', p_today,
      'topic', tpl.topic,
      'category', tpl.category
    )
  )
  returning id into inst_id;

  perform public._wire_assign_for_template(inst_id, tpl.template_key);

  return inst_id;
end;
$$;

-- ---------- Crisis-aware wire tick ----------
create or replace function public._crisis_resolve_expired_arc(p_inst public.simulation_event_instances)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  starter_key text;
  parent_beat_id uuid;
  timeout_tpl record;
  has_primary_response boolean;
  assign record;
begin
  starter_key := public._crisis_starter_template_key(p_inst.story_arc_id);

  for assign in
    select a.* from public.simulation_event_assignments a where a.instance_id = p_inst.id
  loop
    if assign.completed_at is null and assign.is_primary then
      perform public.apply_profile_approval_delta(
        assign.assignee_user_id, -4, 'Missed crisis response: ' || p_inst.title
      );
    elsif assign.completed_at is null then
      perform public.apply_profile_approval_delta(
        assign.assignee_user_id, -1, 'No crisis engagement: ' || p_inst.title
      );
    end if;
  end loop;

  select exists (
    select 1 from public.simulation_event_responses r
    where r.story_arc_id = p_inst.story_arc_id
      and r.instrument in ('executive_order', 'presidential_statement', 'letter_to_congress', 'bill_enacted')
  ) into has_primary_response;

  select i.id into parent_beat_id
  from public.simulation_event_instances i
  where i.story_arc_id = p_inst.story_arc_id
  order by i.beat_number desc
  limit 1;

  if not has_primary_response and p_inst.template_key like 'news_%' then
    select t.* into timeout_tpl
    from public.simulation_event_templates t
    where t.enabled
      and t.crisis_trigger_timeout = true
      and t.follow_up_of_template_key = starter_key
      and not exists (
        select 1 from public.simulation_event_instances i
        where i.story_arc_id = p_inst.story_arc_id and i.template_key = t.template_key
      )
    order by t.default_severity desc
    limit 1;

    if timeout_tpl.template_key is not null then
      perform public._crisis_auto_publish_beat(parent_beat_id, timeout_tpl.template_key, 'escalation');
      update public.simulation_event_instances
      set status = 'escalated',
          resolved_at = now(),
          outcome = 'No timely presidential response; crisis escalates on the wire.',
          severity = least(5, p_inst.severity + 1)
      where id = p_inst.id;
      return;
    end if;
  end if;

  if has_primary_response then
    update public.simulation_event_instances
    set status = 'resolved',
        resolved_at = now(),
        outcome = coalesce(outcome, 'Crisis window closed after government action.')
    where id = p_inst.id;
  else
    update public.simulation_event_instances
    set status = 'failed',
        resolved_at = now(),
        outcome = 'No government response before deadline.',
        severity = least(5, p_inst.severity + 1)
    where id = p_inst.id;
  end if;
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
  missed int := 0;
  spawned uuid;
  news_spawned uuid;
  active_after int;
  v_n int;
begin
  for inst in
    select i.*
    from public.simulation_event_instances i
    where i.status = 'active' and i.deadline_at < now()
  loop
    if inst.story_arc_id is not null and inst.template_key like 'news_%' then
      perform public._crisis_resolve_expired_arc(inst);
    elsif not exists (select 1 from public.simulation_event_assignments a where a.instance_id = inst.id) then
      update public.simulation_event_instances
      set status = 'resolved', resolved_at = now(), outcome = 'Story cycle closed on the wire.'
      where id = inst.id;
    else
      update public.simulation_event_instances
      set status = 'failed', resolved_at = now(), outcome = 'No timely response.'
      where id = inst.id;
      missed := missed + 1;
    end if;
  end loop;

  update public.rp_daily_counters
  set last_day = p_today
  where key = 'newsroom_spawn' and last_day < p_today;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    news_spawned := public._newsroom_spawn_breaking_story(p_today);
  end if;

  select count(*)::int into active_after
  from public.simulation_event_instances where status = 'active';

  if p_spawn_if_low and active_after < 2 then
    spawned := public._simulation_event_spawn_one(p_today);
  end if;

  return jsonb_build_object(
    'ok', true,
    'missed_penalties', missed,
    'spawned', spawned,
    'news_spawned', news_spawned,
    'active', active_after
  );
end;
$$;

-- Bill filing / enactment hooks
create or replace function public._bills_crisis_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.crisis_story_arc_id is not null then
    perform public.record_crisis_response(
      new.crisis_story_arc_id,
      'bill_filed',
      'bills',
      new.id,
      new.author_id,
      null
    );
  end if;

  if tg_op = 'UPDATE'
    and new.status = 'law'
    and old.status is distinct from 'law'
    and new.crisis_story_arc_id is not null then
    perform public.record_crisis_response(
      new.crisis_story_arc_id,
      'bill_enacted',
      'bills',
      new.id,
      coalesce(auth.uid(), new.author_id),
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists bills_crisis_response_trg on public.bills;
create trigger bills_crisis_response_trg
  after insert or update of status on public.bills
  for each row execute function public._bills_crisis_on_change();

notify pgrst, 'reload schema';
