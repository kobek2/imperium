-- Police Staffing & Community Programs: parametric stance_params (staffing_level + strategy).

create or replace function public._policing_strategy_index(p_strategy text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_strategy, '')))
    when 'community_outreach' then 0
    when 'balanced' then 1
    when 'enforcement_heavy' then 2
    else 1
  end;
$$;

create or replace function public._clamp_policing_stance_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  strategy text := lower(trim(coalesce(p_params->>'strategy', 'balanced')));
  staffing numeric := greatest(-20::numeric, least(50::numeric, coalesce((p_params->>'staffing_level')::numeric, 0)));
begin
  if strategy not in ('community_outreach', 'balanced', 'enforcement_heavy') then
    strategy := 'balanced';
  end if;
  return jsonb_build_object('staffing_level', staffing, 'strategy', strategy);
end;
$$;

create or replace function public._score_policing_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_policing_stance_params(p_stance_params);
  staffing numeric := (p->>'staffing_level')::numeric;
  strat_idx int := public._policing_strategy_index(p->>'strategy');
  staff_norm_pos numeric;
  staff_norm_neg numeric;
  staff_econ int;
  staff_soc int;
  strat_econ int;
  strat_soc int;
  staff_amp numeric;
  soc_redirect numeric;
  econ int;
  soc int;
begin
  staff_norm_pos := case when staffing > 0 then power(staffing / 50.0, 1.7) else 0 end;
  staff_norm_neg := case when staffing < 0 then power(abs(staffing) / 20.0, 1.7) else 0 end;

  if staffing > 0 then
    staff_econ := -round(staff_norm_pos * 40)::int;
    staff_soc := round(staff_norm_pos * 20)::int;
  elsif staffing < 0 then
    staff_econ := round(staff_norm_neg * 32)::int;
    staff_soc := -round(staff_norm_neg * 18)::int;
  else
    staff_econ := 0;
    staff_soc := 0;
  end if;

  strat_econ := case strat_idx when 0 then -25 when 2 then 30 else 0 end;
  strat_soc := case strat_idx when 0 then -58 when 2 then 55 else 0 end;

  staff_amp := 1 + case when staffing >= 0 then staff_norm_pos * 0.35 else staff_norm_neg * 0.35 end;
  soc_redirect := case strat_idx when 0 then 1.12 when 2 then 0.88 else 1.0 end;

  econ := round(strat_econ * staff_amp + staff_econ)::int;
  soc := round((strat_soc + staff_soc) * soc_redirect)::int;

  issue_economic := greatest(-99, least(99, econ))::smallint;
  issue_social := greatest(-99, least(99, soc))::smallint;
  return next;
end;
$$;

alter table public.city_ordinance_proposals
  drop constraint if exists city_ordinance_proposals_stance_check;

alter table public.city_ordinance_proposals
  add constraint city_ordinance_proposals_stance_check check (
    (
      lower(trim(issue_key)) in ('property_tax_rate', 'marijuana_legalization', 'policing_community_programs')
      and (
        (
          stance_params is not null
          and (
            (
              lower(trim(issue_key)) = 'property_tax_rate'
              and (stance_params ? 'rate_delta')
              and (stance_params ? 'earmark_services_pct')
            )
            or (
              lower(trim(issue_key)) = 'marijuana_legalization'
              and (stance_params ? 'legal_status')
              and (stance_params ? 'commercial_sale_allowed')
              and (stance_params ? 'sales_tax_rate')
              and (stance_params ? 'expungement')
            )
            or (
              lower(trim(issue_key)) = 'policing_community_programs'
              and (stance_params ? 'staffing_level')
              and (stance_params ? 'strategy')
            )
          )
        )
        or stance_key in ('progressive', 'moderate', 'conservative')
      )
    )
    or (
      lower(trim(issue_key)) not in ('property_tax_rate', 'marijuana_legalization', 'policing_community_programs')
      and stance_key in ('progressive', 'moderate', 'conservative')
    )
  );

create or replace function public._ordinance_issue_scores(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_stance_params jsonb default null,
  out issue_economic smallint,
  out issue_social smallint
)
language plpgsql
immutable
as $$
declare
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  pt_scores record;
  mj_scores record;
  pol_scores record;
begin
  issue_economic := 0;
  issue_social := 0;

  if cat = 'taxes' and issue = 'property_tax_rate' and p_stance_params is not null then
    select * into pt_scores from public._score_property_tax_ordinance(p_stance_params);
    issue_economic := pt_scores.issue_economic;
    issue_social := pt_scores.issue_social;
    return;
  end if;

  if cat = 'crime' and issue = 'marijuana_legalization' and p_stance_params is not null then
    select * into mj_scores from public._score_marijuana_ordinance(p_stance_params);
    issue_economic := mj_scores.issue_economic;
    issue_social := mj_scores.issue_social;
    return;
  end if;

  if cat = 'crime' and issue = 'policing_community_programs' and p_stance_params is not null then
    select * into pol_scores from public._score_policing_ordinance(p_stance_params);
    issue_economic := pol_scores.issue_economic;
    issue_social := pol_scores.issue_social;
    return;
  end if;

  if cat = 'taxes' and issue = 'property_tax_rate' then
    issue_economic := case stance when 'progressive' then -72 when 'conservative' then 45 else 0 end;
    issue_social := case stance when 'progressive' then -42 when 'conservative' then 15 else 0 end;
  elsif cat = 'crime' and issue = 'policing_community_programs' then
    issue_economic := case stance when 'progressive' then -25 when 'conservative' then 30 else 0 end;
    issue_social := case stance when 'progressive' then -65 when 'conservative' then 55 else 0 end;
  elsif cat = 'economy' and issue = 'small_business_permits' then
    issue_economic := case stance when 'progressive' then -35 when 'conservative' then 50 else 0 end;
    issue_social := case stance when 'progressive' then 0 when 'conservative' then 25 else 0 end;
  elsif cat = 'economy' and issue = 'minimum_wage' then
    issue_economic := case stance when 'progressive' then -75 when 'conservative' then 40 else -35 end;
    issue_social := case stance when 'progressive' then -40 when 'conservative' then 20 else -10 end;
  elsif cat = 'education' and issue = 'school_funding' then
    issue_economic := case stance when 'progressive' then -70 when 'conservative' then 55 else 0 end;
    issue_social := case stance when 'progressive' then -45 when 'conservative' then 10 else 0 end;
  else
    issue_economic := case stance when 'progressive' then -50 when 'conservative' then 50 else 0 end;
    issue_social := case stance when 'progressive' then -30 when 'conservative' then 30 else 0 end;
  end if;
end;
$$;

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
  parametric_issues text[] := array['property_tax_rate', 'marijuana_legalization', 'policing_community_programs'];
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

create or replace function public._policing_ordinance_sim_deltas(p_stance_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  p jsonb := public._clamp_policing_stance_params(p_stance_params);
  staffing numeric := (p->>'staffing_level')::numeric;
  strat_idx int := public._policing_strategy_index(p->>'strategy');
  norm numeric;
  public_safety int;
  mayor_approval int;
begin
  norm := case
    when staffing > 0 then power(staffing / 50.0, 1.7)
    when staffing < 0 then power(abs(staffing) / 20.0, 1.7)
    else 0
  end;

  public_safety := round(case
    when staffing >= 0 then norm * (case strat_idx when 2 then 7 when 0 then -2 else 2 end)
    else -norm * 3
  end)::int;

  mayor_approval := round(case strat_idx when 0 then 5 when 2 then -2 else 1 end)::int;

  return jsonb_build_object(
    'public_safety', public_safety,
    'mayor_approval', mayor_approval,
    'education_quality', case when strat_idx = 0 then round(norm * 2)::int else 0 end,
    'housing_affordability', case when strat_idx = 0 then round(norm * 2)::int when strat_idx = 2 then -1 else 0 end,
    'business_climate', case when strat_idx = 2 then round(norm * 2)::int else 0 end,
    'economy_index', 0,
    'property_tax_rate_pct', 0
  );
end;
$$;

create or replace function public._ordinance_sim_effect_deltas(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_stance_params jsonb default null
)
returns jsonb
language plpgsql
immutable
as $$
declare
  cat text := lower(trim(coalesce(p_category, '')));
  issue text := lower(trim(coalesce(p_issue_key, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
  d jsonb := jsonb_build_object(
    'public_safety', 0,
    'education_quality', 0,
    'housing_affordability', 0,
    'business_climate', 0,
    'mayor_approval', 0,
    'economy_index', 0,
    'property_tax_rate_pct', 0
  );
  rd numeric;
  earmark numeric;
  tax_norm numeric;
  p jsonb;
  step int;
  norm numeric;
begin
  if cat = 'taxes' and issue = 'property_tax_rate' and p_stance_params is not null then
    rd := public._clamp_property_tax_rate_delta((p_stance_params->>'rate_delta')::numeric);
    earmark := public._clamp_earmark_pct((p_stance_params->>'earmark_services_pct')::numeric) / 100.0;
    tax_norm := case
      when rd < 0 then power(abs(rd / (-5::numeric)), 1.7)
      when rd > 0 then power(rd / 15::numeric, 1.7)
      else 0
    end;
    d := d || jsonb_build_object('property_tax_rate_pct', rd);
    if rd < 0 then
      d := d || jsonb_build_object(
        'housing_affordability', round(tax_norm * (1 - earmark) * 8),
        'mayor_approval', round(tax_norm * 6),
        'economy_index', round(tax_norm * 2),
        'business_climate', round(-tax_norm * 2)
      );
    elsif rd > 0 then
      d := d || jsonb_build_object(
        'housing_affordability', round(-tax_norm * earmark * 5),
        'mayor_approval', round(-tax_norm * earmark * 3),
        'economy_index', round(tax_norm * 0.5),
        'business_climate', round(tax_norm * earmark * 3)
      );
    end if;
    return d;
  end if;

  if cat = 'crime' and issue = 'marijuana_legalization' and p_stance_params is not null then
    p := public._clamp_marijuana_stance_params(p_stance_params);
    step := public._marijuana_status_step_index(p->>'legal_status');
    norm := case when step > 0 then power(step::numeric / 3.0, 1.7) else 0 end;
    d := d || jsonb_build_object(
      'public_safety', round(-norm * 4),
      'business_climate', round(norm * (case when coalesce((p->>'commercial_sale_allowed')::boolean, false) then 5 else 2 end)),
      'mayor_approval', round(norm * 3),
      'economy_index', round(norm * 2)
    );
    if coalesce((p->>'expungement')::boolean, false) then
      d := d || jsonb_build_object('mayor_approval', coalesce((d->>'mayor_approval')::int, 0) + 2);
    end if;
    return d;
  end if;

  if cat = 'crime' and issue = 'policing_community_programs' and p_stance_params is not null then
    return public._policing_ordinance_sim_deltas(p_stance_params);
  end if;

  if cat = 'taxes' and issue = 'property_tax_rate' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'property_tax_rate_pct', -0.15,
        'housing_affordability', 6,
        'mayor_approval', 5,
        'economy_index', 2,
        'business_climate', -2
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'property_tax_rate_pct', 0.12,
        'housing_affordability', -4,
        'mayor_approval', -3,
        'economy_index', 1,
        'business_climate', 3
      );
    end if;
  elsif cat = 'crime' and issue = 'policing_community_programs' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'public_safety', -3,
        'mayor_approval', 6,
        'housing_affordability', 2,
        'education_quality', 2
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object('public_safety', 2, 'mayor_approval', 1);
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'public_safety', 7,
        'mayor_approval', -2,
        'business_climate', 2,
        'housing_affordability', -1
      );
    end if;
  elsif cat = 'economy' and issue = 'small_business_permits' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'business_climate', 5,
        'mayor_approval', 3,
        'economy_index', 2
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'business_climate', -4,
        'mayor_approval', 2,
        'housing_affordability', 1
      );
    end if;
  elsif cat = 'economy' and issue = 'minimum_wage' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'business_climate', -7,
        'housing_affordability', 5,
        'mayor_approval', 4,
        'economy_index', -3
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object(
        'business_climate', -2,
        'housing_affordability', 3,
        'mayor_approval', 2,
        'economy_index', -1
      );
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'business_climate', 3,
        'housing_affordability', -2,
        'mayor_approval', -2
      );
    end if;
  elsif cat = 'education' and issue = 'school_funding' then
    if stance = 'progressive' then
      d := d || jsonb_build_object(
        'education_quality', 9,
        'mayor_approval', 5,
        'economy_index', -2,
        'business_climate', -1
      );
    elsif stance = 'moderate' then
      d := d || jsonb_build_object('education_quality', 2, 'mayor_approval', 1);
    elsif stance = 'conservative' then
      d := d || jsonb_build_object(
        'education_quality', -2,
        'mayor_approval', -1,
        'business_climate', 2
      );
    end if;
  end if;

  return d;
end;
$$;

notify pgrst, 'reload schema';
