-- Full newsroom articles: dateline + multi-paragraph body with quoted sources.

alter table public.simulation_event_templates
  add column if not exists dateline text,
  add column if not exists body text;

alter table public.simulation_event_instances
  add column if not exists dateline text,
  add column if not exists body text;

create or replace function public.admin_publish_wire_article(
  p_template_key text default null,
  p_parent_instance_id uuid default null,
  p_title text default null,
  p_summary text default null,
  p_body text default null,
  p_dateline text default null,
  p_hours int default null,
  p_beat_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl record;
  tpl_found boolean := false;
  parent_row record;
  inst_id uuid;
  arc_id uuid;
  beat int := 1;
  label text := 'breaking';
  deadline timestamptz;
  tkey text := nullif(trim(coalesce(p_template_key, '')), '');
  custom_title text := nullif(trim(coalesce(p_title, '')), '');
  custom_summary text := nullif(trim(coalesce(p_summary, '')), '');
  custom_body text := nullif(trim(coalesce(p_body, '')), '');
  custom_dateline text := nullif(trim(coalesce(p_dateline, '')), '');
  use_key text;
  sev int := 3;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  if tkey is not null then
    select t.* into tpl from public.simulation_event_templates t where t.template_key = tkey and t.enabled;
    tpl_found := found;
    if not tpl_found then
      raise exception 'Story pool item not found or disabled: %', tkey;
    end if;
  elsif custom_title is null or custom_summary is null then
    raise exception 'Provide a pool template or custom headline and lede.';
  end if;

  if p_parent_instance_id is not null then
    select i.* into parent_row from public.simulation_event_instances i where i.id = p_parent_instance_id;
    if not found then raise exception 'Parent story not found.'; end if;
    arc_id := parent_row.story_arc_id;
    select coalesce(max(i.beat_number), 0) + 1 into beat
    from public.simulation_event_instances i where i.story_arc_id = arc_id;
    label := coalesce(nullif(trim(coalesce(p_beat_label, '')), ''), 'developing');
    if tpl_found and tpl.follow_up_of_template_key is not null
      and parent_row.template_key is distinct from tpl.follow_up_of_template_key then
      raise exception 'Pool follow-up % is written for template %, not %.',
        tkey, tpl.follow_up_of_template_key, parent_row.template_key;
    end if;
  else
    arc_id := gen_random_uuid();
    beat := 1;
    label := coalesce(nullif(trim(coalesce(p_beat_label, '')), ''), 'breaking');
  end if;

  deadline := now() + make_interval(hours => greatest(
    4, least(72, coalesce(p_hours, case when tpl_found then tpl.default_hours else null end, 24))
  ));

  use_key := coalesce(tkey, 'wire_bulletin');
  sev := case when tpl_found then tpl.default_severity else 3 end;

  insert into public.simulation_event_instances (
    template_key, title, summary, body, dateline,
    deadline_at, severity, story_arc_id, parent_instance_id, beat_number, beat_label, metadata
  ) values (
    use_key,
    coalesce(custom_title, case when tpl_found then tpl.title else custom_title end),
    coalesce(custom_summary, case when tpl_found then tpl.summary else custom_summary end),
    coalesce(custom_body, case when tpl_found then tpl.body else custom_body end),
    coalesce(custom_dateline, case when tpl_found then tpl.dateline else custom_dateline end),
    deadline, sev, arc_id, p_parent_instance_id, beat, label,
    jsonb_build_object(
      'admin_published', true,
      'published_by', auth.uid(),
      'topic', case when tpl_found then tpl.topic else 'general' end,
      'category', case when tpl_found then tpl.category else 'domestic' end
    )
  )
  returning id into inst_id;

  perform public._wire_assign_for_template(inst_id, use_key);

  if p_parent_instance_id is not null then
    update public.simulation_event_instances
    set status = 'active', resolved_at = null
    where story_arc_id = arc_id and status in ('resolved', 'escalated', 'failed');
  end if;

  return jsonb_build_object('ok', true, 'instance_id', inst_id, 'story_arc_id', arc_id, 'beat_number', beat);
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
begin
  return public.admin_publish_wire_article(
    p_template_key => p_template_key,
    p_parent_instance_id => null,
    p_title => p_title,
    p_summary => p_summary,
    p_body => null,
    p_dateline => null,
    p_hours => p_hours,
    p_beat_label => 'breaking'
  );
end;
$$;

revoke all on function public.admin_publish_wire_article(text, uuid, text, text, text, text, int, text) from public;
grant execute on function public.admin_publish_wire_article(text, uuid, text, text, text, text, int, text) to authenticated;

notify pgrst, 'reload schema';
