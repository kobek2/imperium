-- Stock-vote conflict tracking, investigations, and blackmail.

alter table public.bills add column if not exists sector_tag public.business_sector;

update public.bills b set sector_tag = 'defense'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('defense', 'military');
update public.bills b set sector_tag = 'energy'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('energy', 'climate');
update public.bills b set sector_tag = 'finance'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('finance', 'tax', 'banking');
update public.bills b set sector_tag = 'pharma'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('healthcare', 'pharma', 'drug');
update public.bills b set sector_tag = 'tech'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('tech', 'telecom', 'internet');
update public.bills b set sector_tag = 'media'
where sector_tag is null and lower(coalesce(b.policy_tags ->> 'issue_key', '')) in ('media', 'communications');

create or replace function public._corruption_on_bill_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bill_row record;
  h record;
begin
  select b.id, b.title, b.sector_tag into bill_row from public.bills b where b.id = new.bill_id;
  if bill_row.sector_tag is null then return new; end if;

  for h in
    select sh.shares, b.id as business_id, b.name, b.sector
    from public.stock_holdings sh
    join public.businesses b on b.id = sh.business_id
    where sh.user_id = new.voter_id and sh.shares > 0 and b.sector = bill_row.sector_tag
  loop
    insert into public.corruption_ledger (actor_user_id, action_type, metadata)
    values (
      new.voter_id,
      'stock_vote_conflict',
      jsonb_build_object(
        'bill_id', bill_row.id,
        'bill_title', bill_row.title,
        'sector', h.sector,
        'shares_held', h.shares,
        'business_id', h.business_id,
        'business_name', h.name,
        'vote', new.vote
      )
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists corruption_bill_vote_conflict on public.bill_votes;
create trigger corruption_bill_vote_conflict
  after insert on public.bill_votes
  for each row execute function public._corruption_on_bill_vote();

-- ---------- Investigation cooldowns ----------
create table if not exists public.investigation_cooldowns (
  investigator_user_id uuid primary key references public.profiles (id) on delete cascade,
  last_investigation_at timestamptz not null default now()
);

-- ---------- Blackmail ----------
create table if not exists public.blackmail_demands (
  id uuid primary key default gen_random_uuid(),
  holder_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  corruption_entry_id uuid not null references public.corruption_ledger (id) on delete cascade,
  amount numeric(20, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'exposed', 'expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.blackmail_demands enable row level security;
drop policy if exists "blackmail read parties" on public.blackmail_demands;
create policy "blackmail read parties" on public.blackmail_demands for select to authenticated
  using (holder_user_id = auth.uid() or target_user_id = auth.uid());

-- ---------- Can this user investigate? ----------
create or replace function public._can_investigate(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  keys text[];
  bal numeric;
begin
  if p_uid is null then return false; end if;
  keys := public._economy_effective_role_keys(p_uid);
  if keys && array['president']::text[] then return true; end if;
  if keys && array['senate_majority_leader', 'president_pro_tempore']::text[] then return true; end if;
  select balance into bal from public.economy_wallets where user_id = p_uid;
  if coalesce(bal, 0) > 500000000 then return true; end if;
  return false;
end;
$$;

-- ---------- Investigate player ----------
create or replace function public.investigate_player(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 500000;
  w record;
  new_bal numeric;
  last_at timestamptz;
  entries jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_target is null then raise exception 'Target required'; end if;
  if not public._can_investigate(v_uid) then
    raise exception 'You lack authority to investigate (president, senate leadership, or $500M+ wallet required)';
  end if;

  select last_investigation_at into last_at from public.investigation_cooldowns where investigator_user_id = v_uid;
  if last_at is not null and now() < last_at + interval '24 hours' then
    raise exception 'Investigation cooldown — try again after 24 hours';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Investigation costs $500,000'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.investigation_cooldowns (investigator_user_id, last_investigation_at)
  values (v_uid, now())
  on conflict (investigator_user_id) do update set last_investigation_at = now();

  with picked as (
    select cl.id, cl.action_type, cl.amount, cl.created_at
    from public.corruption_ledger cl
    where cl.actor_user_id = p_target and cl.is_exposed = false
    order by random()
    limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'action_type', p.action_type, 'amount', p.amount, 'created_at', p.created_at
  )), '[]'::jsonb) into entries from picked p;

  update public.corruption_ledger cl
  set found_by_user_id = v_uid
  where cl.id in (
    select (e->>'id')::uuid from jsonb_array_elements(entries) e
  );

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'investigation', jsonb_build_object('target', p_target));

  return jsonb_build_object('ok', true, 'entries', entries, 'balance', new_bal);
end;
$$;

grant execute on function public.investigate_player(uuid) to authenticated;

-- ---------- Expose corruption ----------
create or replace function public.expose_corruption(p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  entry record;
  target_name text;
  new_approval numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into entry from public.corruption_ledger where id = p_entry for update;
  if entry.id is null then raise exception 'Entry not found'; end if;
  if entry.is_exposed then raise exception 'Already exposed'; end if;
  if entry.found_by_user_id is distinct from v_uid then raise exception 'Only the investigator who found this may expose it'; end if;

  update public.corruption_ledger
  set is_exposed = true, exposed_at = now(), exposed_by_user_id = v_uid
  where id = p_entry;

  select character_name into target_name from public.profiles where id = entry.actor_user_id;

  update public.profiles
  set approval_rating = greatest(0, coalesce(approval_rating, 50) - 15), updated_at = now()
  where id = entry.actor_user_id;

  insert into public.simulation_event_instances (template_key, title, summary, status, severity, metadata)
  values (
    'economy_corruption_exposed',
    'Corruption exposed: ' || coalesce(target_name, 'Official'),
    coalesce(target_name, 'An official') || ' was publicly exposed for ' || entry.action_type || '.',
    'active',
    3,
    jsonb_build_object('actor_user_id', entry.actor_user_id, 'entry_id', p_entry, 'action_type', entry.action_type)
  );

  return jsonb_build_object('ok', true, 'actor_user_id', entry.actor_user_id);
end;
$$;

grant execute on function public.expose_corruption(uuid) to authenticated;

-- ---------- Blackmail ----------
create or replace function public.blackmail_player(p_entry uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  entry record;
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  demand_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt <= 0 then raise exception 'Demand amount must be positive'; end if;

  select * into entry from public.corruption_ledger where id = p_entry;
  if entry.id is null then raise exception 'Entry not found'; end if;
  if entry.is_exposed then raise exception 'Already exposed — no leverage'; end if;
  if entry.found_by_user_id is distinct from v_uid then raise exception 'You must have found this via investigation'; end if;
  if entry.actor_user_id = v_uid then raise exception 'Cannot blackmail yourself'; end if;

  insert into public.blackmail_demands (holder_user_id, target_user_id, corruption_entry_id, amount)
  values (v_uid, entry.actor_user_id, p_entry, amt)
  returning id into demand_id;

  return jsonb_build_object('ok', true, 'demand_id', demand_id);
end;
$$;

grant execute on function public.blackmail_player(uuid, numeric) to authenticated;

-- ---------- Pay blackmail ----------
create or replace function public.pay_blackmail(p_demand uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d record;
  w_from record;
  w_to record;
  new_from numeric;
  new_to numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into d from public.blackmail_demands where id = p_demand for update;
  if d.id is null then raise exception 'Demand not found'; end if;
  if d.target_user_id <> v_uid then raise exception 'Not your demand'; end if;
  if d.status <> 'pending' then raise exception 'Demand already resolved'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w_from from public.economy_wallets where user_id = v_uid for update;
  if w_from.balance < d.amount then raise exception 'Insufficient balance'; end if;

  insert into public.economy_wallets (user_id) values (d.holder_user_id) on conflict do nothing;
  select * into w_to from public.economy_wallets where user_id = d.holder_user_id for update;

  new_from := w_from.balance - d.amount;
  new_to := w_to.balance + d.amount;

  update public.economy_wallets set balance = new_from, updated_at = now() where user_id = v_uid;
  update public.economy_wallets set balance = new_to, updated_at = now() where user_id = d.holder_user_id;

  update public.blackmail_demands set status = 'paid', resolved_at = now() where id = p_demand;

  return jsonb_build_object('ok', true, 'paid', d.amount);
end;
$$;

grant execute on function public.pay_blackmail(uuid) to authenticated;

-- ---------- Auto-expose expired blackmail (call from app or cron) ----------
create or replace function public.process_expired_blackmail()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  n int := 0;
begin
  for d in
    select bd.id, bd.corruption_entry_id, bd.holder_user_id
    from public.blackmail_demands bd
    where bd.status = 'pending' and bd.created_at < now() - interval '48 hours'
  loop
    update public.blackmail_demands set status = 'exposed', resolved_at = now() where id = d.id;
    update public.corruption_ledger
    set is_exposed = true, exposed_at = now(), exposed_by_user_id = d.holder_user_id
    where id = d.corruption_entry_id and is_exposed = false;
    update public.profiles
    set approval_rating = greatest(0, coalesce(approval_rating, 50) - 15), updated_at = now()
    where id = (select actor_user_id from public.corruption_ledger where id = d.corruption_entry_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.process_expired_blackmail() to authenticated;

-- Seed corruption expose event template if missing
insert into public.simulation_event_templates (template_key, title, summary, category, default_hours, spawn_weight, enabled)
values ('economy_corruption_exposed', 'Corruption exposed', 'A player was publicly exposed for corrupt activity.', 'economy', 24, 0, false)
on conflict (template_key) do nothing;
