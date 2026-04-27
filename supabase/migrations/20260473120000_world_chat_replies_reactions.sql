-- Congressional chat: thread-style replies + per-message emoji reactions (Realtime).

alter table public.world_chat_messages
  add column if not exists reply_to_id uuid references public.world_chat_messages (id) on delete set null;

create index if not exists world_chat_messages_reply_to_idx on public.world_chat_messages (reply_to_id);

create table if not exists public.world_chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.world_chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) >= 1 and char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists world_chat_reactions_message_idx on public.world_chat_message_reactions (message_id);

-- So Realtime DELETE events include message_id / user_id / emoji in payload.old
alter table public.world_chat_message_reactions replica identity full;

alter table public.world_chat_message_reactions enable row level security;

create policy "world_chat_reactions select authenticated"
  on public.world_chat_message_reactions for select
  to authenticated
  using (true);

create policy "world_chat_reactions insert own"
  on public.world_chat_message_reactions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "world_chat_reactions delete own"
  on public.world_chat_message_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.world_chat_message_reactions;
