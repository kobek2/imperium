-- Party leadership dashboard: officer-only analytics RPC; DNC/RNC national board; governing rules (boilerplate + votes).

alter table public.party_organizations
  add column if not exists governing_charter_md text,
  add column if not exists charter_ratified_at timestamptz;

comment on column public.party_organizations.governing_charter_md is
  'Active party charter / rules (markdown), updated when board ratifies boilerplate or passes amendments.';

-- ---------- National board (chair appoints) ----------
create table if not exists public.party_national_board_members (
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  appointed_at timestamptz not null default now(),
  appointed_by uuid not null references public.profiles (id) on delete cascade,
  primary key (party_key, user_id)
);

create index party_national_board_members_party_idx on public.party_national_board_members (party_key);

alter table public.party_national_board_members enable row level security;

drop policy if exists "party_national_board_members read same party" on public.party_national_board_members;
create policy "party_national_board_members read same party" on public.party_national_board_members
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.party = party_national_board_members.party_key
    )
  );

-- ---------- Rule proposals & board votes ----------
create table if not exists public.party_rule_proposals (
  id uuid primary key default gen_random_uuid(),
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  kind text not null check (kind in ('boilerplate', 'amendment')),
  title text not null,
  body_md text not null,
  status text not null default 'open' check (status in ('open', 'passed', 'failed')),
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index party_rule_proposals_party_status_idx on public.party_rule_proposals (party_key, status, created_at desc);

create table if not exists public.party_rule_votes (
  proposal_id uuid not null references public.party_rule_proposals (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  yes boolean not null,
  voted_at timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);

create index party_rule_votes_proposal_idx on public.party_rule_votes (proposal_id);

alter table public.party_rule_proposals enable row level security;
alter table public.party_rule_votes enable row level security;

drop policy if exists "party_rule_proposals read same party" on public.party_rule_proposals;
create policy "party_rule_proposals read same party" on public.party_rule_proposals
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.party = party_rule_proposals.party_key
    )
  );

drop policy if exists "party_rule_votes read same party" on public.party_rule_votes;
create policy "party_rule_votes read same party" on public.party_rule_votes
  for select using (
    exists (
      select 1
      from public.party_rule_proposals pr
      join public.profiles p on p.id = auth.uid()
      where pr.id = party_rule_votes.proposal_id and p.party = pr.party_key
    )
  );

-- ---------- Seeded boilerplate (one per major party) ----------
create table if not exists public.party_rules_boilerplate (
  party_key text primary key references public.party_organizations (party_key) on delete cascade,
  body_md text not null
);

alter table public.party_rules_boilerplate enable row level security;

drop policy if exists "party_rules_boilerplate read same party" on public.party_rules_boilerplate;
create policy "party_rules_boilerplate read same party" on public.party_rules_boilerplate
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.party = party_rules_boilerplate.party_key
    )
  );

insert into public.party_rules_boilerplate (party_key, body_md)
values
(
  'democrat',
  $dnc$
# Democratic National Committee — model governing rules (boilerplate)

This document is a **starting template** for your national committee. It does not take effect until the national board ratifies it by majority vote. After ratification, amendments also require a majority of seated board members voting **Aye**.

## 1. Purpose

These rules govern the national committee’s internal procedures, including how additional standing rules are adopted and how discipline (including impeachment) may be proposed and decided.

## 2. National committee board

The **Chair** appoints members to the national committee board. Board size is not fixed by this boilerplate; the Chair should appoint enough members to ensure representation and quorum.

The board’s role includes adopting governing rules, approving amendments, and establishing procedures consistent with this charter.

## 3. Rule-making

- **Boilerplate ratification:** The Chair may place this boilerplate (or a successor draft) before the board for a ratification vote. Passage requires a **majority of seated board members** voting Aye.
- **Amendments and standing rules:** Any board member may propose a written rule or amendment. Passage requires the same **majority of seated board members** voting Aye.
- **One open vote at a time:** Only one open proposal may be pending per party at a time, to keep deliberation orderly.

## 4. Impeachment of party officers

**Impeachment** here means a formal process to remove an elected party officer (chair, vice chair, or treasurer) before the end of their term.

1. **Charge:** A board member files written charges with the board, specifying the officer and the alleged conduct that warrants removal.
2. **Committee:** The board appoints an ad hoc review committee (at least three members, none of whom is the officer under review) to gather facts and report within a reasonable window set by the board.
3. **Hearing:** The officer receives notice and a fair opportunity to respond in writing or at a board hearing.
4. **Vote:** Removal requires **two-thirds Aye** among seated board members on a single ballot titled “Removal of [office].”
5. **Vacancy:** If removed, the office is vacant until filled under the party’s leadership election procedures.

*(Simulation note: technical installation of officers still follows your site’s officer election RPCs; this section is in-fiction procedure for RP.)*

## 5. Quorum & records

The board should define quorum for meetings in a standing rule after ratification. Until then, a majority of seated members constitutes quorum for votes run through this system.

The party should retain the text of the **active charter** and archived proposals as the historical record.

## 6. Conflicts

Where these rules conflict with site-enforced mechanics (database constraints, admin actions), site mechanics prevail.
$dnc$
),
(
  'republican',
  $rnc$
# Republican National Committee — model governing rules (boilerplate)

This document is a **starting template** for your national committee. It does not take effect until the national board ratifies it by majority vote. After ratification, amendments also require a majority of seated board members voting **Aye**.

## 1. Purpose

These rules govern the national committee’s internal procedures, including how additional standing rules are adopted and how discipline (including impeachment) may be proposed and decided.

## 2. National committee board

The **Chair** appoints members to the national committee board. Board size is not fixed by this boilerplate; the Chair should appoint enough members to ensure representation and quorum.

The board’s role includes adopting governing rules, approving amendments, and establishing procedures consistent with this charter.

## 3. Rule-making

- **Boilerplate ratification:** The Chair may place this boilerplate (or a successor draft) before the board for a ratification vote. Passage requires a **majority of seated board members** voting Aye.
- **Amendments and standing rules:** Any board member may propose a written rule or amendment. Passage requires the same **majority of seated board members** voting Aye.
- **One open vote at a time:** Only one open proposal may be pending per party at a time, to keep deliberation orderly.

## 4. Impeachment of party officers

**Impeachment** here means a formal process to remove an elected party officer (chair, vice chair, or treasurer) before the end of their term.

1. **Charge:** A board member files written charges with the board, specifying the officer and the alleged conduct that warrants removal.
2. **Committee:** The board appoints an ad hoc review committee (at least three members, none of whom is the officer under review) to gather facts and report within a reasonable window set by the board.
3. **Hearing:** The officer receives notice and a fair opportunity to respond in writing or at a board hearing.
4. **Vote:** Removal requires **two-thirds Aye** among seated board members on a single ballot titled “Removal of [office].”
5. **Vacancy:** If removed, the office is vacant until filled under the party’s leadership election procedures.

*(Simulation note: technical installation of officers still follows your site’s officer election RPCs; this section is in-fiction procedure for RP.)*

## 5. Quorum & records

The board should define quorum for meetings in a standing rule after ratification. Until then, a majority of seated members constitutes quorum for votes run through this system.

The party should retain the text of the **active charter** and archived proposals as the historical record.

## 6. Conflicts

Where these rules conflict with site-enforced mechanics (database constraints, admin actions), site mechanics prevail.
$rnc$
)
on conflict (party_key) do update set body_md = excluded.body_md;

-- ---------- Helpers ----------
create or replace function public._party_is_chair(p_party text, p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.party_officers po
    where po.party_key = p_party and po.office = 'chair' and po.user_id = p_uid
  );
$$;

create or replace function public._party_is_leadership_officer(p_party text, p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.party_officers po
    where po.party_key = p_party
      and po.office in ('chair', 'vice_chair', 'treasurer')
      and po.user_id = p_uid
  );
$$;

create or replace function public._party_is_board_member(p_party text, p_uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.party_national_board_members b
    where b.party_key = p_party and b.user_id = p_uid
  );
$$;

-- Officer-only analytics (RPC; not granted to public SELECT on hidden aggregates).
create or replace function public.party_leadership_analytics(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
  member_count int;
  wallet_sum numeric;
  treasury_bal numeric;
  board_n int;
  paid_members numeric;
  paid_elections numeric;
  vacant_offices int;
  cand_count int;
  phase text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;

  if not public._party_is_leadership_officer(p_party, v_uid) then
    raise exception 'Analytics are limited to the party chair, vice chair, and treasurer';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select count(*)::int into member_count from public.profiles where party = p_party;

  select coalesce(sum(w.balance), 0) into wallet_sum
  from public.economy_wallets w
  join public.profiles p on p.id = w.user_id
  where p.party = p_party;

  select treasury_balance into treasury_bal from public.party_organizations where party_key = p_party;

  select count(*)::int into board_n from public.party_national_board_members where party_key = p_party;

  select coalesce(sum(el.delta), 0) into paid_members
  from public.economy_ledger el
  join public.profiles p on p.id = el.wallet_user_id
  where p.party = p_party
    and el.kind = 'party_treasury_in'
    and el.detail->>'party' = p_party;

  select coalesce(sum(g.amount), 0) into paid_elections
  from public.party_treasury_election_grants g
  where g.party_key = p_party;

  select count(*)::int into vacant_offices
  from unnest(array['chair', 'vice_chair', 'treasurer']::text[]) o(office)
  where not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party and po.office = o.office and po.user_id is not null
  );

  select count(*)::int into cand_count
  from public.party_officer_candidacies c
  where c.party_key = p_party;

  select leadership_phase into phase from public.party_organizations where party_key = p_party;

  return jsonb_build_object(
    'member_count', member_count,
    'aggregate_member_wallet_usd', wallet_sum,
    'treasury_balance_usd', coalesce(treasury_bal, 0),
    'national_board_seats_filled', board_n,
    'treasury_transferred_to_member_wallets_usd', paid_members,
    'treasury_historic_election_grants_usd', paid_elections,
    'vacant_officer_slots', vacant_offices,
    'leadership_cycle_phase', coalesce(phase, 'idle'),
    'leadership_candidate_rows', cand_count
  );
end;
$$;

grant execute on function public.party_leadership_analytics(text) to authenticated;

-- Chair appoints / removes national board members
create or replace function public.party_national_board_appoint(p_party text, p_member uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  mp text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if not public._party_is_chair(p_party, v_uid) then
    raise exception 'Only the party chair may appoint national committee board members';
  end if;
  if p_member is null then raise exception 'Invalid member'; end if;

  select party into mp from public.profiles where id = p_member;
  if mp is distinct from p_party then raise exception 'Appointee must be a member of this party'; end if;

  insert into public.party_national_board_members (party_key, user_id, appointed_by)
  values (p_party, p_member, v_uid)
  on conflict (party_key, user_id) do update set appointed_at = now(), appointed_by = excluded.appointed_by;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_national_board_appoint(text, uuid) to authenticated;

create or replace function public.party_national_board_remove(p_party text, p_member uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if not public._party_is_chair(p_party, v_uid) then
    raise exception 'Only the party chair may remove national committee board members';
  end if;

  delete from public.party_national_board_members where party_key = p_party and user_id = p_member;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_national_board_remove(text, uuid) to authenticated;

create or replace function public._party_rule_try_close(p_proposal uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pr record;
  board_size int;
  required_yes int;
  yes_c int;
  no_c int;
  voted int;
  remaining int;
begin
  select * into pr from public.party_rule_proposals where id = p_proposal for update;
  if not found or pr.status is distinct from 'open' then
    return;
  end if;

  select count(*)::int into board_size from public.party_national_board_members where party_key = pr.party_key;
  if board_size < 1 then
    return;
  end if;

  required_yes := (board_size / 2) + 1;

  select
    count(*) filter (where v.yes)::int,
    count(*) filter (where not v.yes)::int,
    count(*)::int
  into yes_c, no_c, voted
  from public.party_rule_votes v
  where v.proposal_id = p_proposal;

  remaining := board_size - voted;

  if yes_c >= required_yes then
    update public.party_rule_proposals
    set status = 'passed', decided_at = now()
    where id = p_proposal;

    if pr.kind = 'boilerplate' then
      update public.party_organizations
      set
        governing_charter_md = pr.body_md,
        charter_ratified_at = now(),
        updated_at = now()
      where party_key = pr.party_key;
    else
      update public.party_organizations
      set
        governing_charter_md = trim(both e'\n' from concat_ws(
          e'\n\n',
          nullif(trim(both from coalesce(governing_charter_md, '')), ''),
          '---',
          '## Amendment adopted ' || to_char(now()::date, 'YYYY-MM-DD'),
          pr.body_md
        )),
        updated_at = now()
      where party_key = pr.party_key;
    end if;

  elsif yes_c + remaining < required_yes then
    update public.party_rule_proposals
    set status = 'failed', decided_at = now()
    where id = p_proposal;
  end if;
end;
$$;

create or replace function public.party_rule_start_boilerplate_vote(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  body text;
  new_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if not public._party_is_chair(p_party, v_uid) then
    raise exception 'Only the chair may start a boilerplate ratification vote';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.party is distinct from p_party) then
    raise exception 'Party mismatch';
  end if;

  if exists (select 1 from public.party_rule_proposals x where x.party_key = p_party and x.status = 'open') then
    raise exception 'A proposal is already open for this party; close or wait for it to finish first';
  end if;

  select b.body_md into body from public.party_rules_boilerplate b where b.party_key = p_party;
  if body is null then
    raise exception 'No boilerplate is configured for this party';
  end if;

  insert into public.party_rule_proposals (party_key, kind, title, body_md, proposed_by)
  values (
    p_party,
    'boilerplate',
    case when p_party = 'democrat' then 'Ratify DNC governing rules (boilerplate)' else 'Ratify RNC governing rules (boilerplate)' end,
    body,
    v_uid
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'proposal_id', new_id);
end;
$$;

grant execute on function public.party_rule_start_boilerplate_vote(text) to authenticated;

create or replace function public.party_rule_propose_amendment(p_party text, p_title text, p_body_md text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  new_id uuid;
  t text := trim(both from coalesce(p_title, ''));
  b text := trim(both from coalesce(p_body_md, ''));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if t = '' or b = '' then raise exception 'Title and body are required'; end if;

  if not (public._party_is_board_member(p_party, v_uid) or public._party_is_chair(p_party, v_uid)) then
    raise exception 'Only the chair or national committee board members may file rule proposals';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.party is distinct from p_party) then
    raise exception 'Party mismatch';
  end if;

  if exists (select 1 from public.party_rule_proposals x where x.party_key = p_party and x.status = 'open') then
    raise exception 'A proposal is already open for this party';
  end if;

  insert into public.party_rule_proposals (party_key, kind, title, body_md, proposed_by)
  values (p_party, 'amendment', t, b, v_uid)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'proposal_id', new_id);
end;
$$;

grant execute on function public.party_rule_propose_amendment(text, text, text) to authenticated;

create or replace function public.party_rule_cast_vote(p_proposal_id uuid, p_yes boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  pr record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into pr from public.party_rule_proposals where id = p_proposal_id;
  if not found then raise exception 'Proposal not found'; end if;
  if pr.status is distinct from 'open' then raise exception 'Voting is closed on this proposal'; end if;

  if not public._party_is_board_member(pr.party_key, v_uid) then
    raise exception 'Only seated national committee board members may vote';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.party is distinct from pr.party_key) then
    raise exception 'Party mismatch';
  end if;

  insert into public.party_rule_votes (proposal_id, voter_id, yes)
  values (p_proposal_id, v_uid, p_yes)
  on conflict (proposal_id, voter_id) do update set yes = excluded.yes, voted_at = now();

  perform public._party_rule_try_close(p_proposal_id);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_rule_cast_vote(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
