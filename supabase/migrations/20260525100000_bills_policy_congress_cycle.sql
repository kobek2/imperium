-- Tags each preset / "Change Policy" bill with the RP two-year congressional window when it was filed,
-- so the app can enforce one Change Policy bill per member per Congress.

alter table public.bills
  add column if not exists policy_congress_cycle_start_year int null;

comment on column public.bills.policy_congress_cycle_start_year is
  'RP calendar year that starts a two-year Congress window (2029, 2031, … from anchor 2029). Set when template_id is set; used for one Change Policy bill per member per Congress.';

-- Existing template bills: treat as filed in the first sim Congress window so counts stay consistent.
update public.bills
set policy_congress_cycle_start_year = 2029
where template_id is not null
  and policy_congress_cycle_start_year is null;
