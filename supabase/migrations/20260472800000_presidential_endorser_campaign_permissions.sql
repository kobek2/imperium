-- Let presidential endorsers campaign for the candidate they endorsed in general.
-- Covers speeches, rallies, and campaign ads (policy + ad spend RPC guard).

drop policy if exists "campaign speeches insert self-candidate" on public.campaign_speeches;
create policy "campaign speeches insert self-candidate" on public.campaign_speeches
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1
      from public.election_candidates c
      join public.elections e on e.id = c.election_id
      where c.id = candidate_id
        and c.election_id = campaign_speeches.election_id
        and (
          c.user_id = auth.uid()
          or (
            e.office = 'president'
            and c.running_mate_user_id = auth.uid()
          )
          or (
            e.office = 'president'
            and e.phase = 'general'
            and exists (
              select 1
              from public.campaign_endorsements ce
              where ce.election_id = e.id
                and ce.endorser_user_id = auth.uid()
                and ce.candidate_id = c.id
            )
          )
        )
    )
  );

drop policy if exists "campaign rallies insert self-candidate" on public.campaign_rallies;
create policy "campaign rallies insert self-candidate" on public.campaign_rallies
  for insert with check (
    auth.uid() = actor_id
    and exists (
      select 1
      from public.election_candidates c
      join public.elections e on e.id = c.election_id
      where c.id = candidate_id
        and c.election_id = campaign_rallies.election_id
        and (
          c.user_id = auth.uid()
          or (
            e.office = 'president'
            and c.running_mate_user_id = auth.uid()
          )
          or (
            e.office = 'president'
            and e.phase = 'general'
            and exists (
              select 1
              from public.campaign_endorsements ce
              where ce.election_id = e.id
                and ce.endorser_user_id = auth.uid()
                and ce.candidate_id = c.id
            )
          )
        )
    )
  );

drop policy if exists "campaign ads insert self-candidate" on public.campaign_ads;
create policy "campaign ads insert self-candidate" on public.campaign_ads
  for insert with check (
    auth.uid() = actor_id
    and exists (
      select 1
      from public.election_candidates c
      join public.elections e on e.id = c.election_id
      where c.id = candidate_id
        and c.election_id = campaign_ads.election_id
        and (
          c.user_id = auth.uid()
          or (
            e.office = 'president'
            and c.running_mate_user_id = auth.uid()
          )
          or (
            e.office = 'president'
            and e.phase = 'general'
            and exists (
              select 1
              from public.campaign_endorsements ce
              where ce.election_id = e.id
                and ce.endorser_user_id = auth.uid()
                and ce.candidate_id = c.id
            )
          )
        )
    )
  );

create or replace function public.economy_use_campaign_ad(
  p_election uuid,
  p_candidate uuid,
  p_target_state text default null,
  p_qty int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  inv int;
  cand record;
  norm_target_state text := nullif(upper(trim(coalesce(p_target_state, ''))), '');
  use_state char(2);
  use_district text;
  w record;
  new_bal numeric;
  qty int := greatest(1, least(coalesce(p_qty, 1), 99));
  endorsed_ticket boolean := false;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select quantity into inv
  from public.economy_inventory
  where user_id = v_uid and sku = 'campaign_ad';
  if coalesce(inv, 0) < qty then raise exception 'Not enough campaign ads in inventory'; end if;

  select
    ec.id,
    ec.user_id,
    ec.running_mate_user_id,
    ec.election_id,
    e.office,
    e.phase,
    e.general_closes_at,
    e.state,
    e.district_code
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;

  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Campaign ads can only be used during the general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then
    raise exception 'General election is closed';
  end if;

  if cand.office = 'president' then
    endorsed_ticket := exists (
      select 1
      from public.campaign_endorsements ce
      where ce.election_id = p_election
        and ce.endorser_user_id = v_uid
        and ce.candidate_id = p_candidate
    );
    if cand.user_id <> v_uid and cand.running_mate_user_id <> v_uid and not endorsed_ticket then
      raise exception 'Not your presidential ticket (endorse this candidate first)';
    end if;
    if norm_target_state is null or char_length(norm_target_state) <> 2 then
      raise exception 'Presidential campaign ads require a target state';
    end if;
    use_state := norm_target_state::char(2);
    use_district := null;
  else
    if cand.user_id <> v_uid then raise exception 'Not your candidacy'; end if;
    use_state := cand.state;
    use_district := cand.district_code;
  end if;

  insert into public.campaign_ads (
    election_id,
    candidate_id,
    actor_id,
    target_state,
    target_district,
    points
  )
  select
    p_election,
    p_candidate,
    v_uid,
    use_state,
    use_district,
    1
  from generate_series(1, qty);

  update public.economy_inventory
    set quantity = quantity - qty
    where user_id = v_uid and sku = 'campaign_ad';

  select * into w from public.economy_wallets where user_id = v_uid;
  new_bal := coalesce(w.balance, 0);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    0,
    new_bal,
    'campaign_ad_spend',
    jsonb_build_object(
      'election_id', p_election,
      'candidate_id', p_candidate,
      'target_state', use_state,
      'target_district', use_district,
      'qty', qty,
      'points_added', qty
    )
  );

  return jsonb_build_object(
    'ok', true,
    'qty', qty,
    'ads_remaining', greatest(inv - qty, 0),
    'target_state', use_state,
    'target_district', use_district
  );
end;
$$;

grant execute on function public.economy_use_campaign_ad(uuid, uuid, text, int) to authenticated;

notify pgrst, 'reload schema';
