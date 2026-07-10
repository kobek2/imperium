-- Real-time city automation: wall-clock elections, biennial budget, no manual turn advance.
-- 1 IRL week = 4 sim years (42h/year). Election/budget cycle = 84h (3.5 days = 2 sim years).

alter type public.city_turn_phase add value if not exists 'legislative';

alter table public.city_sim_engine_state
  add column if not exists epoch_started_at timestamptz not null default now(),
  add column if not exists last_cycle_index bigint not null default -1,
  add column if not exists last_cycle_phase text,
  add column if not exists class_b_cycle_opened bigint not null default -1;

update public.city_sim_engine_state
set epoch_started_at = coalesce(updated_at, now())
where epoch_started_at is null;

-- ─── Time constants (hours) ───────────────────────────────────────────────────

create or replace function public._city_sim_year_hours()
returns numeric language sql immutable as $$ select 42::numeric; $$;

create or replace function public._city_cycle_hours()
returns numeric language sql immutable as $$ select 84::numeric; $$;

create or replace function public._city_signups_hours()
returns numeric language sql immutable as $$ select 12::numeric; $$;

create or replace function public._city_primary_hours()
returns numeric language sql immutable as $$ select 12::numeric; $$;

create or replace function public._city_general_hours()
returns numeric language sql immutable as $$ select 24::numeric; $$;

create or replace function public._city_budget_cycle_years()
returns smallint language sql immutable as $$ select 2::smallint; $$;

create or replace function public._city_elapsed_hours(p_epoch timestamptz)
returns numeric
language sql
stable
as $$
  select greatest(extract(epoch from (now() - coalesce(p_epoch, now()))) / 3600.0, 0);
$$;

create or replace function public._city_sim_year_from_epoch(p_epoch timestamptz)
returns smallint
language sql
stable
as $$
  select (floor(public._city_elapsed_hours(p_epoch) / public._city_sim_year_hours()) + 1)::smallint;
$$;

create or replace function public._city_cycle_index_from_epoch(p_epoch timestamptz)
returns bigint
language sql
stable
as $$
  select floor(public._city_elapsed_hours(p_epoch) / public._city_cycle_hours())::bigint;
$$;

create or replace function public._city_position_in_cycle_hours(p_epoch timestamptz)
returns numeric
language sql
stable
as $$
  select public._city_elapsed_hours(p_epoch) - (public._city_cycle_index_from_epoch(p_epoch) * public._city_cycle_hours());
$$;

create or replace function public._city_biennium_index_from_epoch(p_epoch timestamptz)
returns smallint
language sql
stable
as $$
  select (public._city_cycle_index_from_epoch(p_epoch) + 1)::smallint;
$$;

-- sign_ups | primaries | generals | legislative
create or replace function public._city_cycle_phase_from_epoch(p_epoch timestamptz)
returns text
language sql
stable
as $$
  select case
    when public._city_position_in_cycle_hours(p_epoch) < public._city_signups_hours() then 'sign_ups_open'
    when public._city_position_in_cycle_hours(p_epoch) < public._city_signups_hours() + public._city_primary_hours() then 'primaries'
    when public._city_position_in_cycle_hours(p_epoch) < public._city_signups_hours() + public._city_primary_hours() + public._city_general_hours() then 'generals'
    else 'legislative'
  end;
$$;

create or replace function public._city_biennial_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._city_fiscal_revenue_millions(p_city_code), 0) * public._city_budget_cycle_years();
$$;

create or replace function public._city_biennial_office_salary_gdp_usd(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._city_annual_office_salary_gdp_usd(p_city_code), 0) * public._city_budget_cycle_years();
$$;

create or replace function public._city_biennium_budget_enacted(p_biennium smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.city_budgets b
    where b.fiscal_year = p_biennium and b.status = 'enacted'
  );
$$;

-- ─── Salary: 24h window forfeit (not tied to sim turns) ───────────────────────

create or replace function public._city_forfeit_expired_salary_windows(p_city_code char(2) default 'MB')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  rec record;
begin
  for rec in
    select user_id
    from public.city_office_salary_ledger l
    where l.city_code = p_city_code
      and l.collection_deadline_at is not null
      and l.collection_deadline_at <= now()
      and l.accrued_usd > 0
      and l.collected_at is null
      and exists (
        select 1 from public.government_role_grants g
        where g.user_id = l.user_id and g.role_key = l.role_key
      )
  loop
    update public.city_office_salary_ledger
    set
      accrued_usd = 0,
      accrual_capped = false,
      turn_started_at = now(),
      collection_deadline_at = now() + interval '24 hours',
      last_accrual_at = null,
      updated_at = now()
    where user_id = rec.user_id;
    n := n + 1;
  end loop;

  if n > 0 then
    perform public._sync_city_office_salary_pool_column(p_city_code);
  end if;
  return n;
end;
$$;

-- ─── City elections with wall-clock windows ───────────────────────────────────

create or replace function public._city_open_election_cycle(
  p_city_code char(2),
  p_sim_year smallint,
  p_filing_starts_at timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  active_class char(1) := public._city_active_council_class(p_sim_year);
  mayor_on boolean := public._city_mayor_election_active(p_sim_year);
  created int := 0;
  t0 timestamptz := coalesce(p_filing_starts_at, now());
begin
  if mayor_on and not exists (
    select 1 from public.elections e
    where e.office = 'mayor' and e.state = 'MB' and e.city_sim_year = p_sim_year
  ) then
    insert into public.elections (
      office, state, phase, filing_opens_at, filing_closes_at,
      primary_closes_at, general_closes_at, primary_party_wide,
      filing_window_started_at, city_sim_year, oath_pending
    ) values (
      'mayor', 'MB', 'filing', t0, t0 + interval '12 hours',
      t0 + interval '24 hours', t0 + interval '48 hours', true,
      t0, p_sim_year, false
    );
    created := created + 1;
  end if;

  for w in
    select code from public.wards
    where city_code = p_city_code and election_class = active_class
    order by code
  loop
    if not exists (
      select 1 from public.elections e
      where e.office = 'council_ward' and e.ward_code = w.code and e.city_sim_year = p_sim_year
    ) then
      insert into public.elections (
        office, state, ward_code, phase, filing_opens_at, filing_closes_at,
        primary_closes_at, general_closes_at, primary_party_wide,
        filing_window_started_at, city_sim_year, oath_pending
      ) values (
        'council_ward', 'MB', w.code, 'filing', t0, t0 + interval '12 hours',
        t0 + interval '24 hours', t0 + interval '48 hours', true,
        t0, p_sim_year, false
      );
      created := created + 1;
    end if;
  end loop;

  return created;
end;
$$;

create or replace function public._city_advance_mb_election_phases()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  opened_primary int := 0;
  closed_primary int := 0;
  closed_general int := 0;
begin
  update public.elections e
  set phase = 'primary'::public.election_phase
  where public._city_is_mb_election(e.office::text, e.state)
    and e.phase = 'filing'::public.election_phase
    and e.filing_window_started_at is not null
    and e.filing_closes_at is not null
    and e.filing_closes_at <= now();

  for r in
    select e.id from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.phase = 'primary'::public.election_phase
      and e.primary_closes_at is not null
      and e.primary_closes_at <= now()
  loop
    begin
      perform public._close_primary_for_election(r.id);
      update public.elections set phase = 'general'::public.election_phase where id = r.id;
      closed_primary := closed_primary + 1;
    exception when others then
      raise warning '_city_advance_mb_election_phases: primary close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select e.id from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.phase = 'general'::public.election_phase
      and e.general_closes_at is not null
      and e.general_closes_at <= now()
  loop
    begin
      perform public.tick_npc_campaigns(r.id);
      perform public._close_general_for_election(r.id);
      closed_general := closed_general + 1;
    exception when others then
      raise warning '_city_advance_mb_election_phases: general close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'opened_primary', opened_primary,
    'closed_primary', closed_primary,
    'closed_general', closed_general
  );
end;
$$;

-- ─── Main scheduler (cron + page-load backup) ─────────────────────────────────

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
  cycle_start timestamptz;
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

  if eng.last_cycle_phase is distinct from phase then
    phase_changed := true;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  salary_forfeited := public._city_forfeit_expired_salary_windows(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  -- New biennium cycle: open Class A + Mayor elections and budget window.
  if cycle_idx <> coalesce(eng.last_cycle_index, -1) then
    cycle_start := epoch + make_interval(hours => (cycle_idx * public._city_cycle_hours())::int);
    elections_opened := public._city_open_election_cycle(
      p_city_code,
      (cycle_idx * 2 + 1)::smallint,
      cycle_start
    );
  end if;

  -- Mid-cycle (hour 42): open Class B elections for the even sim year in this biennium.
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
    'budget_enacted', public._city_biennium_budget_enacted(biennium),
    'ordinances_allowed', phase = 'legislative' and public._city_biennium_budget_enacted(biennium),
    'elections_opened', elections_opened,
    'class_b_opened', class_b_opened,
    'salary_forfeited', salary_forfeited,
    'election_track', election_out
  );
end;
$$;

-- ─── Status RPC (runs scheduler tick, returns phase + notification flags) ─────

create or replace function public.get_city_sim_week_status(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tick jsonb;
  epoch timestamptz;
  pos numeric;
  phase text;
  phase_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  tick := public.tick_city_realtime_scheduler(p_city_code);

  select epoch_started_at into epoch
  from public.city_sim_engine_state where city_code = p_city_code;

  pos := public._city_position_in_cycle_hours(epoch);
  phase := tick->>'cycle_phase';

  phase_end := epoch + make_interval(hours => (
    public._city_cycle_index_from_epoch(epoch) * public._city_cycle_hours()
    + case phase
        when 'sign_ups_open' then public._city_signups_hours()
        when 'primaries' then public._city_signups_hours() + public._city_primary_hours()
        when 'generals' then public._city_signups_hours() + public._city_primary_hours() + public._city_general_hours()
        else public._city_cycle_hours()
      end
  )::int);

  return tick || jsonb_build_object(
    'city_code', p_city_code,
    'sim_tick', (select sim_tick from public.city_sim_engine_state where city_code = p_city_code),
    'sim_week', tick->'sim_year',
    'sim_turn', null,
    'turn_phase', tick->'cycle_phase',
    'phase_ends_at', phase_end,
    'elapsed_hours_in_phase', round(pos - case phase
      when 'sign_ups_open' then 0
      when 'primaries' then public._city_signups_hours()
      when 'generals' then public._city_signups_hours() + public._city_primary_hours()
      else public._city_signups_hours() + public._city_primary_hours() + public._city_general_hours()
    end, 2)
  );
end;
$$;

-- ─── Disable manual turn advance ──────────────────────────────────────────────

create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.tick_city_realtime_scheduler(p_city_code);
end;
$$;

create or replace function public.admin_advance_city_sim_turn(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.tick_city_realtime_scheduler(p_city_code);
end;
$$;

-- ─── Budget: biennial, sign-ups window only ───────────────────────────────────

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
  phase text;
  biennium smallint;
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
  phase := public._city_cycle_phase_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);

  if phase <> 'sign_ups_open' then
    raise exception 'City budget may only be proposed during the sign-ups window at the start of each biennium cycle';
  end if;

  if public._city_biennium_budget_enacted(biennium) then
    raise exception 'A budget for biennium % has already been enacted', biennium;
  end if;

  if exists (select 1 from public.city_budgets where status in ('proposed', 'council_vote', 'awaiting_mayor')) then
    raise exception 'A budget is already pending council action or mayor signature';
  end if;

  rev := public._city_biennial_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;
  fy := biennium;

  insert into public.city_budgets (
    fiscal_year, status, proposed_by,
    projected_revenue_millions, projected_expenditure_millions, projected_deficit_millions
  ) values (
    fy, 'council_vote', v_uid, rev, exp, def
  )
  returning id into budget_id;

  insert into public.city_budget_lines (budget_id, department_key, amount_millions) values
    (budget_id, 'finance', coalesce(f, 0)),
    (budget_id, 'police', coalesce(pol, 0)),
    (budget_id, 'public_works', coalesce(pw, 0)),
    (budget_id, 'parks', coalesce(pk, 0)),
    (budget_id, 'planning', coalesce(pl, 0));

  if not exists (
    select 1 from public.campaign_caucus_members where chamber = 'council' and holder_user_id is not null
  ) then
    return public.finalize_city_budget_vote(budget_id);
  end if;

  return jsonb_build_object('ok', true, 'budget_id', budget_id, 'fiscal_year', fy, 'biennium', true);
end;
$$;

-- ─── Legislation gates (budget enacted + legislative window) ──────────────────

create or replace function public._city_assert_legislation_allowed()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  epoch timestamptz;
  phase text;
  biennium smallint;
begin
  select epoch_started_at into epoch from public.city_sim_engine_state where city_code = 'MB';
  phase := public._city_cycle_phase_from_epoch(epoch);
  biennium := public._city_biennium_index_from_epoch(epoch);

  if phase <> 'legislative' then
    raise exception 'Ordinances may only be proposed or voted during the legislative window (after election season ends)';
  end if;

  if not public._city_biennium_budget_enacted(biennium) then
    raise exception 'The biennium budget must be enacted before council legislation';
  end if;
end;
$$;

-- Patch propose: prepend gate check to latest parametric body.
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

grant execute on function public._city_assert_legislation_allowed() to authenticated, service_role;
grant execute on function public.council_ordinance_vote(uuid, text) to authenticated;

grant execute on function public.tick_city_realtime_scheduler(char) to authenticated, service_role;
grant execute on function public._city_biennial_fiscal_revenue_millions(char) to authenticated, service_role;
grant execute on function public._city_biennium_budget_enacted(smallint) to authenticated, service_role;

notify pgrst, 'reload schema';
