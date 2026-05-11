-- NSC Situation Room: crisis inbox goes to national-security principals only (not every profile).
-- Deep link opens /cabinet/nsc (app route) for a combined State relations + Defense posture briefing.
-- Version 20260518123000: renamed from 20260518120000 to avoid duplicate migration version with
-- 20260518120000_admin_appropriations_window.sql (Supabase schema_migrations PK is the numeric prefix).

create or replace function public.rp_diplomacy_broadcast_crisis_inbox(
  p_nation_code text,
  p_nation_name text,
  p_day text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  v_title := 'Diplomatic alert — ' || p_nation_name;
  v_body :=
    'Bilateral standing with '
    || p_nation_name
    || ' has fallen to a critical range on the State Department tracker. '
    || 'Open the Situation Room briefing for a shared State–Defense picture; '
    || 'the Secretary of State may still pursue outreach while Defense aligns contingency planning.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    r.id,
    'diplomatic_crisis',
    v_title,
    v_body,
    '/cabinet/nsc',
    'dip_crisis:' || upper(trim(p_nation_code)) || ':' || p_day
  from (
    select distinct g.user_id as id
    from public.government_role_grants g
    where g.role_key in (
      'president',
      'vice_president',
      'chief_of_staff',
      'secretary_of_state',
      'secretary_of_defense'
    )
    union
    select distinct p.id
    from public.profiles p
    where p.office_role in (
      'president',
      'vice_president',
      'chief_of_staff',
      'secretary_of_state',
      'secretary_of_defense'
    )
  ) r
  where r.id is not null
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

notify pgrst, 'reload schema';
