-- Ordinance roll call transparency + two-step enactment (council → mayor sign/veto).

alter table public.city_ordinance_proposals drop constraint if exists city_ordinance_proposals_status_check;
alter table public.city_ordinance_proposals add constraint city_ordinance_proposals_status_check
  check (status in (
    'draft', 'proposed', 'council_vote', 'awaiting_mayor', 'enacted', 'rejected', 'vetoed'
  ));

create table if not exists public.city_ordinance_roll_calls (
  proposal_id uuid not null references public.city_ordinance_proposals (id) on delete cascade,
  ward_code text not null,
  voter_label text not null,
  sim_politician_id uuid references public.sim_politicians (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  vote text not null check (vote in ('yea', 'nay')),
  voted_at timestamptz not null default now(),
  primary key (proposal_id, ward_code)
);

create index if not exists city_ordinance_roll_calls_proposal_idx
  on public.city_ordinance_roll_calls (proposal_id);

alter table public.city_ordinance_roll_calls enable row level security;
drop policy if exists "city_ordinance_roll_calls read" on public.city_ordinance_roll_calls;
create policy "city_ordinance_roll_calls read" on public.city_ordinance_roll_calls
  for select to authenticated using (true);

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
    select
      c.party,
      c.holder_user_id,
      c.seat_label,
      c.sim_politician_id,
      sp.character_name
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
      vote := public._npc_ordinance_vote(cm.party, p.stance_key);
      v_user_id := null;
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;

    insert into public.city_ordinance_roll_calls (
      proposal_id, ward_code, voter_label, sim_politician_id, user_id, vote
    ) values (
      p_proposal_id,
      cm.seat_label,
      coalesce(v_label, cm.character_name),
      cm.sim_politician_id,
      v_user_id,
      vote
    );
  end loop;

  update public.city_ordinance_proposals
  set council_yeas = yeas, council_nays = nays
  where id = p_proposal_id;

  if yeas >= 4 then
    update public.city_ordinance_proposals
    set status = 'awaiting_mayor'
    where id = p_proposal_id;
    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', yeas, 'nays', nays, 'status', 'awaiting_mayor'
    );
  end if;

  update public.city_ordinance_proposals set status = 'rejected' where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'passed', false, 'yeas', yeas, 'nays', nays, 'status', 'rejected');
end;
$$;

create or replace function public.mayor_sign_ordinance(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may sign ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'awaiting_mayor' then raise exception 'Ordinance is not awaiting mayor signature'; end if;

  update public.city_ordinance_proposals
  set status = 'enacted', enacted_at = now()
  where id = p_ordinance_id;

  return jsonb_build_object('ok', true, 'status', 'enacted', 'ordinance_id', p_ordinance_id);
end;
$$;

create or replace function public.mayor_veto_ordinance(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may veto ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'awaiting_mayor' then raise exception 'Ordinance is not awaiting mayor signature'; end if;

  update public.city_ordinance_proposals
  set status = 'vetoed'
  where id = p_ordinance_id;

  return jsonb_build_object('ok', true, 'status', 'vetoed', 'ordinance_id', p_ordinance_id);
end;
$$;

grant execute on function public.mayor_sign_ordinance(uuid) to authenticated;
grant execute on function public.mayor_veto_ordinance(uuid) to authenticated;

notify pgrst, 'reload schema';
