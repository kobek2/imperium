-- NYC council district realism (PVI + incumbents), NPC portraits, city ordinance proposals.

-- ---------- Realistic ward PVI & incumbent parties (6D / 1R) ----------

update public.wards set
  name = case code
    when 'W01' then 'Lower Manhattan & Financial District'
    when 'W02' then 'Upper Manhattan & Harlem'
    when 'W03' then 'Southwest Brooklyn'
    when 'W04' then 'North Brooklyn'
    when 'W05' then 'Southeast Queens'
    when 'W06' then 'South Bronx'
    when 'W07' then 'Staten Island North Shore'
    else name
  end,
  pvi = case code
    when 'W01' then 18
    when 'W02' then 32
    when 'W03' then 8
    when 'W04' then 28
    when 'W05' then 22
    when 'W06' then 38
    when 'W07' then -12
    else pvi
  end,
  incumbent_party = case code
    when 'W07' then 'R'
    else 'D'
  end,
  incumbent_npc_name = case code
    when 'W01' then 'Councilor Elena Vasquez'
    when 'W02' then 'Councilor James Okoro'
    when 'W03' then 'Angela Wu'
    when 'W04' then 'Councilor Miguel Santos'
    when 'W05' then 'Lisa Nguyen'
    when 'W06' then 'David Park'
    when 'W07' then 'Greg Morrison'
    else incumbent_npc_name
  end
where city_code = 'MB';

-- Re-link incumbents to matching-party council NPCs (6D / 1R)
update public.wards w
set
  incumbent_politician_id = sp.id,
  incumbent_npc_name = sp.character_name
from public.sim_politicians sp
where w.city_code = 'MB'
  and sp.office = 'council'
  and sp.ward_code = w.code
  and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end;

-- Competitive D-lean W03 → Angela Wu; W05 → Lisa Nguyen; W06 → David Park; W07 → Greg Morrison (rep)
update public.wards w set incumbent_politician_id = sp.id, incumbent_npc_name = sp.character_name
from public.sim_politicians sp where w.code = 'W03' and sp.slug = 'w03-dem' and w.city_code = 'MB';

update public.wards w set incumbent_politician_id = sp.id, incumbent_npc_name = sp.character_name
from public.sim_politicians sp where w.code = 'W05' and sp.slug = 'w05-dem' and w.city_code = 'MB';

update public.wards w set incumbent_politician_id = sp.id, incumbent_npc_name = sp.character_name
from public.sim_politicians sp where w.code = 'W06' and sp.slug = 'w06-dem' and w.city_code = 'MB';

update public.wards w set incumbent_politician_id = sp.id, incumbent_npc_name = sp.character_name
from public.sim_politicians sp where w.code = 'W07' and sp.slug = 'w07-rep' and w.city_code = 'MB';

-- ---------- Stable NPC portrait URLs (Dicebear, seeded by slug) ----------

update public.sim_politicians sp
set face_claim_url = 'https://api.dicebear.com/7.x/notionists/png?seed=' || sp.slug || '&size=256'
where sp.office in ('council', 'mayor')
  and coalesce(trim(sp.face_claim_url), '') = '';

-- ---------- City ordinance proposals ----------

create table if not exists public.city_ordinance_proposals (
  id uuid primary key default gen_random_uuid(),
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('taxes', 'crime', 'economy', 'education')),
  issue_key text not null,
  stance_key text not null check (stance_key in ('progressive', 'moderate', 'conservative')),
  title text not null,
  summary text not null default '',
  status text not null default 'draft' check (
    status in ('draft', 'proposed', 'council_vote', 'enacted', 'rejected', 'vetoed')
  ),
  council_yeas smallint not null default 0,
  council_nays smallint not null default 0,
  created_at timestamptz not null default now(),
  enacted_at timestamptz
);

create table if not exists public.city_ordinance_member_votes (
  proposal_id uuid not null references public.city_ordinance_proposals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote text not null check (vote in ('yea', 'nay')),
  voted_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

alter table public.city_ordinance_proposals enable row level security;
alter table public.city_ordinance_member_votes enable row level security;

drop policy if exists "city_ordinance_proposals read" on public.city_ordinance_proposals;
create policy "city_ordinance_proposals read" on public.city_ordinance_proposals
  for select to authenticated using (true);

drop policy if exists "city_ordinance_member_votes read" on public.city_ordinance_member_votes;
create policy "city_ordinance_member_votes read" on public.city_ordinance_member_votes
  for select to authenticated using (true);

-- NPC vote helper: stance spectrum vs member party
create or replace function public._npc_ordinance_vote(
  p_voter_party text,
  p_stance_key text
)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_stance_key, '')))
    when 'progressive' then case when p_voter_party = 'democrat' then 'yea' else 'nay' end
    when 'moderate' then 'yea'
    when 'conservative' then case when p_voter_party = 'republican' then 'yea' else 'nay' end
    else 'nay'
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
begin
  select * into p from public.city_ordinance_proposals where id = p_proposal_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'council_vote' then raise exception 'Proposal is not open for council vote'; end if;

  for cm in
    select c.party, c.holder_user_id, c.seat_label
    from public.campaign_caucus_members c
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    if cm.holder_user_id is not null then
      select v.vote into vote
      from public.city_ordinance_member_votes v
      where v.proposal_id = p_proposal_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_ordinance_vote(cm.party, p.stance_key);
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;
  end loop;

  update public.city_ordinance_proposals
  set council_yeas = yeas, council_nays = nays
  where id = p_proposal_id;

  if yeas >= 4 then
    update public.city_ordinance_proposals
    set status = 'enacted', enacted_at = now()
    where id = p_proposal_id;
    return jsonb_build_object('ok', true, 'passed', true, 'yeas', yeas, 'nays', nays);
  end if;

  update public.city_ordinance_proposals set status = 'rejected' where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'passed', false, 'yeas', yeas, 'nays', nays);
end;
$$;

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
  proposal_id uuid;
  cat text := lower(trim(coalesce(p_category, '')));
  stance text := lower(trim(coalesce(p_stance_key, '')));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key = 'council_member'
  ) then
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

  if exists (
    select 1 from public.city_ordinance_proposals where status = 'council_vote'
  ) then
    raise exception 'Another ordinance is already pending a council vote';
  end if;

  insert into public.city_ordinance_proposals (
    sponsor_user_id, category, issue_key, stance_key, title, summary, status
  ) values (
    v_uid, cat, trim(p_issue_key), stance, trim(p_title), coalesce(p_summary, ''), 'council_vote'
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
  p record;
  cm record;
  player_votes smallint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if v_vote not in ('yea', 'nay') then raise exception 'Vote must be yea or nay'; end if;

  if not exists (
    select 1 from public.government_role_grants g where g.user_id = v_uid and g.role_key = 'council_member'
  ) then
    raise exception 'Only council members may vote on ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_proposal_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'council_vote' then raise exception 'Proposal is not open for council vote'; end if;

  select * into cm from public.campaign_caucus_members
  where chamber = 'council' and holder_user_id = v_uid;
  if cm.sim_politician_id is null then
    raise exception 'Your ward is not seated on the council caucus roster — ask admin to sync caucus';
  end if;

  insert into public.city_ordinance_member_votes (proposal_id, user_id, vote)
  values (p_proposal_id, v_uid, v_vote)
  on conflict (proposal_id, user_id) do update set vote = excluded.vote, voted_at = now();

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

grant execute on function public.council_propose_ordinance(text, text, text, text, text) to authenticated;
grant execute on function public.council_ordinance_vote(uuid, text) to authenticated;
grant execute on function public.finalize_city_ordinance_vote(uuid) to authenticated;

notify pgrst, 'reload schema';
