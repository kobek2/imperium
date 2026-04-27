-- Presidential scoring loads campaign_ads through PostgREST with the anon key.
-- A SELECT policy restricted to role "authenticated" only returns rows when the
-- JWT session is present as authenticated; some server paths can present as anon,
-- yielding an empty ads list (map shows 0 raw pts) while SQL as postgres shows rows.
-- Allowing SELECT for all roles matches tables that use USING (true) without a TO clause;
-- the anon key is already exposed to the browser as NEXT_PUBLIC_SUPABASE_ANON_KEY.

drop policy if exists "campaign ads read authed" on public.campaign_ads;
create policy "campaign ads read all"
  on public.campaign_ads
  for select
  using (true);

notify pgrst, 'reload schema';
