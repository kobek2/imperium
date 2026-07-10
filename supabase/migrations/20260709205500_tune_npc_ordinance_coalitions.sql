-- Tune NPC ordinance voting so moderate/progressive bills can reach 4/7 on a 4D–3R council.

create or replace function public._ordinance_issue_scores(
  p_category text,
  p_issue_key text,
  p_stance_key text,
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
begin
  issue_economic := 0;
  issue_social := 0;

  if cat = 'taxes' and issue = 'property_tax_rate' then
    -- Progressive cut aligned with Mamdani/AOC wing (was -55 / -25, too centrist for 4D coalition).
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

  -- Clear conservative revenue bills: Republican caucus lines up.
  if stance = 'conservative' and p_issue_economic >= 30 and sp.party = 'republican' then
    return 'yea';
  end if;

  -- Clear progressive spending/tax-cut bills: Democratic caucus lines up when issue is left of center.
  if stance = 'progressive' and p_issue_economic <= -35 and sp.party = 'democrat' then
    dist := abs(sp.ideology_economic - p_issue_economic) + abs(sp.ideology_social - p_issue_social);
    if dist <= 95 then return 'yea'; end if;
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

create or replace function public.finalize_city_ordinance_vote(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  cm record;
  vote text;
  yeas smallint := 0;
  nays smallint := 0;
  player_voted boolean;
  v_label text;
  v_user_id uuid;
begin
  select * into p from public.city_ordinance_proposals where id = p_proposal_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'council_vote' then raise exception 'Proposal is not open for council vote'; end if;

  delete from public.city_ordinance_roll_calls where proposal_id = p_proposal_id;

  for cm in
    select c.party, c.holder_user_id, c.seat_label, c.sim_politician_id, sp.character_name
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    v_user_id := cm.holder_user_id;
    v_label := cm.character_name;

    if cm.holder_user_id is not null then
      select v.vote, coalesce(pr.character_name, pr.discord_username, cm.character_name)
      into vote, v_label
      from public.city_ordinance_member_votes v
      left join public.profiles pr on pr.id = v.user_id
      where v.proposal_id = p_proposal_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_ideology_vote(
        cm.sim_politician_id, p.issue_economic_score, p.issue_social_score, p.stance_key
      );
      v_user_id := null;
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;

    insert into public.city_ordinance_roll_calls (
      proposal_id, ward_code, voter_label, sim_politician_id, user_id, vote
    ) values (
      p_proposal_id, cm.seat_label, coalesce(v_label, cm.character_name), cm.sim_politician_id, v_user_id, vote
    );
  end loop;

  update public.city_ordinance_proposals set council_yeas = yeas, council_nays = nays where id = p_proposal_id;

  if yeas >= 4 then
    update public.city_ordinance_proposals set status = 'awaiting_mayor' where id = p_proposal_id;
    return jsonb_build_object('ok', true, 'passed', true, 'yeas', yeas, 'nays', nays, 'status', 'awaiting_mayor');
  end if;

  update public.city_ordinance_proposals set status = 'rejected' where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'passed', false, 'yeas', yeas, 'nays', nays, 'status', 'rejected');
end;
$$;

grant execute on function public._npc_ideology_vote(uuid, smallint, smallint, text) to authenticated;

create or replace function public.preview_ordinance_council_vote(
  p_category text,
  p_issue_key text,
  p_stance_key text
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
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into scores from public._ordinance_issue_scores(
    lower(trim(p_category)), lower(trim(p_issue_key)), lower(trim(p_stance_key))
  );

  for cm in
    select c.seat_label, sp.id as sim_politician_id, sp.character_name, sp.party
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    vote := public._npc_ideology_vote(
      cm.sim_politician_id, scores.issue_economic, scores.issue_social, p_stance_key
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
    'roll_call', rows
  );
end;
$$;

grant execute on function public.preview_ordinance_council_vote(text, text, text) to authenticated;

notify pgrst, 'reload schema';
