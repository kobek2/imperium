-- Legislative overhaul: templates, policy status, debate pipeline columns, amendments,
-- approval award log, extended bill_status enum, bill_votes 'present', profile approval.

-- ---------- bill_templates ----------
create table if not exists public.bill_templates (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null unique,
  display_name text not null,
  description text,
  stances jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.bill_templates is 'Preset issue templates with stance objects (stance_key, label, summary, full_text, policy_value).';

alter table public.bill_templates enable row level security;
create policy "bill_templates read authenticated"
  on public.bill_templates for select
  using (auth.role() = 'authenticated');

-- ---------- policy_status ----------
create table if not exists public.policy_status (
  issue_key text primary key references public.bill_templates (issue_key) on delete cascade,
  current_stance_key text,
  current_policy_value numeric,
  last_changed_at timestamptz,
  last_changed_by_bill_id uuid references public.bills (id) on delete set null,
  history jsonb not null default '[]'::jsonb
);

comment on table public.policy_status is 'Law-of-the-land tracker per issue_key; updated when policy bills are signed.';

alter table public.policy_status enable row level security;
create policy "policy_status read authenticated"
  on public.policy_status for select
  using (auth.role() = 'authenticated');

-- ---------- bills: new columns ----------
alter table public.bills
  add column if not exists policy_tags jsonb,
  add column if not exists template_id uuid references public.bill_templates (id) on delete set null,
  add column if not exists debate_started_at timestamptz;

comment on column public.bills.policy_tags is 'e.g. {"issue_key":"abortion","stance_key":"legalize","policy_value":1}';
comment on column public.bills.template_id is 'Preset template used to draft this bill, if any.';

-- ---------- bill_status enum additions (preserve existing values) ----------
alter type public.bill_status add value if not exists 'debate';
alter type public.bill_status add value if not exists 'other_chamber_review';
alter type public.bill_status add value if not exists 'other_chamber_debate';
alter type public.bill_status add value if not exists 'failed';

-- ---------- bill_amendments ----------
create table if not exists public.bill_amendments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  proposed_by uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null,
  amended_text text,
  status text not null default 'pending' check (status in ('pending', 'adopted', 'rejected', 'tabled')),
  proposed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  notes text
);

create index if not exists bill_amendments_bill_id_idx on public.bill_amendments (bill_id);
create index if not exists bill_amendments_pending_idx on public.bill_amendments (bill_id) where status = 'pending';

comment on table public.bill_amendments is 'Chamber debate-phase amendments; leaders resolve.';

alter table public.bill_amendments enable row level security;
create policy "bill_amendments read authenticated"
  on public.bill_amendments for select
  using (auth.role() = 'authenticated');
create policy "bill_amendments insert authenticated"
  on public.bill_amendments for insert
  with check (auth.uid() = proposed_by);
create policy "bill_amendments update leaders"
  on public.bill_amendments for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.office_role in (
          'speaker',
          'senate_majority_leader',
          'admin'
        )
    )
    or exists (
      select 1 from public.government_role_grants g
      where g.user_id = auth.uid()
        and g.role_key in ('speaker', 'senate_majority_leader', 'admin')
    )
  );

-- ---------- bill_approval_award_log (idempotent vote-close processing) ----------
create table if not exists public.bill_approval_award_log (
  bill_id uuid not null references public.bills (id) on delete cascade,
  chamber public.bill_chamber not null,
  processed_at timestamptz not null default now(),
  primary key (bill_id, chamber)
);

alter table public.bill_approval_award_log enable row level security;
create policy "bill_approval_award_log read authenticated"
  on public.bill_approval_award_log for select
  using (auth.role() = 'authenticated');

-- Idempotent "vote close" marker + cross-user approval updates (RLS-safe)
create or replace function public.register_vote_close_approval(p_bill_id uuid, p_chamber public.bill_chamber)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into public.bill_approval_award_log (bill_id, chamber) values (p_bill_id, p_chamber)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.apply_profile_approval_delta(p_user_id uuid, p_delta numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur numeric;
  newv numeric;
  hist jsonb;
begin
  select coalesce(approval_rating, 50), coalesce(approval_history, '[]'::jsonb)
  into cur, hist
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    return;
  end if;
  newv := greatest(0::numeric, least(100::numeric, cur + p_delta));
  hist := hist || jsonb_build_array(
    jsonb_build_object(
      'date', to_jsonb(now()),
      'delta', p_delta,
      'reason', to_jsonb(p_reason),
      'new_value', newv
    )
  );
  update public.profiles
  set approval_rating = newv, approval_history = hist, updated_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.policy_status_apply_signed_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tags jsonb;
  ik text;
  sk text;
  pv numeric;
  bt_title text;
  h jsonb;
  entry jsonb;
begin
  select policy_tags, title into tags, bt_title from public.bills where id = p_bill_id;
  if tags is null then
    return;
  end if;
  ik := tags->>'issue_key';
  sk := tags->>'stance_key';
  pv := nullif(tags->>'policy_value', '')::numeric;
  if ik is null or sk is null or pv is null then
    return;
  end if;
  select history into h from public.policy_status where issue_key = ik;
  h := coalesce(h, '[]'::jsonb);
  entry := jsonb_build_object(
    'stance_key', sk,
    'date', to_jsonb(now()),
    'bill_id', to_jsonb(p_bill_id),
    'bill_title', to_jsonb(bt_title)
  );
  h := coalesce(h, '[]'::jsonb) || jsonb_build_array(entry);
  insert into public.policy_status (issue_key, current_stance_key, current_policy_value, last_changed_at, last_changed_by_bill_id, history)
  values (ik, sk, pv, now(), p_bill_id, h)
  on conflict (issue_key) do update set
    current_stance_key = excluded.current_stance_key,
    current_policy_value = excluded.current_policy_value,
    last_changed_at = excluded.last_changed_at,
    last_changed_by_bill_id = excluded.last_changed_by_bill_id,
    history = excluded.history;
end;
$$;

revoke all on function public.register_vote_close_approval(uuid, public.bill_chamber) from public;
grant execute on function public.register_vote_close_approval(uuid, public.bill_chamber) to authenticated;
grant execute on function public.register_vote_close_approval(uuid, public.bill_chamber) to service_role;

revoke all on function public.apply_profile_approval_delta(uuid, numeric, text) from public;
grant execute on function public.apply_profile_approval_delta(uuid, numeric, text) to authenticated;
grant execute on function public.apply_profile_approval_delta(uuid, numeric, text) to service_role;

revoke all on function public.policy_status_apply_signed_bill(uuid) from public;
grant execute on function public.policy_status_apply_signed_bill(uuid) to authenticated;
grant execute on function public.policy_status_apply_signed_bill(uuid) to service_role;

-- ---------- bill_votes: allow 'present' ----------
do $$
declare cname text;
begin
  for cname in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.bill_votes'::regclass and c.contype = 'c'
  loop
    if (select pg_get_constraintdef(oid) from pg_constraint where conname = cname) like '%vote%' then
      execute format('alter table public.bill_votes drop constraint %I', cname);
    end if;
  end loop;
end$$;
alter table public.bill_votes
  add constraint bill_votes_vote_check check (vote in ('yea', 'nay', 'abstain', 'present'));

-- ---------- profiles: approval ----------
alter table public.profiles
  add column if not exists approval_rating numeric not null default 50
    check (approval_rating >= 0 and approval_rating <= 100);
alter table public.profiles
  add column if not exists approval_history jsonb not null default '[]'::jsonb;

comment on column public.profiles.approval_rating is 'Public political approval 0–100.';
comment on column public.profiles.approval_history is 'JSON array of {date, delta, reason, new_value}.';
