-- Court inbox links: open dispatch articles at /docket/:id (readable by any signed-in user)
-- instead of the cabinet-only Justice workbench.

create or replace function public._rp_inbox_court_case_filed(
  p_case_id uuid,
  p_case_label text,
  p_topic text,
  p_fact_pattern text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
begin
  v_body :=
    'A new case has been docketed: '
    || p_case_label
    || '. Topic: '
    || p_topic
    || '. '
    || p_fact_pattern
    || E'\n\nThe Attorney General must enter an appearance within five days. The President may issue an advisory directive on the position the United States should take.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'court_case_filed',
    'Court docket — ' || p_case_label,
    v_body,
    '/docket/' || p_case_id::text,
    'court_case_filed:' || p_case_id::text
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public._rp_inbox_court_case_filed(uuid, text, text, text) from public;
grant execute on function public._rp_inbox_court_case_filed(uuid, text, text, text) to authenticated;
grant execute on function public._rp_inbox_court_case_filed(uuid, text, text, text) to service_role;

create or replace function public._rp_inbox_court_directive(
  p_case_id uuid,
  p_case_label text,
  p_directive text
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
  v_title := 'Presidential directive — ' || p_case_label;
  v_body :=
    'The President has advised the Department of Justice to take the position: '
    || upper(p_directive)
    || ' on '
    || p_case_label
    || '. The Attorney General retains discretion; overriding the directive carries a public-confidence cost when the ruling lands.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'court_directive_issued',
    v_title,
    v_body,
    '/docket/' || p_case_id::text,
    'court_directive:' || p_case_id::text
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public._rp_inbox_court_directive(uuid, text, text) from public;
grant execute on function public._rp_inbox_court_directive(uuid, text, text) to authenticated;
grant execute on function public._rp_inbox_court_directive(uuid, text, text) to service_role;

drop policy if exists "rp_court_cases read active dispatch public" on public.rp_court_cases;
create policy "rp_court_cases read active dispatch public"
  on public.rp_court_cases for select
  to authenticated
  using (status in ('open', 'argued'));

update public.inbox_items
set href = '/docket/' || replace(dedupe_key, 'court_case_filed:', '')
where kind = 'court_case_filed'
  and dedupe_key like 'court_case_filed:%'
  and (href = '/cabinet/justice' or href = '/cabinet/justice/');

update public.inbox_items
set href = '/docket/' || replace(dedupe_key, 'court_directive:', '')
where kind = 'court_directive_issued'
  and dedupe_key like 'court_directive:%'
  and (href = '/cabinet/justice' or href = '/cabinet/justice/');
