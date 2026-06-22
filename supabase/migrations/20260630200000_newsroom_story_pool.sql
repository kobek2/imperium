-- Newsroom: domestic/international story pool, story arcs, and admin article publishing with follow-ups.

alter table public.simulation_event_templates
  drop constraint if exists simulation_event_templates_category_check;

alter table public.simulation_event_templates
  add column if not exists topic text not null default 'general',
  add column if not exists follow_up_of_template_key text references public.simulation_event_templates (template_key),
  add column if not exists is_starter boolean not null default true,
  add column if not exists assignment_mode text not null default 'none',
  add column if not exists default_severity smallint not null default 3;

alter table public.simulation_event_templates
  add constraint simulation_event_templates_category_check
    check (category in ('domestic', 'international', 'campaign', 'congress', 'executive', 'economy', 'cabinet')),
  add constraint simulation_event_templates_assignment_mode_check
    check (assignment_mode in ('none', 'congress', 'campaign', 'executive')),
  add constraint simulation_event_templates_default_severity_check
    check (default_severity between 1 and 5);

alter table public.simulation_event_instances
  add column if not exists story_arc_id uuid not null default gen_random_uuid(),
  add column if not exists parent_instance_id uuid references public.simulation_event_instances (id) on delete set null,
  add column if not exists beat_number int not null default 1,
  add column if not exists beat_label text not null default 'breaking';

alter table public.simulation_event_instances
  add constraint simulation_event_instances_beat_number_check check (beat_number >= 1),
  add constraint simulation_event_instances_beat_label_check
    check (beat_label in ('breaking', 'developing', 'update', 'analysis', 'escalation'));

create index if not exists simulation_event_instances_story_arc_idx
  on public.simulation_event_instances (story_arc_id, beat_number);

create index if not exists simulation_event_templates_follow_up_idx
  on public.simulation_event_templates (follow_up_of_template_key)
  where follow_up_of_template_key is not null;

-- Legacy sim templates: keep for optional game hooks, out of random news pool.
update public.simulation_event_templates
set
  category = case template_key
    when 'constituent_pressure' then 'congress'
    when 'capitol_agenda' then 'congress'
    when 'campaign_scrutiny' then 'campaign'
    when 'trail_watch' then 'campaign'
    else 'executive'
  end,
  assignment_mode = case template_key
    when 'constituent_pressure' then 'congress'
    when 'capitol_agenda' then 'congress'
    when 'campaign_scrutiny' then 'campaign'
    when 'trail_watch' then 'campaign'
    else 'none'
  end,
  spawn_weight = 0,
  enabled = false
where template_key in (
  'diplomatic_flashpoint', 'treasury_cash_crunch', 'defense_readiness',
  'constituent_pressure', 'capitol_agenda', 'campaign_scrutiny', 'trail_watch'
);

update public.simulation_event_templates
set category = 'executive', assignment_mode = 'none', is_starter = true, topic = 'general', enabled = true
where template_key = 'wire_bulletin';

-- ---------- Story pool: domestic breaking ----------
insert into public.simulation_event_templates (
  template_key, title, summary, category, topic, default_hours, spawn_weight, enabled,
  is_starter, assignment_mode, default_severity
) values
  (
    'news_border_surge',
    'Record border crossings overwhelm Southwest sectors',
    'Customs and Border Protection reports the highest single-week apprehension count in a decade. Governors are demanding federal action as shelter networks in Texas and Arizona hit capacity.',
    'domestic', 'immigration', 36, 0, true, true, 'none', 4
  ),
  (
    'news_capital_shooting',
    'Gunfire at state capital kills three during legislative session',
    'Shots erupted outside a committee hearing room. Capitol police have locked down the complex; lawmakers shelter in place as investigators pursue a motive tied to a recent firearms bill.',
    'domestic', 'guns', 24, 0, true, true, 'none', 5
  ),
  (
    'news_abortion_emergency',
    'Federal judge blocks clinic access in three states',
    'A late-night injunction halts medication abortion distribution pending appeal. Demonstrators mass at courthouses as providers warn of an immediate care crisis in rural counties.',
    'domestic', 'abortion', 30, 0, true, true, 'none', 4
  ),
  (
    'news_healthcare_strike',
    'Nationwide nurses strike over staffing ratios',
    'More than 40,000 nurses walk off shifts at major hospital systems. ER wait times spike in the Midwest as administrators warn elective surgeries will be canceled through the week.',
    'domestic', 'healthcare', 28, 0, true, true, 'none', 3
  ),
  (
    'news_immigration_raid',
    'ICE operation detains hundreds at agricultural worksites',
    'Pre-dawn raids across the Central Valley trigger protests and school absences. Community groups allege families were separated without notice; DHS says the targets had outstanding removal orders.',
    'domestic', 'immigration', 24, 0, true, true, 'none', 4
  ),
  (
    'news_grid_cyberattack',
    'Cyberattack disrupts power grid in Southeast',
    'Rolling blackouts hit Georgia and the Carolinas after a ransomware strike on a regional utility vendor. The White House convenes an emergency interagency call as summer heat indexes climb.',
    'domestic', 'security', 20, 0, true, true, 'none', 5
  ),
  (
    'news_housing_evictions',
    'Eviction filings surge in coastal metros',
    'Tenant advocates report a 30% jump in filings after pandemic-era protections expired. City councils debate emergency rental assistance as homelessness counts rise on overnight street surveys.',
    'domestic', 'economy', 48, 0, true, true, 'none', 3
  ),
  (
    'news_opioid_shipment',
    'Record fentanyl seizure at major port',
    'Authorities intercept a shipment large enough to supply several states. Lawmakers demand hearings on border inspection staffing while public health officials warn of a summer overdose wave.',
    'domestic', 'drugs', 36, 0, true, true, 'none', 4
  )
on conflict (template_key) do update set
  title = excluded.title,
  summary = excluded.summary,
  category = excluded.category,
  topic = excluded.topic,
  default_hours = excluded.default_hours,
  enabled = excluded.enabled,
  is_starter = excluded.is_starter,
  assignment_mode = excluded.assignment_mode,
  default_severity = excluded.default_severity;

-- ---------- Story pool: international breaking ----------
insert into public.simulation_event_templates (
  template_key, title, summary, category, topic, default_hours, spawn_weight, enabled,
  is_starter, assignment_mode, default_severity
) values
  (
    'news_hostage_crisis',
    'Americans taken hostage after embassy district attack',
    'A car bomb near a diplomatic quarter overseas kills at least twelve and leaves U.S. nationals unaccounted for. The State Department activates a crisis cell as regional militias claim responsibility.',
    'international', 'terrorism', 18, 0, true, true, 'none', 5
  ),
  (
    'news_taiwan_strait',
    'Naval standoff escalates in the Taiwan Strait',
    'PLA vessels cross a median line for the longest sustained period since the last crisis. U.S. carrier strike group orders changed; markets slide on fears of a blockade rehearsal.',
    'international', 'war', 24, 0, true, true, 'none', 5
  ),
  (
    'news_europe_front',
    'Fighting intensifies on European front lines',
    'Artillery exchanges widen after a failed ceasefire. NATO allies split over ammunition shipments as refugees stream toward western borders and energy prices tick up overnight.',
    'international', 'war', 30, 0, true, true, 'none', 4
  ),
  (
    'news_sahel_coup',
    'Coup leaders seize uranium routes in the Sahel',
    'Junta forces consolidate control over mining corridors vital to Western reactors. France and the U.S. evacuate nonessential personnel as ECOWAS debates an intervention mandate.',
    'international', 'conflict', 36, 0, true, true, 'none', 4
  ),
  (
    'news_arctic_clash',
    'Arctic patrol vessels collide in disputed waters',
    'Coast guard cutters make contact during a freedom-of-navigation exercise. Both governments file protests; satellite imagery shows new military infrastructure on adjacent ice-free ports.',
    'international', 'borders', 40, 0, true, true, 'none', 3
  ),
  (
    'news_terror_plot',
    'Transatlantic terror plot disrupted at staging hub',
    'Joint intelligence services arrest a cell planning coordinated attacks on aviation targets. Homeland Security raises the domestic threat posture; congressional leaders demand a classified briefing.',
    'international', 'terrorism', 24, 0, true, true, 'none', 5
  ),
  (
    'news_humanitarian_ship',
    'Aid ship blocked from entering war zone port',
    'A humanitarian convoy is turned back by naval pickets citing security zones. UN officials warn famine conditions are weeks away; celebrity diplomats call for a protected corridor.',
    'international', 'humanitarian', 48, 0, true, true, 'none', 4
  ),
  (
    'news_nato_spending',
    'NATO allies clash over burden-sharing at emergency summit',
    'Leaders trade public ultimatums over defense spending shortfalls and ammunition stockpiles. The Secretary General warns the alliance faces its most serious credibility test in a generation.',
    'international', 'diplomacy', 36, 0, true, true, 'none', 3
  )
on conflict (template_key) do update set
  title = excluded.title,
  summary = excluded.summary,
  category = excluded.category,
  topic = excluded.topic,
  default_hours = excluded.default_hours,
  enabled = excluded.enabled,
  is_starter = excluded.is_starter,
  assignment_mode = excluded.assignment_mode,
  default_severity = excluded.default_severity;

-- ---------- Follow-up beats (continue a starter arc) ----------
insert into public.simulation_event_templates (
  template_key, title, summary, category, topic, default_hours, spawn_weight, enabled,
  is_starter, follow_up_of_template_key, assignment_mode, default_severity
) values
  (
    'news_border_surge_congress',
    'Congress scrambles on border package as images dominate cable',
    'Leadership floats a bipartisan framework tying enforcement funding to asylum processing timelines. Hard-liners vow to block any deal that does not include mandatory detention expansions.',
    'domestic', 'immigration', 24, 0, true, false, 'news_border_surge', 'none', 4
  ),
  (
    'news_border_surge_protests',
    'Protesters block highway checkpoints in border counties',
    'Demonstrators demand immediate processing reforms. Several arrests reported; governors ask for National Guard logistics support without committing troops.',
    'domestic', 'immigration', 18, 0, true, false, 'news_border_surge', 'none', 3
  ),
  (
    'news_capital_shooting_manifesto',
    'Shooter manifesto references pending firearms legislation',
    'Investigators confirm the suspect live-streamed part of the attack. Gun-policy advocates and Second Amendment groups schedule dueling press conferences within the hour.',
    'domestic', 'guns', 20, 0, true, false, 'news_capital_shooting', 'none', 5
  ),
  (
    'news_hostage_ransom',
    'Hostage-takers issue 72-hour ultimatum',
    'A video released through intermediaries shows three Americans and demands prisoner exchanges. Intelligence agencies assess whether the timeline is negotiable or a distraction for a second attack.',
    'international', 'terrorism', 12, 0, true, false, 'news_hostage_crisis', 'none', 5
  ),
  (
    'news_taiwan_strait_sanctions',
    'Markets plunge as sanctions talk hits semiconductor supply chains',
    'Treasury officials leak that export controls on advanced chips are under review. Tech CEOs lobby Congress privately while allied capitals seek a coordinated statement to calm investors.',
    'international', 'war', 24, 0, true, false, 'news_taiwan_strait', 'none', 4
  ),
  (
    'news_grid_cyberattack_restore',
    'Utility restores partial power; attribution fight begins',
    'Officials cautiously bring hospitals back online. Cyber firms trace malware to a foreign contractor; partisan blame games erupt before a joint investigation is agreed.',
    'domestic', 'security', 30, 0, true, false, 'news_grid_cyberattack', 'none', 4
  ),
  (
    'news_healthcare_strike_deal',
    'Hospital CEOs float interim deal; unions call it insufficient',
    'Management offers a one-year wage bump and hiring bonuses. Nurse leaders say ratios remain unsafe and threaten to expand the strike to pediatric centers.',
    'domestic', 'healthcare', 24, 0, true, false, 'news_healthcare_strike', 'none', 3
  )
on conflict (template_key) do update set
  title = excluded.title,
  summary = excluded.summary,
  category = excluded.category,
  topic = excluded.topic,
  default_hours = excluded.default_hours,
  enabled = excluded.enabled,
  is_starter = excluded.is_starter,
  follow_up_of_template_key = excluded.follow_up_of_template_key,
  assignment_mode = excluded.assignment_mode,
  default_severity = excluded.default_severity;

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
begin
  select t.* into tpl from public.simulation_event_templates t where t.template_key = p_template_key;
  if not found or tpl.assignment_mode = 'none' then
    return;
  end if;

  select i.title into tpl_title from public.simulation_event_instances i where i.id = p_instance_id;

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

create or replace function public.admin_publish_wire_article(
  p_template_key text default null,
  p_parent_instance_id uuid default null,
  p_title text default null,
  p_summary text default null,
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
    select i.* into parent_row
    from public.simulation_event_instances i
    where i.id = p_parent_instance_id;
    if not found then
      raise exception 'Parent story not found.';
    end if;
    arc_id := parent_row.story_arc_id;
    select coalesce(max(i.beat_number), 0) + 1 into beat
    from public.simulation_event_instances i
    where i.story_arc_id = arc_id;
    label := coalesce(nullif(trim(coalesce(p_beat_label, '')), ''), 'developing');
    if tpl_found
      and tpl.follow_up_of_template_key is not null
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
    4,
    least(72, coalesce(p_hours, case when tpl_found then tpl.default_hours else null end, 24))
  ));

  use_key := coalesce(tkey, 'wire_bulletin');
  sev := case when tpl_found then tpl.default_severity else 3 end;

  insert into public.simulation_event_instances (
    template_key,
    title,
    summary,
    deadline_at,
    severity,
    story_arc_id,
    parent_instance_id,
    beat_number,
    beat_label,
    metadata
  ) values (
    use_key,
    coalesce(custom_title, case when tpl_found then tpl.title else custom_title end),
    coalesce(custom_summary, case when tpl_found then tpl.summary else custom_summary end),
    deadline,
    sev,
    arc_id,
    p_parent_instance_id,
    beat,
    label,
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

  return jsonb_build_object(
    'ok', true,
    'instance_id', inst_id,
    'story_arc_id', arc_id,
    'beat_number', beat,
    'beat_label', label
  );
end;
$$;

-- Backward-compatible wrapper for existing callers.
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
    p_hours => p_hours,
    p_beat_label => 'breaking'
  );
end;
$$;

revoke all on function public.admin_publish_wire_article(text, uuid, text, text, int, text) from public;
grant execute on function public.admin_publish_wire_article(text, uuid, text, text, int, text) to authenticated;

notify pgrst, 'reload schema';
