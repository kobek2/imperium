-- New wallets: default last_collected_at far enough in the past that the first economy_collect_income
-- can accrue at least one hour and pay immediately (collect RPC requires floor(elapsed hours) >= 1).
alter table public.economy_wallets
  alter column last_collected_at set default (now() - interval '1 hour');

-- Wallets that never received hourly pay yet: if last_collected_at is still within the first hour window,
-- treat like a fresh row so the first click can pay one hour.
update public.economy_wallets w
set last_collected_at = now() - interval '1 hour'
where not exists (
  select 1 from public.economy_ledger l
  where l.wallet_user_id = w.user_id and l.kind = 'hourly_income'
)
and w.last_collected_at > now() - interval '1 hour';
