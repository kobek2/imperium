-- Whip instructions + annual approval participation balancing.

create table if not exists public.bill_whip_instructions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  chamber text not null check (chamber in ('house', 'senate')),
  party text not null check (party in ('democrat', 'republican', 'independent')),
  instructed_vote text not null check (instructed_vote in ('yea', 'nay', 'present', 'abstain')),
  rationale text,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  unique (bill_id, chamber, party)
);

create index if not exists bill_whip_instructions_bill_idx
  on public.bill_whip_instructions (bill_id, chamber, party);

alter table public.bill_whip_instructions enable row level security;

create or replace function public._can_set_whip_for_chamber(uid uuid, p_chamber text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.government_role_grants g
    where g.user_id = uid
      and (
        g.role_key = 'admin'
        or (p_chamber = 'house' and g.role_key in ('speaker', 'house_majority_leader', 'house_majority_whip', 'house_minority_whip'))
        or (p_chamber = 'senate' and g.role_key in ('senate_majority_leader', 'senate_majority_whip', 'senate_minority_whip'))
      )
  ) or exists (
    select 1
    from public.profiles p
    where p.id = uid
      and (
        p.office_role = 'admin'
        or (p_chamber = 'house' and p.office_role in ('speaker', 'house_majority_leader', 'house_majority_whip', 'house_minority_whip'))
        or (p_chamber = 'senate' and p.office_role in ('senate_majority_leader', 'senate_majority_whip', 'senate_minority_whip'))
      )
  );
$$;

drop policy if exists "bill_whip_instructions read authed" on public.bill_whip_instructions;
create policy "bill_whip_instructions read authed" on public.bill_whip_instructions
  for select using (auth.role() = 'authenticated');

drop policy if exists "bill_whip_instructions write whips" on public.bill_whip_instructions;
create policy "bill_whip_instructions write whips" on public.bill_whip_instructions
  for insert with check (
    auth.uid() is not null
    and set_by = auth.uid()
    and public._can_set_whip_for_chamber(auth.uid(), chamber)
  );

drop policy if exists "bill_whip_instructions update whips" on public.bill_whip_instructions;
create policy "bill_whip_instructions update whips" on public.bill_whip_instructions
  for update using (
    auth.uid() is not null
    and public._can_set_whip_for_chamber(auth.uid(), chamber)
  )
  with check (
    auth.uid() is not null
    and set_by = auth.uid()
    and public._can_set_whip_for_chamber(auth.uid(), chamber)
  );

-- Extend inbox kinds so whip notices can show on Home.
alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check
  check (kind in ('election_win', 'bill_milestone', 'party_leadership', 'whip_instruction'));

notify pgrst, 'reload schema';
