-- Richer court ruling inbox copy + deep link to the public docket article.
-- Allow any authenticated user to read *disposed* cases (closed/expired) so inbox links work
-- outside the cabinet circle (ruling rows are already fanned to all profiles).

create or replace function public._rp_inbox_court_ruling(
  p_case_id uuid,
  p_case_label text,
  p_outcome_tier text,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_topic text;
  v_fact text;
  v_question text;
  v_side text;
  v_posture text;
  v_outcome_label text;
  v_body text;
begin
  select
    c.topic,
    c.fact_pattern,
    c.question_presented,
    coalesce(c.side_taken, '')
  into v_topic, v_fact, v_question, v_side
  from public.rp_court_cases c
  where c.id = p_case_id;

  v_outcome_label := initcap(replace(p_outcome_tier, '_', ' '));

  v_posture := case v_side
    when 'defend' then 'The Solicitor General argued in defense of the United States'' position on the merits.'
    when 'challenge' then 'The government appeared as challenger, pressing the United States'' affirmative theory against the underlying order.'
    when 'amicus' then 'The Department filed as amicus curiae, framing the question for the Court without occupying the principal party line.'
    when 'decline' then 'The United States declined to defend; the Court heard argument without full-throated government advocacy for the underlying program.'
    else 'The record does not reflect a final government appearance before disposition.'
  end;

  v_title := 'Court rules — ' || p_case_label;

  v_body :=
    'WASHINGTON — After briefing and oral argument, the Court issued its judgment in '
    || p_case_label
    || '. For the United States, the disposition is classified as a '
    || v_outcome_label
    || '.' || E'\n\n'
    || 'Capsule: ' || coalesce(v_topic, 'Federal litigation') || '. '
    || coalesce(v_fact, '')
    || E'\n\n'
    || 'Question presented: '
    || coalesce(v_question, 'Not recorded on the docket.')
    || E'\n\n'
    || v_posture
    || E'\n\n'
    || 'Holding and reasoning (dispatch): '
    || coalesce(p_summary, 'The Court''s full opinion will be published in the United States Reports.');

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'court_ruling',
    v_title,
    v_body,
    '/docket/' || p_case_id::text,
    'court_ruling:' || p_case_id::text
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public._rp_inbox_court_ruling(uuid, text, text, text) from public;
grant execute on function public._rp_inbox_court_ruling(uuid, text, text, text) to authenticated;
grant execute on function public._rp_inbox_court_ruling(uuid, text, text, text) to service_role;

drop policy if exists "rp_court_cases read disposed public" on public.rp_court_cases;
create policy "rp_court_cases read disposed public"
  on public.rp_court_cases for select
  to authenticated
  using (status in ('closed', 'expired'));

-- Point older ruling notifications at the article URL (dedupe_key is `court_ruling:<case uuid>`).
update public.inbox_items
set href = '/docket/' || replace(dedupe_key, 'court_ruling:', '')
where kind = 'court_ruling'
  and dedupe_key like 'court_ruling:%'
  and href in ('/cabinet/justice', '/cabinet/justice/');
