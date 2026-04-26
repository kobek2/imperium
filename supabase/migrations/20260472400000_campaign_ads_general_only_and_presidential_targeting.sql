-- Campaign ads should be spent from election campaigning UI during general only.
-- House/Senate ads auto-apply to the race. Presidential ads require target_state.
-- Ads are tracked as campaign events so presidential state scoring can consume them.

create table if not exists public.campaign_ads (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  candidate_id uuid not null references public.election_candidates(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_state char(2) references public.states(code),
  target_district text references public.districts(code),
  points numeric not null default 1 check (points > 0),
  created_at timestamptz not null default now()
);

create index if not exists campaign_ads_election_idx on public.campaign_ads(election_id, created_at desc);
create index if not exists campaign_ads_candidate_idx on public.campaign_ads(candidate_id, created_at desc);
create index if not exists campaign_ads_target_state_idx on public.campaign_ads(target_state);

alter table public.campaign_ads enable row level security;

drop policy if exists "campaign ads read authed" on public.campaign_ads;
create policy "campaign ads read authed" on public.campaign_ads
  for select to authenticated using (true);

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
            and e.phase in ('primary', 'general')
            and c.running_mate_user_id = auth.uid()
          )
        )
    )
  );

drop trigger if exists campaign_ads_points_sync on public.campaign_ads;
create trigger campaign_ads_points_sync
after insert or update or delete on public.campaign_ads
for each row execute function public._campaign_points_delta();

create or replace function public.economy_use_campaign_ad(
  p_election uuid,
  p_candidate uuid,
  p_target_state text default null
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select quantity into inv
  from public.economy_inventory
  where user_id = v_uid and sku = 'campaign_ad';
  if coalesce(inv, 0) < 1 then raise exception 'No campaign ads in inventory'; end if;

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
    if cand.user_id <> v_uid and cand.running_mate_user_id <> v_uid then
      raise exception 'Not your presidential ticket';
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
  values (
    p_election,
    p_candidate,
    v_uid,
    use_state,
    use_district,
    1
  );

  update public.economy_inventory
    set quantity = quantity - 1
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
      'points_added', 1
    )
  );

  return jsonb_build_object(
    'ok', true,
    'ads_remaining', greatest(inv - 1, 0),
    'target_state', use_state,
    'target_district', use_district
  );
end;
$$;

grant execute on function public.economy_use_campaign_ad(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
