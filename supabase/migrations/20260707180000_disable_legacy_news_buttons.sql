-- News crises use authored instruments (EO, statements, bills), not legacy choice buttons.

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

  if inst.template_key like 'news_%' or coalesce(inst.metadata->>'category', '') in ('domestic', 'international') then
    raise exception 'Wire crises require a real response — issue an executive order, statement, or legislation from the crisis briefing on /events.';
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

notify pgrst, 'reload schema';
