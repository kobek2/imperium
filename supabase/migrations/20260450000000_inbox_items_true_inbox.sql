-- True inbox: durable rows per user, written by triggers when the sim changes.
-- Home page reads `inbox_items` (not ad-hoc joins). RLS: users see only their rows.

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('election_win', 'bill_milestone', 'party_leadership')),
  title text not null,
  body text not null default '',
  href text not null default '/',
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index inbox_items_user_created_idx on public.inbox_items (user_id, created_at desc);

alter table public.inbox_items enable row level security;

create policy "inbox_items select own" on public.inbox_items
  for select using (auth.uid() = user_id);

-- ---------- Mark read (no broad UPDATE policy on the table) ----------
create or replace function public.inbox_mark_read(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.inbox_items
  set read_at = now()
  where id = p_id and user_id = auth.uid();
end;
$$;

grant execute on function public.inbox_mark_read(uuid) to authenticated;

-- ---------- Trigger helpers ----------
create or replace function public._inbox_election_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot text;
  v_body text;
begin
  if new.phase is distinct from 'closed' or new.winner_user_id is null then
    return new;
  end if;
  if old.phase = 'closed' and old.winner_user_id is not distinct from new.winner_user_id then
    return new;
  end if;

  if new.leadership_role is not null then
    v_slot := 'Leadership · ' || new.leadership_role;
  elsif new.office = 'house' then
    v_slot := 'House ' || coalesce(new.district_code, '');
  elsif new.office = 'senate' then
    v_slot := 'Senate ' || coalesce(new.state::text, '');
  else
    v_slot := 'President';
  end if;

  v_body := v_slot || ' — your term is reflected in the directory and sim roles.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.winner_user_id,
    'election_win',
    'You won the election',
    v_body,
    '/elections/' || new.id::text,
    'election:' || new.id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists inbox_on_election_closed on public.elections;
create trigger inbox_on_election_closed
  after update of phase, winner_user_id on public.elections
  for each row
  execute function public._inbox_election_closed();

create or replace function public._inbox_bill_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.author_id is null then return new; end if;
  if new.status not in ('law', 'vetoed', 'passed_congress', 'oval') then return new; end if;
  if old.status is not distinct from new.status then return new; end if;

  v_title := case new.status
    when 'law' then 'Your bill is now law'
    when 'vetoed' then 'Veto recorded'
    when 'passed_congress' then 'Congress passed your bill'
    when 'oval' then 'Bill reached the President’s desk'
    else 'Bill update'
  end;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.author_id,
    'bill_milestone',
    v_title,
    new.title,
    '/congress',
    'bill:' || new.id::text || ':' || new.status::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists inbox_on_bill_status on public.bills;
create trigger inbox_on_bill_status
  after update of status on public.bills
  for each row
  execute function public._inbox_bill_status();

create or replace function public._inbox_party_officer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party text;
  v_office text;
  v_body text;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.user_id is not distinct from new.user_id then return new; end if;

  v_party := case new.party_key
    when 'democrat' then 'Democratic Party'
    when 'republican' then 'Republican Party'
    else new.party_key
  end;
  v_office := case new.office
    when 'chair' then 'Party chair'
    when 'vice_chair' then 'Party vice chair'
    when 'treasurer' then 'Party treasurer'
    else new.office
  end;
  v_body := v_party || ' · ' || v_office;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.user_id,
    'party_leadership',
    'Party leadership role',
    v_body,
    '/parties/' || new.party_key,
    'party_officer:' || new.party_key || ':' || new.office || ':' || new.since::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists inbox_on_party_officer on public.party_officers;
create trigger inbox_on_party_officer
  after insert or update of user_id, party_key, office, since on public.party_officers
  for each row
  execute function public._inbox_party_officer();

-- ---------- Backfill (one-time; safe to re-run) ----------
insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key, created_at)
select
  e.winner_user_id,
  'election_win',
  'You won the election',
  case
    when e.leadership_role is not null then 'Leadership · ' || e.leadership_role
    when e.office = 'house' then 'House ' || coalesce(e.district_code, '')
    when e.office = 'senate' then 'Senate ' || coalesce(e.state::text, '')
    else 'President'
  end || ' — your term is reflected in the directory and sim roles.',
  '/elections/' || e.id::text,
  'election:' || e.id::text,
  coalesce(e.general_closes_at, e.created_at)
from public.elections e
where e.phase = 'closed' and e.winner_user_id is not null
on conflict (user_id, dedupe_key) do nothing;

insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key, created_at)
select
  b.author_id,
  'bill_milestone',
  case b.status
    when 'law' then 'Your bill is now law'
    when 'vetoed' then 'Veto recorded'
    when 'passed_congress' then 'Congress passed your bill'
    when 'oval' then 'Bill reached the President’s desk'
    else 'Bill update'
  end,
  b.title,
  '/congress',
  'bill:' || b.id::text || ':' || b.status::text,
  coalesce(b.signed_at, b.vetoed_at, b.created_at)
from public.bills b
where b.status in ('law', 'vetoed', 'passed_congress', 'oval')
on conflict (user_id, dedupe_key) do nothing;

insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key, created_at)
select
  po.user_id,
  'party_leadership',
  'Party leadership role',
  case po.party_key
    when 'democrat' then 'Democratic Party'
    when 'republican' then 'Republican Party'
    else po.party_key
  end || ' · ' || case po.office
    when 'chair' then 'Party chair'
    when 'vice_chair' then 'Party vice chair'
    when 'treasurer' then 'Party treasurer'
    else po.office
  end,
  '/parties/' || po.party_key,
  'party_officer:' || po.party_key || ':' || po.office || ':' || po.since::text,
  po.since
from public.party_officers po
where po.user_id is not null
on conflict (user_id, dedupe_key) do nothing;

notify pgrst, 'reload schema';
