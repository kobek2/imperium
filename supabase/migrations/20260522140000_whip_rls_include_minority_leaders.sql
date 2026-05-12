-- Align whip write RLS with app role sets: minority leaders may publish caucus instructions too.

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
        or (p_chamber = 'house' and g.role_key in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'house_minority_leader',
          'house_minority_whip'
        ))
        or (p_chamber = 'senate' and g.role_key in (
          'senate_majority_leader',
          'senate_majority_whip',
          'senate_minority_leader',
          'senate_minority_whip'
        ))
      )
  ) or exists (
    select 1
    from public.profiles p
    where p.id = uid
      and (
        p.office_role = 'admin'
        or (p_chamber = 'house' and p.office_role in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'house_minority_leader',
          'house_minority_whip'
        ))
        or (p_chamber = 'senate' and p.office_role in (
          'senate_majority_leader',
          'senate_majority_whip',
          'senate_minority_leader',
          'senate_minority_whip'
        ))
      )
  );
$$;
