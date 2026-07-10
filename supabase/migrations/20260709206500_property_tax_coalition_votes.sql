-- Property tax continuous bills: derive caucus lane from economic score so NPC whip can reach 4/7.

create or replace function public._property_tax_coalition_key(p_economic smallint)
returns text
language sql
immutable
as $$
  select case
    when p_economic <= -15 then 'progressive'
    when p_economic >= 20 then 'conservative'
    when abs(p_economic) <= 15 then 'moderate'
    else null
  end;
$$;

create or replace function public._npc_ideology_vote(
  p_sim_politician_id uuid,
  p_issue_economic smallint,
  p_issue_social smallint,
  p_stance_key text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sp record;
  dist numeric;
  party_adj numeric := 0;
  stance text := lower(trim(coalesce(p_stance_key, '')));
begin
  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.id is null then return 'nay'; end if;

  -- Compromise bills: NYC council Democrats usually hold together; Rs split on pragmatism.
  if stance = 'moderate' then
    if sp.party = 'democrat' then return 'yea'; end if;
    if sp.ideology_pragmatism >= 62 then return 'yea'; end if;
    return 'nay';
  end if;

  -- Revenue / surcharge hikes: Republican caucus lines up (lowered for continuous property tax).
  if stance = 'conservative' and p_issue_economic >= 20 and sp.party = 'republican' then
    return 'yea';
  end if;

  -- Tax relief / progressive cuts: Democratic caucus holds (continuous scores can be more extreme).
  if stance = 'progressive' and p_issue_economic <= -15 and sp.party = 'democrat' then
    return 'yea';
  end if;

  dist := abs(sp.ideology_economic - p_issue_economic) + abs(sp.ideology_social - p_issue_social);

  if sp.party = 'democrat' and p_issue_economic < 0 then party_adj := -15;
  elsif sp.party = 'republican' and p_issue_economic > 0 then party_adj := -15;
  end if;

  dist := greatest(dist + party_adj, 0);

  if dist <= 50 then return 'yea'; end if;
  if dist <= 80 and sp.ideology_pragmatism >= 55 then return 'yea'; end if;
  if dist <= 65 and sp.ideology_pragmatism >= 72 then return 'yea'; end if;
  return 'nay';
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

  if exists (select 1 from public.city_ordinance_proposals where status = 'council_vote') then
    raise exception 'Another ordinance is already pending a council vote';
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
  coalition text := lower(trim(coalesce(p_stance_key, '')));
  issue text := lower(trim(p_issue_key));
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if p_issue_economic is not null and p_issue_social is not null then
    econ := p_issue_economic;
    soc := p_issue_social;
  else
    select * into scores from public._ordinance_issue_scores(
      lower(trim(p_category)),
      issue,
      coalition,
      p_stance_params
    );
    econ := scores.issue_economic;
    soc := scores.issue_social;
  end if;

  if issue = 'property_tax_rate' and coalition = '' then
    coalition := coalesce(public._property_tax_coalition_key(econ), '');
  end if;

  for cm in
    select c.seat_label, sp.id as sim_politician_id, sp.character_name, sp.party
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    vote := public._npc_ideology_vote(
      cm.sim_politician_id, econ, soc, nullif(coalition, '')
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
    'issue_social_score', soc,
    'coalition_key', nullif(coalition, '')
  );
end;
$$;

grant execute on function public._property_tax_coalition_key(smallint) to authenticated;

notify pgrst, 'reload schema';
