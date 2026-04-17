-- Primary ballots: default same-party voters anywhere; optional restrict to seat jurisdiction only.

alter table public.elections
  add column if not exists primary_party_wide boolean not null default true;

comment on column public.elections.primary_party_wide is
  'When true, any profile in the same party may vote in this race''s primary. When false, House requires profiles.home_district_code = race district; Senate requires profiles.residence_state = race state. President races ignore restriction (always party-wide).';
