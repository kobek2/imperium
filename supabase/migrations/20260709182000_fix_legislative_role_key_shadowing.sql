-- Fix PL/pgSQL variable shadowing: `role_key = role_key` in SQL resolved to column = column,
-- causing Supabase "DELETE requires a WHERE clause" and incorrect UPDATE/DELETE scope.

create or replace function public._rival_nominate_leadership(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  rnd record;
  v_role_key text;
  pick uuid;
begin
  select * into sim from public.simulation_settings where id = 1;
  select * into rnd from public.legislative_rounds where id = p_round;

  foreach v_role_key in array array['speaker', 'house_majority_leader', 'house_minority_leader'] loop
    if exists (
      select 1 from public.legislative_round_leadership lr
      where lr.round_id = p_round and lr.role_key = v_role_key and lr.party = sim.rival_strategist_party
    ) then continue; end if;
    if v_role_key = 'house_majority_leader' and rnd.house_majority_party is distinct from sim.rival_strategist_party then continue; end if;
    if v_role_key = 'house_minority_leader' and rnd.house_majority_party = sim.rival_strategist_party then continue; end if;

    select cm.sim_politician_id into pick
    from public.campaign_caucus_members cm
    join public.sim_politicians sp on sp.id = cm.sim_politician_id
    where cm.chamber = 'house' and cm.party = sim.rival_strategist_party
    order by sp.political_capital desc, random() limit 1;

    if pick is not null then
      insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
      values (p_round, v_role_key, pick, sim.rival_strategist_party);
    end if;
  end loop;
end;
$$;

create or replace function public._resolve_legislative_leadership(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sim record;
  v_role_key text;
  winner uuid;
  win_party text;
begin
  select * into sim from public.simulation_settings where id = 1;
  perform public._rival_nominate_leadership(p_round);

  foreach v_role_key in array array['speaker', 'house_majority_leader', 'house_minority_leader'] loop
    winner := null;
    select lr.sim_politician_id, lr.party into winner, win_party
    from public.legislative_round_leadership lr
    join public.sim_politicians sp on sp.id = lr.sim_politician_id
    where lr.round_id = p_round and lr.role_key = v_role_key
    order by sp.political_capital desc, random() limit 1;

    if winner is null then continue; end if;

    update public.legislative_round_leadership set won = false
    where round_id = p_round and role_key = v_role_key;
    update public.legislative_round_leadership set won = true
    where round_id = p_round and role_key = v_role_key and sim_politician_id = winner;

    perform public._apply_sim_politician_capital(winner, 5, 'Leadership win');
    delete from public.sim_government_role_grants where role_key = v_role_key;
    insert into public.sim_government_role_grants (sim_politician_id, role_key)
    values (winner, v_role_key)
    on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

    if win_party = sim.human_strategist_party and sim.human_strategist_user_id is not null then
      perform public.apply_political_capital_once(
        sim.human_strategist_user_id, 3, 'Caucus leadership win',
        'leadership_round', p_round::text || ':' || v_role_key
      );
    elsif win_party = sim.rival_strategist_party then
      update public.simulation_settings
      set rival_strategist_political_capital = rival_strategist_political_capital + 3, updated_at = now()
      where id = 1;
    end if;
  end loop;

  update public.legislative_rounds
  set leadership_resolved = true, phase = 'proposals', last_phase_at = now()
  where id = p_round;
end;
$$;

create or replace function public.campaign_nominate_leadership(p_sim_politician_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sim public.simulation_settings;
  rnd record;
  mem record;
  v_role_key text := lower(trim(coalesce(p_role, '')));
  cst date := public._campaign_cst_today();
begin
  sim := public._require_human_strategist();
  select * into rnd from public.legislative_rounds
  where cst_date = cst and phase = 'leadership' order by created_at desc limit 1;
  if rnd.id is null then raise exception 'No round in leadership phase'; end if;
  if v_role_key not in ('speaker', 'house_majority_leader', 'house_minority_leader') then
    raise exception 'Invalid leadership role';
  end if;
  select * into mem from public.campaign_caucus_members
  where sim_politician_id = p_sim_politician_id and chamber = 'house';
  if mem.sim_politician_id is null then raise exception 'Not a house caucus member'; end if;
  if mem.party <> sim.human_strategist_party then raise exception 'Nominee must be from your party'; end if;
  if v_role_key = 'house_majority_leader' and rnd.house_majority_party is distinct from sim.human_strategist_party then
    raise exception 'Your party is not the House majority';
  end if;
  if v_role_key = 'house_minority_leader' and rnd.house_majority_party = sim.human_strategist_party then
    raise exception 'Your party is not the House minority';
  end if;

  delete from public.legislative_round_leadership
  where round_id = rnd.id and role_key = v_role_key and party = sim.human_strategist_party;
  insert into public.legislative_round_leadership (round_id, role_key, sim_politician_id, party)
  values (rnd.id, v_role_key, p_sim_politician_id, sim.human_strategist_party);
  return jsonb_build_object('ok', true, 'role', v_role_key);
end;
$$;
