-- Fix: SELECT DISTINCT ... ORDER BY random() requires random() in the select list.
-- Wrap distinct ids in a subquery, then order/limit the outer query.

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

notify pgrst, 'reload schema';
