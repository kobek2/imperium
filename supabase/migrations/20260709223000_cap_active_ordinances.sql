-- Cap active city law at 5 enacted ordinances; oldest expires when a new one is signed.

alter table public.city_ordinance_proposals drop constraint if exists city_ordinance_proposals_status_check;
alter table public.city_ordinance_proposals add constraint city_ordinance_proposals_status_check
  check (status in (
    'draft', 'proposed', 'council_vote', 'awaiting_mayor', 'enacted', 'rejected', 'vetoed', 'expired'
  ));

-- Retain only the five most recently enacted ordinances.
with ranked as (
  select
    id,
    row_number() over (
      order by enacted_at desc nulls last, created_at desc
    ) as rn
  from public.city_ordinance_proposals
  where status = 'enacted'
)
update public.city_ordinance_proposals p
set status = 'expired'
from ranked r
where p.id = r.id
  and r.rn > 5;

create or replace function public.council_propose_ordinance(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_title text default '',
  p_summary text default '',
  p_stance_params jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  proposal_id uuid;
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  coalition text := null;
  scores record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'mayor', 'admin')
  ) and not v_is_admin then
    raise exception 'Only the mayor or council members may propose ordinances';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'council_vote') then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'awaiting_mayor') then
    raise exception 'An ordinance is awaiting mayor signature before a new one can be filed';
  end if;

  if cat not in ('taxes', 'crime', 'economy', 'education') then
    raise exception 'Invalid policy category';
  end if;

  if issue = 'property_tax_rate' then
    if p_stance_params is null
      or not (p_stance_params ? 'rate_delta')
      or not (p_stance_params ? 'earmark_services_pct') then
      raise exception 'Property tax ordinances require stance_params (rate_delta, earmark_services_pct)';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, null, p_stance_params);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  else
    if stance not in ('progressive', 'moderate', 'conservative') then
      raise exception 'Invalid stance';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, stance, null);
    coalition := stance;
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Ordinance title is required';
  end if;

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, stance_params, title, summary, status,
    issue_economic_score, issue_social_score
  ) values (
    v_uid, cat, trim(p_issue_key),
    coalition,
    case when issue = 'property_tax_rate' then p_stance_params else null end,
    trim(p_title), coalesce(p_summary, ''), 'council_vote',
    scores.issue_economic, scores.issue_social
  )
  returning id into proposal_id;

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_ordinance_vote(proposal_id);
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', proposal_id, 'status', 'council_vote');
end;
$$;

create or replace function public.mayor_sign_ordinance(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  applied jsonb;
  expired_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may sign ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'awaiting_mayor' then raise exception 'Ordinance is not awaiting mayor signature'; end if;

  if (select count(*) from public.city_ordinance_proposals where status = 'enacted') >= 5 then
    select id into expired_id
    from public.city_ordinance_proposals
    where status = 'enacted'
    order by enacted_at asc nulls last, created_at asc
    limit 1;

    if expired_id is not null then
      update public.city_ordinance_proposals
      set status = 'expired'
      where id = expired_id;
    end if;
  end if;

  applied := public._apply_ordinance_effects(p_ordinance_id);

  update public.city_ordinance_proposals
  set status = 'enacted', enacted_at = now()
  where id = p_ordinance_id;

  return jsonb_build_object(
    'ok', true, 'status', 'enacted', 'ordinance_id', p_ordinance_id,
    'effects', applied->'effects', 'summary', applied->'summary',
    'expired_ordinance_id', expired_id
  );
end;
$$;
