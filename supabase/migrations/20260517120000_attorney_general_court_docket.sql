-- Attorney General court docket: rotating Supreme Court / federal docket the AG argues each cycle.
-- Mirrors the diplomacy stack (lib agenda → server actions → workbench → admin audit + inbox fan-out).
--
-- Cases are opened automatically by `rp_court_docket_daily_tick` (called from /cabinet/justice page load
-- and AG actions). The President may issue an *advisory* directive on any open case; the AG can comply,
-- ignore, or actively oppose at a public-confidence cost. Outcomes can strike linked bills (target_bill_id),
-- write small deltas to national_metrics for the active fiscal year, and fan ruling rows to every profile.

-- ---------- 1) Inbox kinds: court_case_filed / court_directive_issued / court_ruling ----------
alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check
  check (
    kind in (
      'election_win',
      'bill_milestone',
      'party_leadership',
      'whip_instruction',
      'executive_order',
      'diplomatic_crisis',
      'fiscal_year_report',
      'court_case_filed',
      'court_directive_issued',
      'court_ruling'
    )
  );

-- ---------- 2) Bills: traceability for cases that strike a law ----------
alter table public.bills
  add column if not exists struck_down_by_court_case_id uuid;

comment on column public.bills.struck_down_by_court_case_id is
  'When the AG loses (or declines to defend) a Supreme Court case linked to this bill, the row id from rp_court_cases is recorded here and bills.status flips to ''dead''.';

-- ---------- 3) rp_court_cases ----------
create table public.rp_court_cases (
  id uuid primary key default gen_random_uuid(),
  archetype_key text not null,
  case_label text not null,
  topic text not null,
  fact_pattern text not null,
  question_presented text not null,
  -- The full agenda payload (frames, opposing arguments, justice questions + responses,
  -- amicus options, tilt). Generated server-side when the case is opened, validated when
  -- the AG submits arguments. See `web/src/lib/court-case-agenda.ts`.
  agenda jsonb not null default '{}'::jsonb,
  -- Status lifecycle: open → argued → closed | expired
  --   open      : case is on the docket, AG has not yet acted, not past closes_at
  --   argued    : AG has submitted arguments / amicus / decline; awaiting close (immediate today)
  --   closed    : court has ruled, outcome recorded
  --   expired   : closes_at passed without AG action; default-loss outcome applied
  status text not null default 'open' check (status in ('open', 'argued', 'closed', 'expired')),
  side_taken text check (side_taken is null or side_taken in ('defend', 'challenge', 'amicus', 'decline')),
  choice_path int[] not null default '{}',
  outcome_tier text check (outcome_tier is null or outcome_tier in ('decisive_win', 'narrow_win', 'narrow_loss', 'decisive_loss')),
  outcome_summary text,
  public_confidence_delta numeric(6,2) not null default 0,
  -- Court composition tilt for scoring (NPC justices for v1). Optional party flavor.
  tilt_party text check (tilt_party is null or tilt_party in ('D', 'R')),
  -- Optional advisory presidential directive (defend / challenge). The AG can override; the
  -- override carries a public-confidence penalty applied at close time.
  presidential_directive text check (presidential_directive is null or presidential_directive in ('defend', 'challenge')),
  presidential_directive_actor uuid references auth.users (id) on delete set null,
  presidential_directive_at timestamptz,
  -- Optional bill linkage: when set, a decisive_loss / decline outcome on a defend posture
  -- strikes the linked bill (sets bills.status = 'dead' and stamps struck_down_by_court_case_id).
  target_bill_id uuid references public.bills (id) on delete set null,
  argued_by uuid references auth.users (id) on delete set null,
  argued_at timestamptz,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null default now() + interval '5 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rp_court_cases_status_closes_idx on public.rp_court_cases (status, closes_at);
create index rp_court_cases_opens_idx on public.rp_court_cases (opens_at desc);
create index rp_court_cases_target_bill_idx on public.rp_court_cases (target_bill_id) where target_bill_id is not null;

alter table public.rp_court_cases enable row level security;

-- Cabinet circle reads the docket for RP context; writes go through security definer RPCs only.
create policy "rp_court_cases read cabinet circle"
  on public.rp_court_cases for select
  to authenticated
  using (public._cabinet_portfolio_viewer(auth.uid()));

create policy "rp_court_cases admin write"
  on public.rp_court_cases for all
  to authenticated
  using (public.is_staff_admin(auth.uid()))
  with check (public.is_staff_admin(auth.uid()));

-- ---------- 4) Inbox broadcast helpers ----------
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
    '/cabinet/justice',
    'court_case_filed:' || p_case_id::text
  from public.profiles p
  where public._cabinet_portfolio_viewer(p.id)
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
    '/cabinet/justice',
    'court_directive:' || p_case_id::text
  from public.profiles p
  where public._cabinet_portfolio_viewer(p.id)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public._rp_inbox_court_directive(uuid, text, text) from public;
grant execute on function public._rp_inbox_court_directive(uuid, text, text) to authenticated;
grant execute on function public._rp_inbox_court_directive(uuid, text, text) to service_role;

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
begin
  v_title := 'Ruling — ' || p_case_label;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'court_ruling',
    v_title,
    'Outcome: ' || replace(p_outcome_tier, '_', ' ') || E'.\n\n' || coalesce(p_summary, ''),
    '/cabinet/justice',
    'court_ruling:' || p_case_id::text
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public._rp_inbox_court_ruling(uuid, text, text, text) from public;
grant execute on function public._rp_inbox_court_ruling(uuid, text, text, text) to authenticated;
grant execute on function public._rp_inbox_court_ruling(uuid, text, text, text) to service_role;

-- ---------- 5) Open a fresh case (security definer; called by tick + admin seeds) ----------
create or replace function public.rp_court_open_case(
  p_archetype_key text,
  p_case_label text,
  p_topic text,
  p_fact_pattern text,
  p_question_presented text,
  p_agenda jsonb,
  p_tilt_party text default null,
  p_target_bill_id uuid default null,
  p_lifetime_hours int default 120
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_archetype_key is null or length(trim(p_archetype_key)) = 0 then
    raise exception 'archetype_key required';
  end if;
  if p_lifetime_hours <= 0 then
    p_lifetime_hours := 120;
  end if;

  insert into public.rp_court_cases (
    archetype_key,
    case_label,
    topic,
    fact_pattern,
    question_presented,
    agenda,
    tilt_party,
    target_bill_id,
    opens_at,
    closes_at
  )
  values (
    p_archetype_key,
    p_case_label,
    p_topic,
    p_fact_pattern,
    p_question_presented,
    coalesce(p_agenda, '{}'::jsonb),
    p_tilt_party,
    p_target_bill_id,
    now(),
    now() + make_interval(hours => p_lifetime_hours)
  )
  returning id into v_id;

  perform public._rp_inbox_court_case_filed(v_id, p_case_label, p_topic, p_fact_pattern);

  return v_id;
end;
$$;

revoke all on function public.rp_court_open_case(text, text, text, text, text, jsonb, text, uuid, int) from public;
grant execute on function public.rp_court_open_case(text, text, text, text, text, jsonb, text, uuid, int) to service_role;
-- Authenticated callers need execute too — RPC guards itself by being security definer; in v1 we
-- only ever invoke it from the lib (server-side) but we also use it from the admin reset script.
grant execute on function public.rp_court_open_case(text, text, text, text, text, jsonb, text, uuid, int) to authenticated;

-- ---------- 6) Set / clear advisory presidential directive ----------
create or replace function public.rp_court_set_directive(
  p_case_id uuid,
  p_directive text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case record;
begin
  if not (
    public._cabinet_portfolio_secretary(auth.uid(), 'president')
    or public.is_staff_admin(auth.uid())
  ) then
    raise exception 'Only the President may issue a court directive.';
  end if;

  if p_directive is not null and p_directive not in ('defend', 'challenge') then
    raise exception 'Directive must be defend, challenge, or null.';
  end if;

  select id, status, case_label
    into v_case
    from public.rp_court_cases
    where id = p_case_id
    for update;
  if not found then
    raise exception 'Case not found.';
  end if;
  if v_case.status <> 'open' then
    raise exception 'This case is no longer open.';
  end if;

  update public.rp_court_cases
    set
      presidential_directive = p_directive,
      presidential_directive_actor = case when p_directive is null then null else auth.uid() end,
      presidential_directive_at = case when p_directive is null then null else now() end,
      updated_at = now()
    where id = p_case_id;

  if p_directive is not null then
    perform public._rp_inbox_court_directive(p_case_id, v_case.case_label, p_directive);
  end if;
end;
$$;

revoke all on function public.rp_court_set_directive(uuid, text) from public;
grant execute on function public.rp_court_set_directive(uuid, text) to authenticated;
grant execute on function public.rp_court_set_directive(uuid, text) to service_role;

-- ---------- 7) Apply outcome to active national_metrics row ----------
create or replace function public._rp_court_apply_metric_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy uuid;
  v_appr_delta numeric;
  v_crime_pct numeric;
begin
  if p_deltas is null or p_deltas = '{}'::jsonb then
    return;
  end if;

  select id into v_fy from public.rp_fiscal_years where status = 'active' limit 1;
  if v_fy is null then
    return;
  end if;

  v_appr_delta := coalesce((p_deltas->>'government_approval_delta')::numeric, 0);
  v_crime_pct := coalesce((p_deltas->>'crime_total_pct')::numeric, 0);

  -- Ensure a row exists for the active fiscal year before patching.
  insert into public.national_metrics (fiscal_year_id)
    values (v_fy)
    on conflict (fiscal_year_id) do nothing;

  update public.national_metrics
    set
      government_approval = greatest(0, least(100, coalesce(government_approval, 50) + v_appr_delta)),
      crime_total = greatest(0, round(coalesce(crime_total, 0) * (1 + v_crime_pct))),
      updated_at = now()
    where fiscal_year_id = v_fy;
end;
$$;

revoke all on function public._rp_court_apply_metric_deltas(jsonb) from public;
grant execute on function public._rp_court_apply_metric_deltas(jsonb) to authenticated;
grant execute on function public._rp_court_apply_metric_deltas(jsonb) to service_role;

-- ---------- 8) Close a case: AG argument / amicus / decline / default-loss ----------
create or replace function public.rp_court_close_case(
  p_case_id uuid,
  p_side_taken text,
  p_choice_path int[],
  p_outcome_tier text,
  p_outcome_summary text,
  p_public_confidence_delta numeric,
  p_metric_deltas jsonb,
  p_strike_bill boolean,
  p_status text default 'closed'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case record;
  v_dept_body jsonb;
  v_conf numeric;
begin
  -- Validate outputs from caller (the server action enforces auth + scoring).
  if p_outcome_tier is null or p_outcome_tier not in ('decisive_win', 'narrow_win', 'narrow_loss', 'decisive_loss') then
    raise exception 'Invalid outcome_tier.';
  end if;
  if p_status not in ('closed', 'expired') then
    raise exception 'Status must be closed or expired.';
  end if;

  select id, status, case_label, target_bill_id, side_taken
    into v_case
    from public.rp_court_cases
    where id = p_case_id
    for update;
  if not found then
    raise exception 'Case not found.';
  end if;
  if v_case.status not in ('open', 'argued') then
    raise exception 'Case is not in a closeable state.';
  end if;

  update public.rp_court_cases
    set
      side_taken = coalesce(p_side_taken, v_case.side_taken),
      choice_path = coalesce(p_choice_path, '{}'::int[]),
      outcome_tier = p_outcome_tier,
      outcome_summary = p_outcome_summary,
      public_confidence_delta = coalesce(p_public_confidence_delta, 0),
      argued_by = coalesce(auth.uid(), argued_by),
      argued_at = coalesce(argued_at, now()),
      status = p_status,
      updated_at = now()
    where id = p_case_id;

  -- Patch the AG's public_confidence flavor metric.
  if coalesce(p_public_confidence_delta, 0) <> 0 then
    select body into v_dept_body
      from public.rp_cabinet_department_metrics
      where portfolio_key = 'justice'
      for update;
    if v_dept_body is not null then
      v_conf := coalesce((v_dept_body->>'public_confidence')::numeric, 50);
      v_conf := greatest(0, least(100, v_conf + p_public_confidence_delta));
      update public.rp_cabinet_department_metrics
        set body = jsonb_set(v_dept_body, '{public_confidence}', to_jsonb(v_conf))
        where portfolio_key = 'justice';
    end if;
  end if;

  -- Apply metric deltas to active national_metrics row.
  if p_metric_deltas is not null and p_metric_deltas <> '{}'::jsonb then
    perform public._rp_court_apply_metric_deltas(p_metric_deltas);
  end if;

  -- Strike the linked bill on a decisive loss (or decline) of a defend posture.
  if p_strike_bill and v_case.target_bill_id is not null then
    update public.bills
      set
        status = 'dead'::public.bill_status,
        struck_down_by_court_case_id = p_case_id
      where id = v_case.target_bill_id
        and status = 'law'::public.bill_status;
  end if;

  perform public._rp_inbox_court_ruling(p_case_id, v_case.case_label, p_outcome_tier, p_outcome_summary);
end;
$$;

revoke all on function public.rp_court_close_case(uuid, text, int[], text, text, numeric, jsonb, boolean, text) from public;
grant execute on function public.rp_court_close_case(uuid, text, int[], text, text, numeric, jsonb, boolean, text) to authenticated;
grant execute on function public.rp_court_close_case(uuid, text, int[], text, text, numeric, jsonb, boolean, text) to service_role;

-- ---------- 9) Daily tick: expire stale cases ----------
-- Opening fresh cases is handled in the lib (TS-side) where archetype content lives.
-- The tick only enforces lifecycle: any open case past closes_at → expired with default-loss.
create or replace function public.rp_court_docket_daily_tick(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_summary text;
begin
  for c in
    select id, case_label, target_bill_id
      from public.rp_court_cases
      where status = 'open' and closes_at < p_now
  loop
    v_summary :=
      'No appearance entered. By default, the United States is treated as having declined to defend; '
      || 'the court rules against the government on '
      || c.case_label
      || '.';

    perform public.rp_court_close_case(
      c.id,
      'decline',
      '{}'::int[],
      'decisive_loss',
      v_summary,
      -4,
      jsonb_build_object('government_approval_delta', -1.5, 'crime_total_pct', 0.02),
      true,
      'expired'
    );
  end loop;
end;
$$;

revoke all on function public.rp_court_docket_daily_tick(timestamptz) from public;
grant execute on function public.rp_court_docket_daily_tick(timestamptz) to authenticated;
grant execute on function public.rp_court_docket_daily_tick(timestamptz) to service_role;

notify pgrst, 'reload schema';
