-- Public bucket for character portrait files (replaces fragile hotlinks to Discord / random hosts).
-- App uploads to {user_id}/face.{ext}; only that user may write; anyone may read.
--
-- Version note: do not reuse 20260427220000 — that timestamp is already used by
-- 20260427220000_campaign_ads_select_all_roles.sql

insert into storage.buckets (id, name, public)
values ('face_claims', 'face_claims', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "face_claims public read" on storage.objects;
create policy "face_claims public read"
on storage.objects for select
to public
using (bucket_id = 'face_claims');

drop policy if exists "face_claims insert own" on storage.objects;
create policy "face_claims insert own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'face_claims'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "face_claims update own" on storage.objects;
create policy "face_claims update own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'face_claims'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'face_claims'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "face_claims delete own" on storage.objects;
create policy "face_claims delete own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'face_claims'
  and split_part(name, '/', 1) = auth.uid()::text
);

notify pgrst, 'reload schema';
