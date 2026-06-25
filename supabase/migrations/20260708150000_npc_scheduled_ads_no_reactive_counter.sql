-- Replace reactive player-triggered counter-ads with scheduled NPC persuasion ads every 3h.

alter table public.election_candidates
  add column if not exists npc_last_ad_at timestamptz;

alter table public.npc_campaign_actions
  drop constraint if exists npc_campaign_actions_action_type_check;

alter table public.npc_campaign_actions
  add constraint npc_campaign_actions_action_type_check
  check (action_type in ('speech', 'counter_attack', 'ad'));

create or replace function public._npc_deliver_scheduled_ad(p_npc_candidate uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  npc record;
  race record;
  ad_pts numeric := 3;
  npc_label text;
begin
  select ec.id, ec.election_id, ec.npc_name, ec.npc_last_ad_at, ec.is_npc
    into npc
    from public.election_candidates ec
    where ec.id = p_npc_candidate
    for update;
  if npc.id is null or not coalesce(npc.is_npc, false) then
    return false;
  end if;

  select e.id, e.phase, e.general_closes_at
    into race
    from public.elections e
    where e.id = npc.election_id;
  if race.phase <> 'general' or (race.general_closes_at is not null and now() > race.general_closes_at) then
    return false;
  end if;

  if npc.npc_last_ad_at is not null
     and now() < npc.npc_last_ad_at + interval '3 hours' then
    return false;
  end if;

  npc_label := coalesce(nullif(trim(npc.npc_name), ''), 'Opponent');

  update public.election_candidates
  set campaign_points_total = coalesce(campaign_points_total, 0) + ad_pts,
      npc_last_ad_at = now()
  where id = npc.id;

  insert into public.npc_campaign_actions (
    election_id, npc_candidate_id, action_type, succeeded, points_delta, message
  ) values (
    npc.election_id,
    npc.id,
    'ad',
    true,
    ad_pts,
    npc_label || ' aired a persuasion ad (+' || ad_pts::text || ' pts).'
  );

  return true;
end;
$$;

-- Player campaign actions no longer trigger NPC reactions.
create or replace function public.election_npc_campaign_pulse(
  p_election_id uuid,
  p_player_candidate_id uuid default null,
  p_trigger text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('speech', false, 'counter_attack', false);
end;
$$;

create or replace function public.tick_npc_campaigns(p_election_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  n int := 0;
begin
  for npc_id in
    select ec.id
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where coalesce(ec.is_npc, false) = true
      and e.phase = 'general'
      and (e.general_closes_at is null or now() <= e.general_closes_at)
      and (p_election_id is null or e.id = p_election_id)
  loop
    if public._npc_deliver_scheduled_speech(npc_id) then
      n := n + 1;
    end if;
    if public._npc_deliver_scheduled_ad(npc_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Backfill ad timer: start the 3h clock now (do not make ads fire immediately on deploy).
update public.election_candidates
set npc_last_ad_at = now()
where coalesce(is_npc, false) = true;

notify pgrst, 'reload schema';
