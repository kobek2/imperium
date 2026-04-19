-- One-time wipe of economy + party treasury transactional data (merge to main / clean prod).
-- Does not touch elections, campaign_points on candidates, party officers, or leadership state.

truncate table public.economy_ledger;
truncate table public.economy_blackjack_sessions;

delete from public.party_treasury_election_grants;

truncate table public.economy_pacs;
truncate table public.economy_inventory;

-- Every profile gets a zeroed wallet and a fresh collect clock (matches economy_wallet defaults).
insert into public.economy_wallets (user_id, balance, last_collected_at, updated_at)
select id, 0::numeric, now() - interval '1 hour', now()
from public.profiles
on conflict (user_id) do update set
  balance = excluded.balance,
  last_collected_at = excluded.last_collected_at,
  updated_at = excluded.updated_at;

update public.party_organizations
set treasury_balance = 0, updated_at = now()
where party_key in ('democrat', 'republican');

notify pgrst, 'reload schema';
