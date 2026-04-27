-- World chat: short public lines for signed-in players; Realtime pushes new rows.

create table public.world_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 500),
  author_display text not null default 'Member',
  created_at timestamptz not null default now()
);

create index world_chat_messages_created_idx on public.world_chat_messages (created_at desc);

create or replace function public.world_chat_message_set_author_display()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select coalesce(
    nullif(trim(character_name), ''),
    nullif(trim(discord_username), ''),
    'Member'
  )
  into new.author_display
  from public.profiles
  where id = new.user_id;
  if new.author_display is null or trim(new.author_display) = '' then
    new.author_display := 'Member';
  end if;
  return new;
end;
$$;

drop trigger if exists world_chat_messages_set_author_display on public.world_chat_messages;
create trigger world_chat_messages_set_author_display
  before insert on public.world_chat_messages
  for each row
  execute function public.world_chat_message_set_author_display();

alter table public.world_chat_messages enable row level security;

create policy "world_chat_messages select authenticated"
  on public.world_chat_messages for select
  to authenticated
  using (true);

create policy "world_chat_messages insert own"
  on public.world_chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.world_chat_messages;
