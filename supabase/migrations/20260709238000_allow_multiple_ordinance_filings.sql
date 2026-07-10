-- Allow multiple ordinances in flight; no single-file or awaiting-mayor gate.

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
  clamped jsonb;
  parametric_issues text[] := public._registry_parametric_issue_keys();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._city_assert_legislation_allowed();
  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'mayor', 'admin')
  ) and not v_is_admin then
    raise exception 'Only the mayor or council members may propose ordinances';
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
    clamped := p_stance_params;
  elsif issue = 'marijuana_legalization' then
    if p_stance_params is null
      or not (p_stance_params ? 'legal_status')
      or not (p_stance_params ? 'commercial_sale_allowed')
      or not (p_stance_params ? 'sales_tax_rate')
      or not (p_stance_params ? 'expungement') then
      raise exception 'Marijuana ordinances require stance_params (legal_status, commercial_sale_allowed, sales_tax_rate, expungement)';
    end if;
    clamped := public._clamp_marijuana_stance_params(p_stance_params);
    select * into scores from public._ordinance_issue_scores(cat, issue, null, clamped);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  elsif issue = 'policing_community_programs' then
    if p_stance_params is null
      or not (p_stance_params ? 'staffing_level')
      or not (p_stance_params ? 'strategy') then
      raise exception 'Policing ordinances require stance_params (staffing_level, strategy)';
    end if;
    clamped := public._clamp_policing_stance_params(p_stance_params);
    select * into scores from public._ordinance_issue_scores(cat, issue, null, clamped);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  elsif issue = any(public._expansion_parametric_issue_keys()) then
    if not public._valid_expansion_parametric_params(issue, p_stance_params) then
      raise exception 'Parametric ordinance missing required stance_params for issue %', issue;
    end if;
    clamped := public._clamp_expansion_parametric_stance_params(issue, p_stance_params);
    select * into scores from public._ordinance_issue_scores(cat, issue, null, clamped);
    coalition := public._property_tax_coalition_key(scores.issue_economic);
  else
    if stance not in ('progressive', 'moderate', 'conservative') then
      raise exception 'Invalid stance';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, stance, null);
    coalition := stance;
    clamped := null;
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
    case when issue = any(parametric_issues) then clamped else null end,
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

notify pgrst, 'reload schema';
