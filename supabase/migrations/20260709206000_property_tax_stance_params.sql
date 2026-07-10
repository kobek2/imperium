-- Property tax ordinances: continuous stance_params replace discrete stance_key.

drop function if exists public.council_propose_ordinance(text, text, text, text, text);
drop function if exists public.preview_ordinance_council_vote(text, text, text);
drop function if exists public._ordinance_issue_scores(text, text, text);
drop function if exists public._ordinance_sim_effect_deltas(text, text, text);

alter table public.city_ordinance_proposals
  add column if not exists stance_params jsonb;

alter table public.city_ordinance_proposals
  drop constraint if exists city_ordinance_proposals_stance_key_check;

alter table public.city_ordinance_proposals
  alter column stance_key drop not null;

alter table public.city_ordinance_proposals
  add constraint city_ordinance_proposals_stance_check check (
    (
      lower(trim(issue_key)) = 'property_tax_rate'
      and (
        (
          stance_params is not null
          and (stance_params ? 'rate_delta')
          and (stance_params ? 'earmark_services_pct')
        )
        or stance_key in ('progressive', 'moderate', 'conservative')
      )
    )
    or (
      lower(trim(issue_key)) <> 'property_tax_rate'
      and stance_key in ('progressive', 'moderate', 'conservative')
    )
  );

create or replace function public._clamp_property_tax_rate_delta(p_value numeric)
returns numeric
language sql
immutable
as $$
  select greatest(-5::numeric, least(15::numeric, coalesce(p_value, 0)));
$$;

create or replace function public._clamp_earmark_pct(p_value numeric)
returns numeric
language sql
immutable
as $$
  select greatest(0::numeric, least(100::numeric, coalesce(p_value, 0)));
$$;

-- Sign-preserving power curve (exponent 1.7) — mirrors web/src/lib/city-ordinance-scoring.ts
create or replace function public._economic_score_from_rate_delta(p_rate_delta numeric)
returns smallint
language plpgsql
immutable
as $$
declare
  rd numeric := public._clamp_property_tax_rate_delta(p_rate_delta);
  norm numeric;
begin
  if abs(rd) < 0.001 then return 0; end if;

  if rd < 0 then
    norm := rd / (-5::numeric);
    return round(-(power(abs(norm), 1.7) * 88))::smallint;
  end if;

  norm := rd / 15::numeric;
  return round(power(norm, 1.7) * 95)::smallint;
end;
$$;

create or replace function public._social_score_from_earmark(p_earmark_pct numeric)
returns smallint
language sql
immutable
as $$
  select round(
    35 + (public._clamp_earmark_pct(p_earmark_pct) / 100.0) * (-45 - 35)
  )::smallint;
$$;

create or replace function public._score_property_tax_ordinance(p_stance_params jsonb)
returns table (issue_economic smallint, issue_social smallint)
language sql
immutable
as $$
  select
    public._economic_score_from_rate_delta((p_stance_params->>'rate_delta')::numeric),
    public._social_score_from_earmark((p_stance_params->>'earmark_services_pct')::numeric);
$$;

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
begin
  issue_economic := 0;
  issue_social := 0;

  if cat = 'taxes' and issue = 'property_tax_rate' and p_stance_params is not null then
    select * into pt_scores from public._score_property_tax_ordinance(p_stance_params);
    issue_economic := pt_scores.issue_economic;
    issue_social := pt_scores.issue_social;
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

create or replace function public._property_tax_policy_deltas(p_stance_params jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  rd numeric := public._clamp_property_tax_rate_delta((p_stance_params->>'rate_delta')::numeric);
  earmark numeric := public._clamp_earmark_pct((p_stance_params->>'earmark_services_pct')::numeric) / 100.0;
  tax_norm numeric;
  magnitude numeric;
  tax_burden smallint;
  infra smallint;
  housing smallint;
begin
  if abs(rd) < 0.001 then
    return jsonb_build_object('tax_burden', 0, 'infrastructure_capital', 0, 'housing_subsidy', 0);
  end if;

  if rd < 0 then
    tax_norm := power(abs(rd / (-5::numeric)), 1.7);
    tax_burden := round(-tax_norm * 7)::smallint;
    housing := round(tax_norm * (1 - earmark) * 4)::smallint;
    infra := round(tax_norm * earmark * 2)::smallint;
    return jsonb_build_object(
      'tax_burden', tax_burden,
      'housing_subsidy', housing,
      'infrastructure_capital', infra
    );
  end if;

  tax_norm := power(rd / 15::numeric, 1.7);
  magnitude := tax_norm * 7;
  tax_burden := round(magnitude)::smallint;
  infra := round(magnitude * earmark * 0.85)::smallint;
  housing := round(magnitude * (1 - earmark) * 0.45)::smallint;
  return jsonb_build_object(
    'tax_burden', tax_burden,
    'infrastructure_capital', infra,
    'housing_subsidy', case when housing > 0 then housing else 0 end
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

create or replace function public._apply_ordinance_effects(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  deltas jsonb;
  dept_key text;
  head record;
  briefing_body text;
  effect_summary text;
begin
  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance not found'; end if;

  deltas := public._ordinance_sim_effect_deltas(
    p.category, p.issue_key, p.stance_key, p.stance_params
  );
  perform public._apply_city_metric_deltas('MB', deltas);

  effect_summary := trim(both ', ' from concat_ws(', ',
    case when coalesce((deltas->>'public_safety')::int, 0) <> 0
      then format('public safety %+s', deltas->>'public_safety') end,
    case when coalesce((deltas->>'education_quality')::int, 0) <> 0
      then format('education %+s', deltas->>'education_quality') end,
    case when coalesce((deltas->>'housing_affordability')::int, 0) <> 0
      then format('housing %+s', deltas->>'housing_affordability') end,
    case when coalesce((deltas->>'business_climate')::int, 0) <> 0
      then format('business climate %+s', deltas->>'business_climate') end,
    case when coalesce((deltas->>'mayor_approval')::int, 0) <> 0
      then format('mayor approval %+s', deltas->>'mayor_approval') end,
    case when coalesce((deltas->>'economy_index')::int, 0) <> 0
      then format('economy %+s', deltas->>'economy_index') end,
    case when coalesce((deltas->>'property_tax_rate_pct')::numeric, 0) <> 0
      then format('property tax %+s%%', deltas->>'property_tax_rate_pct') end
  ));

  insert into public.city_sim_effect_events (city_code, source_type, source_id, title, summary, effects)
  values (
    'MB', 'ordinance', p.id, p.title,
    coalesce(nullif(effect_summary, ''), 'Policy enacted with minimal immediate metric shift.'),
    deltas
  );

  dept_key := public._ordinance_effect_department_key(p.category, p.issue_key);
  select sp.id, sp.character_name into head
  from public.city_department_heads h
  join public.sim_politicians sp on sp.id = h.sim_politician_id
  where h.department_key = dept_key;

  briefing_body := format(
    '%s reports that Local Law "%s" is now in effect. Implementation begins immediately across relevant agency lines.',
    coalesce(head.character_name, 'The department head'),
    p.title
  );
  if effect_summary <> '' then
    briefing_body := briefing_body || E'\n\nModeled city impacts: ' || effect_summary || '.';
  end if;
  briefing_body := briefing_body || E'\n\n' || coalesce(nullif(p.summary, ''), 'See council filing for full policy text.');

  insert into public.city_briefings (user_id, title, body, kind, source_type, source_id)
  select g.user_id,
    format('Ordinance enacted: %s', p.title),
    briefing_body,
    'ordinance_enacted',
    'ordinance',
    p.id
  from public.government_role_grants g
  where g.role_key in ('council_member', 'mayor', 'admin');

  return deltas;
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
  scores record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'admin')
  ) and not v_is_admin then
    raise exception 'Only council members may propose ordinances';
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
  else
    if stance not in ('progressive', 'moderate', 'conservative') then
      raise exception 'Invalid stance';
    end if;
    select * into scores from public._ordinance_issue_scores(cat, issue, stance, null);
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Ordinance title is required';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'council_vote') then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, stance_params, title, summary, status,
    issue_economic_score, issue_social_score
  ) values (
    v_uid, cat, trim(p_issue_key),
    case when issue = 'property_tax_rate' then null else stance end,
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

create or replace function public.preview_ordinance_council_vote(
  p_category text,
  p_issue_key text,
  p_stance_key text default null,
  p_issue_economic smallint default null,
  p_issue_social smallint default null,
  p_stance_params jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  scores record;
  cm record;
  vote text;
  yeas smallint := 0;
  nays smallint := 0;
  rows jsonb := '[]'::jsonb;
  econ smallint;
  soc smallint;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if p_issue_economic is not null and p_issue_social is not null then
    econ := p_issue_economic;
    soc := p_issue_social;
  else
    select * into scores from public._ordinance_issue_scores(
      lower(trim(p_category)),
      lower(trim(p_issue_key)),
      lower(trim(coalesce(p_stance_key, ''))),
      p_stance_params
    );
    econ := scores.issue_economic;
    soc := scores.issue_social;
  end if;

  for cm in
    select c.seat_label, sp.id as sim_politician_id, sp.character_name, sp.party
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    vote := public._npc_ideology_vote(
      cm.sim_politician_id, econ, soc, p_stance_key
    );
    if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    rows := rows || jsonb_build_array(jsonb_build_object(
      'ward_code', cm.seat_label,
      'voter_label', cm.character_name,
      'party', cm.party,
      'vote', vote
    ));
  end loop;

  return jsonb_build_object(
    'yeas', yeas,
    'nays', nays,
    'passes', yeas >= 4,
    'roll_call', rows,
    'issue_economic_score', econ,
    'issue_social_score', soc
  );
end;
$$;

grant execute on function public.council_propose_ordinance(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.preview_ordinance_council_vote(text, text, text, smallint, smallint, jsonb) to authenticated;

notify pgrst, 'reload schema';
