-- Realistic NYC fiscal baseline, intergovernmental aid, NPC ideology voting, budget consequences.

alter table public.city_fiscal_metrics
  add column if not exists intergovernmental_aid_millions numeric not null default 0 check (intergovernmental_aid_millions >= 0);

alter table public.sim_politicians
  add column if not exists ideology_economic smallint not null default 0 check (ideology_economic between -100 and 100),
  add column if not exists ideology_social smallint not null default 0 check (ideology_social between -100 and 100),
  add column if not exists ideology_pragmatism smallint not null default 50 check (ideology_pragmatism between 0 and 100);

alter table public.city_ordinance_proposals
  add column if not exists issue_economic_score smallint not null default 0,
  add column if not exists issue_social_score smallint not null default 0;

alter table public.city_budgets
  add column if not exists projected_revenue_millions numeric,
  add column if not exists projected_expenditure_millions numeric,
  add column if not exists projected_deficit_millions numeric;

-- ---------- Seed realistic NYC macro + department baselines ----------

update public.city_fiscal_metrics set
  population = 8336817,
  avg_household_income = 74000,
  economy_index = 100,
  property_tax_rate_pct = 1.2,
  income_tax_enabled = false,
  income_tax_low_pct = 2.0,
  income_tax_mid_pct = 3.5,
  income_tax_high_pct = 4.5,
  intergovernmental_aid_millions = 8000,
  treasury_balance = 500,
  fiscal_year = 1,
  updated_at = now()
where city_code = 'MB';

update public.city_fiscal_department_allocations set amount_millions = case department_key
  when 'finance' then 1200
  when 'police' then 5800
  when 'public_works' then 2500
  when 'parks' then 700
  when 'planning' then 150
  else amount_millions
end
where city_code = 'MB';

-- ---------- Council NPC ideology (economic: left negative, right positive) ----------

update public.sim_politicians set ideology_economic = -90, ideology_social = -80, ideology_pragmatism = 35 where slug = 'w02-dem';
update public.sim_politicians set ideology_economic = -85, ideology_social = -75, ideology_pragmatism = 40 where slug = 'w04-dem';
update public.sim_politicians set ideology_economic = -35, ideology_social = -30, ideology_pragmatism = 55 where slug = 'w01-dem';
update public.sim_politicians set ideology_economic = -25, ideology_social = -40, ideology_pragmatism = 70 where slug = 'w03-dem';
update public.sim_politicians set ideology_economic = 60, ideology_social = 50, ideology_pragmatism = 45 where slug = 'w05-rep';
update public.sim_politicians set ideology_economic = 75, ideology_social = 85, ideology_pragmatism = 25 where slug = 'w06-rep';
update public.sim_politicians set ideology_economic = 70, ideology_social = 40, ideology_pragmatism = 30 where slug = 'w07-rep';

-- ---------- Fiscal revenue helper (matches TS formulas) ----------

create or replace function public._city_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  economy_mult numeric;
  property_rev numeric;
  income_rev numeric;
  blended_rate numeric;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then return 0; end if;

  economy_mult := case when m.economy_index > 0 then m.economy_index / 100.0 else 1 end;

  if m.population > 0 and m.property_tax_rate_pct > 0 then
    property_rev := (m.population * m.avg_household_income * 0.3 * economy_mult * (m.property_tax_rate_pct / 100.0)) / 1000000.0;
  else
    property_rev := 0;
  end if;

  if m.income_tax_enabled and m.population > 0 then
    blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
    income_rev := (m.population * m.avg_household_income * economy_mult * blended_rate) / 1000000.0;
  else
    income_rev := 0;
  end if;

  return coalesce(m.intergovernmental_aid_millions, 0) + property_rev + income_rev;
end;
$$;

-- ---------- Ordinance issue scores from category / issue / stance ----------

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
    issue_economic := case stance when 'progressive' then -55 when 'conservative' then 45 else 0 end;
    issue_social := case stance when 'progressive' then -25 when 'conservative' then 15 else 0 end;
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
  p_issue_social smallint
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
begin
  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.id is null then return 'nay'; end if;

  dist := abs(sp.ideology_economic - p_issue_economic) + abs(sp.ideology_social - p_issue_social);

  if sp.party = 'democrat' and p_issue_economic < 0 then party_adj := -12;
  elsif sp.party = 'republican' and p_issue_economic > 0 then party_adj := -12;
  end if;

  dist := greatest(dist + party_adj, 0);

  if dist <= 45 then return 'yea'; end if;
  if dist <= 75 and sp.ideology_pragmatism >= 55 then return 'yea'; end if;
  if dist <= 60 and sp.ideology_pragmatism >= 75 then return 'yea'; end if;
  return 'nay';
end;
$$;

create or replace function public._npc_budget_vote(
  p_sim_politician_id uuid,
  p_deficit_millions numeric,
  p_spending_delta_pct numeric
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sp record;
begin
  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.id is null then return 'nay'; end if;

  if sp.ideology_economic >= 55 and (p_deficit_millions > 0 or p_spending_delta_pct > 4) then
    return 'nay';
  end if;

  if sp.ideology_economic <= -55 and p_deficit_millions <= 1200 then
    return 'yea';
  end if;

  if p_deficit_millions <= 0 then return 'yea'; end if;

  if p_deficit_millions <= 350 and sp.ideology_pragmatism >= 60 then return 'yea'; end if;

  if p_deficit_millions > 900 then return 'nay'; end if;

  if p_spending_delta_pct > 8 and sp.ideology_economic >= 20 then return 'nay'; end if;

  return case when sp.ideology_pragmatism >= 50 then 'yea' else 'nay' end;
end;
$$;

-- ---------- get_city_fiscal_snapshot: include aid ----------

create or replace function public.get_city_fiscal_snapshot(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  m record;
  depts jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then raise exception 'City fiscal metrics not found for %', p_city_code; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('department_key', d.department_key, 'amount_millions', d.amount_millions)
      order by d.department_key
    ),
    '[]'::jsonb
  ) into depts
  from public.city_fiscal_department_allocations d
  where d.city_code = p_city_code;

  return jsonb_build_object(
    'city_code', m.city_code,
    'population', m.population,
    'avg_household_income', m.avg_household_income,
    'economy_index', m.economy_index,
    'property_tax_rate_pct', m.property_tax_rate_pct,
    'income_tax_enabled', m.income_tax_enabled,
    'income_tax_low_pct', m.income_tax_low_pct,
    'income_tax_mid_pct', m.income_tax_mid_pct,
    'income_tax_high_pct', m.income_tax_high_pct,
    'intergovernmental_aid_millions', m.intergovernmental_aid_millions,
    'treasury_balance', m.treasury_balance,
    'fiscal_year', m.fiscal_year,
    'updated_at', m.updated_at,
    'departments', depts
  );
end;
$$;

-- ---------- mayor_propose_city_budget: validate deficit, snapshot projections ----------

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
  baseline numeric;
  delta_pct numeric;
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

  if exists (select 1 from public.city_budgets where status in ('proposed', 'council_vote')) then
    raise exception 'A budget is already pending council action';
  end if;

  rev := public._city_fiscal_revenue_millions('MB');
  exp := coalesce(f, 0) + coalesce(pol, 0) + coalesce(pw, 0) + coalesce(pk, 0) + coalesce(pl, 0);
  def := rev - exp;

  if def < -1500 and not public.is_staff_admin(v_uid) then
    raise exception 'Projected deficit exceeds $1,500M — reduce spending or raise taxes before submitting';
  end if;

  select coalesce(max(fiscal_year), 0) + 1 into fy from public.city_budgets where status = 'enacted';
  if fy < 1 then fy := 1; end if;

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

  return jsonb_build_object(
    'ok', true, 'budget_id', budget_id, 'fiscal_year', fy,
    'projected_revenue_millions', rev,
    'projected_expenditure_millions', exp,
    'projected_deficit_millions', def,
    'warning', case when def < 0 then format('Projected annual deficit: $%sM', round(def::numeric, 0)) else null end
  );
end;
$$;

-- ---------- finalize budget: ideology votes + enact consequences ----------

create or replace function public.finalize_city_budget_vote(p_budget_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  cm record;
  vote text;
  yeas smallint := 0;
  nays smallint := 0;
  player_voted boolean;
  rev numeric;
  exp numeric;
  def numeric;
  baseline numeric;
  delta_pct numeric;
  need_yeas smallint := 4;
  line record;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  rev := coalesce(b.projected_revenue_millions, public._city_fiscal_revenue_millions('MB'));
  select coalesce(sum(amount_millions), 0) into exp from public.city_budget_lines where budget_id = p_budget_id;
  def := rev - exp;

  select coalesce(sum(amount_millions), 0) into baseline
  from public.city_fiscal_department_allocations where city_code = 'MB';

  delta_pct := case when baseline > 0 then ((exp - baseline) / baseline) * 100 else 0 end;

  if def < -800 then need_yeas := 5; end if;

  for cm in
    select c.party, c.holder_user_id, c.seat_label, c.sim_politician_id
    from public.campaign_caucus_members c
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    if cm.holder_user_id is not null then
      select v.vote into vote
      from public.city_budget_member_votes v
      where v.budget_id = p_budget_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_budget_vote(cm.sim_politician_id, def, delta_pct);
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;
  end loop;

  update public.city_budgets set
    council_yeas = yeas,
    council_nays = nays,
    projected_revenue_millions = rev,
    projected_expenditure_millions = exp,
    projected_deficit_millions = def
  where id = p_budget_id;

  if yeas >= need_yeas then
    update public.city_budgets set status = 'enacted', enacted_at = now() where id = p_budget_id;

    for line in select department_key, amount_millions from public.city_budget_lines where budget_id = p_budget_id loop
      update public.city_fiscal_department_allocations
      set amount_millions = line.amount_millions
      where city_code = 'MB' and department_key = line.department_key;
    end loop;

    update public.city_fiscal_metrics set
      treasury_balance = treasury_balance + def,
      fiscal_year = fiscal_year + 1,
      updated_at = now()
    where city_code = 'MB';

    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', yeas, 'nays', nays,
      'deficit_millions', def, 'supermajority_required', need_yeas > 4
    );
  end if;

  update public.city_budgets set status = 'rejected' where id = p_budget_id;
  return jsonb_build_object('ok', true, 'passed', false, 'yeas', yeas, 'nays', nays, 'deficit_millions', def);
end;
$$;

-- ---------- Ordinance propose + finalize with ideology ----------

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
  v_is_admin boolean;
  proposal_id uuid;
  cat text := lower(trim(coalesce(p_category, '')));
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

  if stance not in ('progressive', 'moderate', 'conservative') then
    raise exception 'Invalid stance';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Ordinance title is required';
  end if;

  if exists (select 1 from public.city_ordinance_proposals where status = 'council_vote') then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  select * into scores from public._ordinance_issue_scores(cat, trim(p_issue_key), stance);

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, title, summary, status,
    issue_economic_score, issue_social_score
  ) values (
    v_uid, cat, trim(p_issue_key), stance, trim(p_title), coalesce(p_summary, ''), 'council_vote',
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
      vote := public._npc_ideology_vote(cm.sim_politician_id, p.issue_economic_score, p.issue_social_score);
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

grant execute on function public._city_fiscal_revenue_millions(char) to authenticated;
grant execute on function public._npc_ideology_vote(uuid, smallint, smallint) to authenticated;
grant execute on function public._npc_budget_vote(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
