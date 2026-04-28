-- Admin recompute tool for already-closed leadership sessions.
-- Re-applies role winners using current tally + tie-break rules (earliest filer on ties).

create or replace function public.recompute_closed_leadership_session(s_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sess record;
  rk text;
  winner_user uuid;
  best_votes integer;
  best_filed timestamptz;
  cand record;
  cand_votes integer;
  cand_filed timestamptz;
  roles text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;
  if not public.is_staff_admin(v_uid) then
    raise exception 'Admin privileges required.';
  end if;

  select id, chamber, phase
    into sess
    from public.leadership_sessions
    where id = s_id
    for update;
  if not found then
    raise exception 'Leadership session not found.';
  end if;
  if sess.phase <> 'closed' then
    raise exception 'Only closed leadership sessions can be recomputed.';
  end if;

  if sess.chamber = 'house' then
    roles := array[
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip'
    ];
  else
    roles := array[
      'president_pro_tempore',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip'
    ];
  end if;

  foreach rk in array roles loop
    winner_user := null;
    best_votes := -1;
    best_filed := null;

    for cand in
      select
        c.id,
        c.user_id,
        c.created_at as filed_at,
        (
          select count(*)::int
          from public.leadership_session_votes v
          where v.session_id = s_id
            and v.role = rk
            and v.candidate_id = c.id
        ) as votes
      from public.leadership_session_candidates c
      where c.session_id = s_id and c.role = rk
      order by c.created_at asc, c.id asc
    loop
      cand_votes := cand.votes;
      cand_filed := cand.filed_at;
      if cand_votes > best_votes
         or (
           cand_votes = best_votes
           and (best_filed is null or cand_filed < best_filed)
         )
      then
        best_votes := cand_votes;
        winner_user := cand.user_id;
        best_filed := cand_filed;
      end if;
    end loop;

    delete from public.government_role_grants g
      where g.role_key = rk
        and (winner_user is null or g.user_id <> winner_user);

    if winner_user is not null then
      insert into public.government_role_grants (user_id, role_key)
        values (winner_user, rk)
        on conflict (user_id, role_key) do nothing;
    end if;
  end loop;

  update public.leadership_sessions
    set closed_at = now()
    where id = s_id;
end;
$$;

grant execute on function public.recompute_closed_leadership_session(uuid) to authenticated;

notify pgrst, 'reload schema';
