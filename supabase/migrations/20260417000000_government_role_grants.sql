-- One row per Discord-equivalent office/party/caucus role granted to a user.
-- The Discord bot (service role) should upsert rows when guild member roles change.

create table public.government_role_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create index government_role_grants_user_id_idx on public.government_role_grants (user_id);

alter table public.government_role_grants enable row level security;

create policy "government_role_grants read authed" on public.government_role_grants
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete for end users — only service role / dashboard bypasses RLS.
