-- Active general-election candidacies for the economy campaign-ads panel.

create or replace function public.economy_my_campaign_races()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  result jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(race order by race->>'label'),
    '[]'::jsonb
  )
  into result
  from (
    select jsonb_build_object(
      'electionId', e.id,
      'candidateId', ec.id,
      'label',
        case
          when e.office = 'president' then 'President'
          when e.office = 'house' then coalesce(e.district_code, e.state, 'House')
          else coalesce(e.state, 'Senate')
        end,
      'opponents',
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', opp.id,
                'label',
                  case
                    when coalesce(opp.is_npc, false) then coalesce(nullif(trim(opp.npc_name), ''), 'NPC') || ' (NPC)'
                    else coalesce(nullif(trim(p.character_name), ''), 'Opponent')
                  end
              )
              order by opp.created_at nulls last, opp.id
            ),
            '[]'::jsonb
          )
          from public.election_candidates opp
          left join public.profiles p on p.id = opp.user_id
          where opp.election_id = e.id
            and opp.id <> ec.id
            and (
              not exists (
                select 1 from public.election_candidates x
                where x.election_id = e.id and x.primary_winner is true
              )
              or opp.primary_winner is true
            )
        )
    ) as race
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where ec.user_id = v_uid
      and coalesce(ec.is_npc, false) = false
      and e.leadership_role is null
      and e.phase = 'general'::public.election_phase
      and e.general_closes_at > now()
      and coalesce(ec.primary_winner, true) is not false
  ) sub;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.economy_my_campaign_races() from public;
grant execute on function public.economy_my_campaign_races() to authenticated, service_role;

notify pgrst, 'reload schema';
