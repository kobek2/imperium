alter table public.bills
  add column if not exists leadership_deadline_at timestamptz,
  add column if not exists chamber_vote_deadline_at timestamptz;

comment on column public.bills.leadership_deadline_at is
  'When status is hopper, originating-chamber leadership must accept or reject before this time (12h).';

comment on column public.bills.chamber_vote_deadline_at is
  'When on a chamber floor, yea/nay tally closes at this time (24h).';
