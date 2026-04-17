-- Discord user_metadata keys differ by Supabase / Discord API version.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text;
begin
  uname := nullif(trim(coalesce(
    meta->>'preferred_username',
    meta->>'user_name',
    meta->>'global_name',
    meta->>'full_name',
    meta->>'name',
    meta->>'nickname',
    meta->>'username',
    ''
  )), '');

  insert into public.profiles (id, discord_user_id, discord_username, character_name, party)
  values (
    new.id,
    coalesce(
      nullif(meta->>'provider_id', ''),
      nullif(meta->>'sub', ''),
      new.id::text
    ),
    uname,
    coalesce(meta->>'full_name', meta->>'name', split_part(new.email, '@', 1), 'Citizen'),
    'independent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
