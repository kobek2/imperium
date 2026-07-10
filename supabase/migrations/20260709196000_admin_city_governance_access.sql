-- Allow staff admins and users with the admin role grant to exercise council governance
-- RPCs for testing (propose/vote on budget and ordinances).

create or replace function public.council_member_budget_vote(
  p_budget_id uuid,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vote text := lower(trim(coalesce(p_vote, '')));
  v_is_admin boolean;
  b record;
  cm record;
  player_votes smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if v_vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'admin')
  ) and not v_is_admin then
    raise exception 'Only council members may vote on the budget';
  end if;

  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  if not v_is_admin then
    select * into cm from public.campaign_caucus_members
    where chamber = 'council' and holder_user_id = v_uid;
    if cm.sim_politician_id is null then
      raise exception 'Your ward is not seated on the council caucus roster — ask admin to sync caucus';
    end if;
  end if;

  insert into public.city_budget_member_votes (budget_id, user_id, vote)
  values (p_budget_id, v_uid, v_vote)
  on conflict (budget_id, user_id) do update set vote = excluded.vote, voted_at = now();

  if v_is_admin then
    return public.finalize_city_budget_vote(p_budget_id);
  end if;

  select count(*)::smallint into player_votes
  from public.city_budget_member_votes where budget_id = p_budget_id;

  if player_votes >= (
    select count(*)::smallint from public.campaign_caucus_members
    where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(p_budget_id);
  end if;

  return jsonb_build_object('ok', true, 'pending', true, 'player_votes', player_votes);
end;
$$;

create or replace function public.council_propose_ordinance(
  p_category text,
  p_issue_key text,
  p_stance_key text,
  p_title text,
  p_summary text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  proposal_id uuid;
  cat text := lower(trim(coalesce(p_category, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only council members may propose ordinances';
  end if;

  if cat not in ('taxes', 'crime', 'economy', 'education') then
    raise exception 'Invalid policy category';
  end if;

  if stance not in ('progressive', 'moderate', 'conservative') then
    raise exception 'Invalid stance';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Ordinance title is required';
  end if;

  if exists (
    select 1 from public.city_ordinance_proposals where status = 'council_vote'
  ) then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, title, summary, status
  ) values (
    v_uid, cat, trim(p_issue_key), stance, trim(p_title), coalesce(p_summary, ''), 'council_vote'
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

create or replace function public.council_ordinance_vote(
  p_proposal_id uuid,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vote text := lower(trim(coalesce(p_vote, '')));
  v_is_admin boolean;
  p record;
  cm record;
  player_votes smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if v_vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  v_is_admin := public.is_staff_admin(v_uid);

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('council_member', 'admin')
  ) and not v_is_admin then
    raise exception 'Only council members may vote on ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_proposal_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'council_vote' then raise exception 'Proposal is not open for council vote'; end if;

  if not v_is_admin then
    select * into cm from public.campaign_caucus_members
    where chamber = 'council' and holder_user_id = v_uid;
    if cm.sim_politician_id is null then
      raise exception 'Your ward is not seated on the council caucus roster — ask admin to sync caucus';
    end if;
  end if;

  insert into public.city_ordinance_member_votes (proposal_id, user_id, vote)
  values (p_proposal_id, v_uid, v_vote)
  on conflict (proposal_id, user_id) do update set vote = excluded.vote, voted_at = now();

  if v_is_admin then
    return public.finalize_city_ordinance_vote(p_proposal_id);
  end if;

  select count(*)::smallint into player_votes
  from public.city_ordinance_member_votes where proposal_id = p_proposal_id;

  if player_votes >= (
    select count(*)::smallint from public.campaign_caucus_members
    where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_ordinance_vote(p_proposal_id);
  end if;

  return jsonb_build_object('ok', true, 'pending', true, 'player_votes', player_votes);
end;
$$;

grant execute on function public.council_member_budget_vote(uuid, text) to authenticated;
grant execute on function public.council_propose_ordinance(text, text, text, text, text) to authenticated;
grant execute on function public.council_ordinance_vote(uuid, text) to authenticated;

notify pgrst, 'reload schema';
