-- AI-generated crisis follow-ups: dynamic wire beats keyed to player-authored documents.

insert into public.simulation_event_templates (
  template_key, title, summary, category, topic, default_hours, spawn_weight, enabled,
  is_starter, assignment_mode, default_severity
) values (
  'crisis_ai_followup',
  'Crisis follow-up',
  'Wire coverage reacting to an official government response.',
  'domestic', 'general', 24, 0, false, false, 'none', 3
)
on conflict (template_key) do update set
  enabled = false,
  spawn_weight = 0,
  is_starter = false;

alter table public.simulation_event_responses
  add column if not exists followup_instance_id uuid references public.simulation_event_instances (id) on delete set null;

create index if not exists simulation_event_responses_pending_followup_idx
  on public.simulation_event_responses (created_at)
  where followup_instance_id is null;

-- Publish a player-response-driven wire beat (content supplied by the app / AI layer).
create or replace function public.publish_crisis_generated_beat(
  p_response_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_dateline text default null,
  p_beat_label text default 'developing'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resp record;
  parent_row record;
  starter_tpl record;
  inst_id uuid;
  beat int;
  v_title text := trim(coalesce(p_title, ''));
  v_summary text := trim(coalesce(p_summary, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_dateline text := nullif(trim(coalesce(p_dateline, '')), '');
  label text := coalesce(nullif(trim(p_beat_label), ''), 'developing');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select r.* into resp
  from public.simulation_event_responses r
  where r.id = p_response_id;
  if not found then
    raise exception 'Crisis response not found';
  end if;
  if resp.followup_instance_id is not null then
    return resp.followup_instance_id;
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 300 then
    raise exception 'Title must be 1–300 characters';
  end if;
  if char_length(v_summary) < 1 or char_length(v_summary) > 2000 then
    raise exception 'Summary must be 1–2000 characters';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 12000 then
    raise exception 'Body must be 1–12000 characters';
  end if;

  select i.* into parent_row
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id
  order by i.beat_number desc, i.opened_at desc
  limit 1;
  if not found then
    raise exception 'No wire beat for this crisis arc';
  end if;

  select t.* into starter_tpl
  from public.simulation_event_templates t
  where t.template_key = public._crisis_starter_template_key(resp.story_arc_id);

  select coalesce(max(i.beat_number), 0) + 1 into beat
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id;

  insert into public.simulation_event_instances (
    template_key, title, summary, body, dateline,
    deadline_at, severity, story_arc_id, parent_instance_id, beat_number, beat_label, metadata
  ) values (
    'crisis_ai_followup',
    v_title,
    v_summary,
    v_body,
    v_dateline,
    now() + make_interval(hours => greatest(4, least(72, coalesce(starter_tpl.default_hours, 24)))),
    least(5, greatest(1, coalesce(starter_tpl.default_severity, 3))),
    resp.story_arc_id,
    parent_row.id,
    beat,
    label,
    jsonb_build_object(
      'auto_published', true,
      'ai_generated', true,
      'source_response_id', resp.id,
      'source_instrument', resp.instrument::text,
      'category', coalesce(starter_tpl.category, 'domestic'),
      'topic', coalesce(starter_tpl.topic, 'general')
    )
  )
  returning id into inst_id;

  update public.simulation_event_responses
  set followup_instance_id = inst_id
  where id = resp.id;

  update public.simulation_event_instances
  set outcome = 'Administration and agencies move to implement the response.'
  where story_arc_id = resp.story_arc_id
    and status = 'active'
    and resp.instrument in ('executive_order', 'presidential_statement', 'letter_to_congress');

  update public.simulation_event_instances
  set status = 'active', resolved_at = null
  where story_arc_id = resp.story_arc_id and status in ('resolved', 'escalated', 'failed');

  return inst_id;
end;
$$;

grant execute on function public.publish_crisis_generated_beat(uuid, text, text, text, text, text) to authenticated;

-- Same as above; for server/cron using the service role (bill enactment hooks, pending queue).
create or replace function public.publish_crisis_generated_beat_service(
  p_response_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_dateline text default null,
  p_beat_label text default 'developing'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resp record;
  parent_row record;
  starter_tpl record;
  inst_id uuid;
  beat int;
  v_title text := trim(coalesce(p_title, ''));
  v_summary text := trim(coalesce(p_summary, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_dateline text := nullif(trim(coalesce(p_dateline, '')), '');
  label text := coalesce(nullif(trim(p_beat_label), ''), 'developing');
begin
  select r.* into resp
  from public.simulation_event_responses r
  where r.id = p_response_id;
  if not found then
    raise exception 'Crisis response not found';
  end if;
  if resp.followup_instance_id is not null then
    return resp.followup_instance_id;
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 300 then
    raise exception 'Title must be 1–300 characters';
  end if;
  if char_length(v_summary) < 1 or char_length(v_summary) > 2000 then
    raise exception 'Summary must be 1–2000 characters';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 12000 then
    raise exception 'Body must be 1–12000 characters';
  end if;

  select i.* into parent_row
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id
  order by i.beat_number desc, i.opened_at desc
  limit 1;
  if not found then
    raise exception 'No wire beat for this crisis arc';
  end if;

  select t.* into starter_tpl
  from public.simulation_event_templates t
  where t.template_key = public._crisis_starter_template_key(resp.story_arc_id);

  select coalesce(max(i.beat_number), 0) + 1 into beat
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id;

  insert into public.simulation_event_instances (
    template_key, title, summary, body, dateline,
    deadline_at, severity, story_arc_id, parent_instance_id, beat_number, beat_label, metadata
  ) values (
    'crisis_ai_followup',
    v_title,
    v_summary,
    v_body,
    v_dateline,
    now() + make_interval(hours => greatest(4, least(72, coalesce(starter_tpl.default_hours, 24)))),
    least(5, greatest(1, coalesce(starter_tpl.default_severity, 3))),
    resp.story_arc_id,
    parent_row.id,
    beat,
    label,
    jsonb_build_object(
      'auto_published', true,
      'ai_generated', true,
      'source_response_id', resp.id,
      'source_instrument', resp.instrument::text,
      'category', coalesce(starter_tpl.category, 'domestic'),
      'topic', coalesce(starter_tpl.topic, 'general')
    )
  )
  returning id into inst_id;

  update public.simulation_event_responses
  set followup_instance_id = inst_id
  where id = resp.id;

  update public.simulation_event_instances
  set outcome = 'Administration and agencies move to implement the response.'
  where story_arc_id = resp.story_arc_id
    and status = 'active'
    and resp.instrument in ('executive_order', 'presidential_statement', 'letter_to_congress');

  update public.simulation_event_instances
  set status = 'active', resolved_at = null
  where story_arc_id = resp.story_arc_id and status in ('resolved', 'escalated', 'failed');

  return inst_id;
end;
$$;

grant execute on function public.publish_crisis_generated_beat_service(uuid, text, text, text, text, text) to service_role;

create or replace function public.publish_crisis_static_followup_service(p_response_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resp record;
  starter_key text;
  parent_beat_id uuid;
  follow_tpl record;
  new_beat_id uuid;
begin
  select r.* into resp
  from public.simulation_event_responses r
  where r.id = p_response_id;
  if not found then
    raise exception 'Crisis response not found';
  end if;
  if resp.followup_instance_id is not null then
    return resp.followup_instance_id;
  end if;

  starter_key := public._crisis_starter_template_key(resp.story_arc_id);

  select i.id into parent_beat_id
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id
  order by i.beat_number desc, i.opened_at desc
  limit 1;

  select t.* into follow_tpl
  from public.simulation_event_templates t
  where t.enabled
    and t.follow_up_of_template_key = starter_key
    and t.crisis_trigger_instrument = resp.instrument::text
    and not exists (
      select 1 from public.simulation_event_instances i
      where i.story_arc_id = resp.story_arc_id and i.template_key = t.template_key
    )
  order by t.default_severity desc
  limit 1;

  if follow_tpl.template_key is null then
    return null;
  end if;

  new_beat_id := public._crisis_auto_publish_beat(parent_beat_id, follow_tpl.template_key, 'developing');
  if new_beat_id is not null then
    update public.simulation_event_responses
    set followup_instance_id = new_beat_id
    where id = resp.id;
  end if;

  return new_beat_id;
end;
$$;

grant execute on function public.publish_crisis_static_followup_service(uuid) to service_role;

-- Static scripted follow-up (fallback when AI is unavailable).
create or replace function public.publish_crisis_static_followup(
  p_response_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resp record;
  starter_key text;
  parent_beat_id uuid;
  follow_tpl record;
  new_beat_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select r.* into resp
  from public.simulation_event_responses r
  where r.id = p_response_id;
  if not found then
    raise exception 'Crisis response not found';
  end if;
  if resp.followup_instance_id is not null then
    return resp.followup_instance_id;
  end if;

  starter_key := public._crisis_starter_template_key(resp.story_arc_id);

  select i.id into parent_beat_id
  from public.simulation_event_instances i
  where i.story_arc_id = resp.story_arc_id
  order by i.beat_number desc, i.opened_at desc
  limit 1;

  select t.* into follow_tpl
  from public.simulation_event_templates t
  where t.enabled
    and t.follow_up_of_template_key = starter_key
    and t.crisis_trigger_instrument = resp.instrument::text
    and not exists (
      select 1 from public.simulation_event_instances i
      where i.story_arc_id = resp.story_arc_id and i.template_key = t.template_key
    )
  order by t.default_severity desc
  limit 1;

  if follow_tpl.template_key is null then
    return null;
  end if;

  new_beat_id := public._crisis_auto_publish_beat(parent_beat_id, follow_tpl.template_key, 'developing');
  if new_beat_id is not null then
    update public.simulation_event_responses
    set followup_instance_id = new_beat_id
    where id = resp.id;
  end if;

  return new_beat_id;
end;
$$;

grant execute on function public.publish_crisis_static_followup(uuid) to authenticated;

-- Follow-up beats are generated by the app (AI or static fallback), not inline here.
create or replace function public._crisis_evaluate_arc(p_story_arc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_inst public.simulation_event_instances;
  latest_resp record;
  beat_count int;
begin
  active_inst := public._crisis_active_instance(p_story_arc_id);
  if active_inst.id is null then
    return;
  end if;

  select r.* into latest_resp
  from public.simulation_event_responses r
  where r.story_arc_id = p_story_arc_id
  order by r.created_at desc
  limit 1;

  if latest_resp.id is not null then
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
