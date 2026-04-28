-- Admin-curated Hall of Fame entries.

create table if not exists public.hall_of_fame_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  honor_title text not null default 'Hall of Fame',
  note text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists hall_of_fame_entries_active_sort_idx
  on public.hall_of_fame_entries (is_active, sort_order, created_at desc);

alter table public.hall_of_fame_entries enable row level security;

drop policy if exists "hall_of_fame_entries read authenticated" on public.hall_of_fame_entries;
create policy "hall_of_fame_entries read authenticated" on public.hall_of_fame_entries
  for select using (auth.role() = 'authenticated');

drop policy if exists "hall_of_fame_entries admin insert" on public.hall_of_fame_entries;
create policy "hall_of_fame_entries admin insert" on public.hall_of_fame_entries
  for insert with check (public.is_staff_admin(auth.uid()));

drop policy if exists "hall_of_fame_entries admin update" on public.hall_of_fame_entries;
create policy "hall_of_fame_entries admin update" on public.hall_of_fame_entries
  for update using (public.is_staff_admin(auth.uid()));

drop policy if exists "hall_of_fame_entries admin delete" on public.hall_of_fame_entries;
create policy "hall_of_fame_entries admin delete" on public.hall_of_fame_entries
  for delete using (public.is_staff_admin(auth.uid()));

notify pgrst, 'reload schema';
