-- Hard-disable reactive counter-ads (player actions must not penalize the player).

create or replace function public._npc_reactive_counter_attack(
  p_election uuid,
  p_player_candidate uuid,
  p_trigger text default 'campaign'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return false;
end;
$$;

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

notify pgrst, 'reload schema';
