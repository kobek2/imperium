-- Who rejected a bill in leadership hopper (originating or receiving chamber).

alter table public.bills
  add column if not exists rejection_actor_id uuid references auth.users (id) on delete set null,
  add column if not exists rejection_at timestamptz;

comment on column public.bills.rejection_actor_id is
  'User who rejected the bill from leadership review (originating or other chamber), when applicable.';
comment on column public.bills.rejection_at is
  'Timestamp of leadership rejection, when applicable.';

notify pgrst, 'reload schema';
