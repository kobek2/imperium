-- Presidential signature + executive orders; inbox broadcast on publish.

alter table public.profiles
  add column if not exists presidential_signature text;

comment on column public.profiles.presidential_signature is
  'RP signing name the president sets once before issuing executive orders (plain text).';

create table if not exists public.executive_orders (
  id uuid primary key default gen_random_uuid(),
  issued_by uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  body text not null,
  signature_captured text not null,
  created_at timestamptz not null default now(),
  constraint executive_orders_title_nonempty check (char_length(trim(title)) > 0),
  constraint executive_orders_body_len check (char_length(body) between 1 and 8000),
  constraint executive_orders_title_len check (char_length(title) <= 300),
  constraint executive_orders_sig_len check (char_length(signature_captured) between 1 and 500)
);

create index if not exists executive_orders_created_idx on public.executive_orders (created_at desc);

alter table public.executive_orders enable row level security;

create policy "executive_orders select authenticated"
  on public.executive_orders for select
  to authenticated
  using (true);

-- ---------- Helpers ----------
create or replace function public._user_is_acting_president(uid uuid)
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
      and g.role_key in ('president', 'admin')
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.office_role in ('president', 'admin')
  );
$$;

create or replace function public.save_presidential_signature(p_signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := trim(coalesce(p_signature, ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public._user_is_acting_president(auth.uid()) then
    raise exception 'Only the acting president may set a presidential signature';
  end if;
  if char_length(t) < 2 then
    raise exception 'Signature is too short';
  end if;
  if char_length(t) > 500 then
    raise exception 'Signature is too long';
  end if;

  update public.profiles
  set presidential_signature = t, updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.save_presidential_signature(text) to authenticated;

create or replace function public.publish_executive_order(p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig text;
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_eo_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public._user_is_acting_president(auth.uid()) then
    raise exception 'Only the acting president may publish executive orders';
  end if;

  select trim(coalesce(presidential_signature, '')) into v_sig
  from public.profiles
  where id = auth.uid();

  if v_sig is null or char_length(v_sig) < 2 then
    raise exception 'Set your presidential signature on the Executive desk before publishing an executive order';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 300 then
    raise exception 'Title must be 1–300 characters';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 8000 then
    raise exception 'Body must be 1–8000 characters';
  end if;

  insert into public.executive_orders (issued_by, title, body, signature_captured)
  values (auth.uid(), v_title, v_body, v_sig)
  returning id into v_eo_id;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'executive_order'::text,
    v_title,
    left(v_body, 400),
    '/oval/executive-orders/' || v_eo_id::text,
    'eo:' || v_eo_id::text
  from public.profiles p;

  return v_eo_id;
end;
$$;

grant execute on function public.publish_executive_order(text, text) to authenticated;

-- Allow inbox rows for executive orders (broadcast).
alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check
  check (
    kind in (
      'election_win',
      'bill_milestone',
      'party_leadership',
      'whip_instruction',
      'executive_order'
    )
  );

notify pgrst, 'reload schema';
