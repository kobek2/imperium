-- 12-hour council vote window when player-held seats exist; early close when all players vote.

alter table public.city_ordinance_proposals
  add column if not exists council_vote_closes_at timestamptz;

alter table public.city_budgets
  add column if not exists council_vote_closes_at timestamptz;

create or replace function public._city_council_player_seat_count()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::smallint
  from public.campaign_caucus_members
  where chamber = 'council' and holder_user_id is not null;
$$;

create or replace function public._city_council_vote_deadline_interval()
returns interval
language sql
immutable
as $$
  select interval '12 hours';
$$;

create or replace function public._city_advance_expired_council_votes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  ord_closed int := 0;
  bud_closed int := 0;
begin
  for r in
    select id
    from public.city_ordinance_proposals
    where status = 'council_vote'
      and council_vote_closes_at is not null
      and council_vote_closes_at <= now()
  loop
    perform public.finalize_city_ordinance_vote(r.id);
    ord_closed := ord_closed + 1;
  end loop;

  for r in
    select id
    from public.city_budgets
    where status = 'council_vote'
      and council_vote_closes_at is not null
      and council_vote_closes_at <= now()
  loop
    perform public.finalize_city_budget_vote(r.id);
    bud_closed := bud_closed + 1;
  end loop;

  return jsonb_build_object(
    'ordinances_finalized', ord_closed,
    'budgets_finalized', bud_closed
  );
end;
$$;

-- Backfill open votes that predate the deadline column.
update public.city_ordinance_proposals
set council_vote_closes_at = now() + public._city_council_vote_deadline_interval()
where status = 'council_vote'
  and council_vote_closes_at is null
  and public._city_council_player_seat_count() > 0;

update public.city_budgets
set council_vote_closes_at = now() + public._city_council_vote_deadline_interval()
where status = 'council_vote'
  and council_vote_closes_at is null
  and public._city_council_player_seat_count() > 0;

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
  closes_at timestamptz;
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
    issue_economic_score, issue_social_score, council_vote_closes_at
  ) values (
    v_uid, cat, trim(p_issue_key),
    coalition,
    case when issue = any(parametric_issues) then clamped else null end,
    trim(p_title), coalesce(p_summary, ''), 'council_vote',
    scores.issue_economic, scores.issue_social,
    case
      when public._city_council_player_seat_count() > 0
        then now() + public._city_council_vote_deadline_interval()
      else null
    end
  )
  returning id, council_vote_closes_at into proposal_id, closes_at;

  if public._city_council_player_seat_count() = 0 then
    return public.finalize_city_ordinance_vote(proposal_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'proposal_id', proposal_id,
    'status', 'council_vote',
    'vote_closes_at', closes_at
  );
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
  required_votes smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._city_assert_legislation_allowed();
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

  select public._city_council_player_seat_count() into required_votes;
  if required_votes <= 0 then
    return public.finalize_city_ordinance_vote(p_proposal_id);
  end if;

  select count(*)::smallint into player_votes
  from public.city_ordinance_member_votes v
  join public.campaign_caucus_members c
    on c.chamber = 'council' and c.holder_user_id = v.user_id
  where v.proposal_id = p_proposal_id;

  if player_votes >= required_votes then
    return public.finalize_city_ordinance_vote(p_proposal_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'pending', true,
    'player_votes', player_votes,
    'required_votes', required_votes,
    'vote_closes_at', p.council_vote_closes_at
  );
end;
$$;

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
  required_votes smallint;
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

  select public._city_council_player_seat_count() into required_votes;
  if required_votes <= 0 then
    return public.finalize_city_budget_vote(p_budget_id);
  end if;

  select count(*)::smallint into player_votes
  from public.city_budget_member_votes v
  join public.campaign_caucus_members c
    on c.chamber = 'council' and c.holder_user_id = v.user_id
  where v.budget_id = p_budget_id;

  if player_votes >= required_votes then
    return public.finalize_city_budget_vote(p_budget_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'pending', true,
    'player_votes', player_votes,
    'required_votes', required_votes,
    'vote_closes_at', b.council_vote_closes_at
  );
end;
$$;

create or replace function public.mayor_propose_city_budget(
  p_finance numeric default null,
  p_police numeric default null,
  p_public_works numeric default null,
  p_parks numeric default null,
  p_planning numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  budget_id uuid;
  fy smallint;
  rev numeric;
  exp numeric;
  def numeric;
  epoch timestamptz;
  biennium smallint;
  closes_at timestamptz;
  f numeric := coalesce(p_finance, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'finance'));
  pol numeric := coalesce(p_police, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'police'));
  pw numeric := coalesce(p_public_works, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'public_works'));
  pk numeric := coalesce(p_parks, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'parks'));
  pl numeric := coalesce(p_planning, (select amount_millions from public.city_fiscal_department_allocations where city_code = 'MB' and department_key = 'planning'));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may propose the city budget';
  end if;

  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  biennium := public._city_biennium_index_from_epoch(epoch);

  if not public._city_budget_propose_allowed(epoch) then
    raise exception 'City budget may only be proposed during sign-ups or legislative session until the biennium budget is enacted';
  end if;

  if public._city_biennium_budget_in_flight(biennium) then
    raise exception 'A budget is already pending council action or mayor signature for this biennium';
  end if;

  rev := public._city_biennial_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;
  fy := biennium;
  closes_at := case
    when public._city_council_player_seat_count() > 0
      then now() + public._city_council_vote_deadline_interval()
    else null
  end;

  insert into public.city_budgets (
    fiscal_year, status, proposed_by,
    projected_revenue_millions, projected_expenditure_millions, projected_deficit_millions,
    council_vote_closes_at
  ) values (
    fy, 'council_vote', v_uid, rev, exp, def, closes_at
  )
  returning id into budget_id;

  insert into public.city_budget_lines (budget_id, department_key, amount_millions) values
    (budget_id, 'finance', coalesce(f, 0)),
    (budget_id, 'police', coalesce(pol, 0)),
    (budget_id, 'public_works', coalesce(pw, 0)),
    (budget_id, 'parks', coalesce(pk, 0)),
    (budget_id, 'planning', coalesce(pl, 0));

  if public._city_council_player_seat_count() = 0 then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'budget_id', budget_id,
    'fiscal_year', fy,
    'biennium', true,
    'vote_closes_at', closes_at
  );
end;
$$;

create or replace function public.tick_city_realtime_scheduler(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  eng record;
  epoch timestamptz;
  elapsed numeric;
  cycle_idx bigint;
  pos numeric;
  phase text;
  sim_yr smallint;
  biennium smallint;
  even_yr smallint;
  phase_changed boolean := false;
  elections_opened int := 0;
  class_b_opened int := 0;
  salary_forfeited int := 0;
  election_out jsonb;
  council_vote_out jsonb;
  cycle_start timestamptz;
  budget_passed boolean;
begin
  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week, turn_phase, epoch_started_at)
    values (p_city_code, 0, 1, 1, 'sign_ups_open', now())
    returning * into eng;
  end if;

  epoch := coalesce(eng.epoch_started_at, now());
  elapsed := public._city_elapsed_hours(epoch);
  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  pos := public._city_position_in_cycle_hours(epoch);
  phase := public._city_cycle_phase_from_epoch(epoch);
  sim_yr := public._city_sim_year_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;
  budget_passed := public._city_biennium_budget_passed(biennium);

  if eng.last_cycle_phase is distinct from phase then
    phase_changed := true;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  salary_forfeited := public._city_forfeit_expired_salary_windows(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);
  council_vote_out := public._city_advance_expired_council_votes();

  if cycle_idx <> coalesce(eng.last_cycle_index, -1) then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours())::int);
    elections_opened := public._city_open_election_cycle(
      p_city_code,
      (cycle_idx * 2 + 1)::smallint,
      cycle_start
    );
  end if;

  if pos >= public._city_sim_year_hours()
     and coalesce(eng.class_b_cycle_opened, -1) <> cycle_idx then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours() + public._city_sim_year_hours())::int);
    class_b_opened := public._city_open_election_cycle(p_city_code, even_yr, cycle_start);
    update public.city_sim_engine_state
    set class_b_cycle_opened = cycle_idx
    where city_code = p_city_code;
  end if;

  election_out := public._city_advance_mb_election_phases();

  update public.city_sim_engine_state
  set
    sim_year = sim_yr,
    sim_week = 1,
    turn_phase = phase::public.city_turn_phase,
    last_cycle_index = cycle_idx,
    last_cycle_phase = phase,
    updated_at = now()
  where city_code = p_city_code;

  update public.city_fiscal_metrics
  set fiscal_year = biennium, updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'sim_year', sim_yr,
    'biennium_index', biennium,
    'cycle_index', cycle_idx,
    'cycle_phase', phase,
    'position_in_cycle_hours', round(pos, 2),
    'phase_changed', phase_changed,
    'active_council_class', public._city_active_council_class(sim_yr),
    'mayor_election_active', public._city_mayor_election_active(sim_yr),
    'budget_proposal_open', phase = 'sign_ups_open',
    'budget_propose_allowed', public._city_budget_propose_allowed(epoch),
    'budget_enacted', public._city_biennium_budget_enacted(biennium),
    'budget_passed', budget_passed,
    'ordinances_allowed', phase = 'legislative' and budget_passed,
    'elections_opened', elections_opened,
    'class_b_opened', class_b_opened,
    'salary_forfeited', salary_forfeited,
    'election_track', election_out,
    'council_votes', council_vote_out
  );
end;
$$;

grant execute on function public._city_council_player_seat_count() to authenticated, service_role;
grant execute on function public._city_advance_expired_council_votes() to authenticated, service_role;

notify pgrst, 'reload schema';
