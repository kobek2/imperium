-- Revert calendar-spawned seat races (midterm / presidential cycles) without un-seating anyone.
--
-- What this does:
--   1) Deletes rows from simulation_calendar_events for midterm/presidential milestones and their
--      deferred leadership_close_* children, so the automated calendar can open those cycles again later.
--   2) Deletes every public.elections row with calendar_cycle_key set (House/Senate/President created
--      by handleMidtermElectionOpen / handlePresidentialElectionOpen). ON DELETE CASCADE removes
--      election_candidates, primary_votes, general_votes, and other child rows tied to those races.
--
-- What this does NOT do:
--   * It does NOT delete onboarding or admin-created races (calendar_cycle_key is null).
--   * It does NOT delete or change government_role_grants, profiles.office_role, or bills.
--   * It does NOT undo role changes from apply_election_role_transitions if a race was already
--     closed and seated. If winners were applied, deleting the election row does not restore prior
--     incumbents — fix that only from backup or deliberate admin SQL if needed.
--
-- Safe when the mistaken work was mostly "opened" races (filing/primary/general) that never finished
-- seating, or when you accept current grants as source of truth.
--
-- Run in Supabase SQL Editor (or psql) against the target project. Review counts in a transaction first if unsure.

begin;

-- Drop RP freeze from an in-progress reverted cycle (if columns exist)
update public.simulation_settings
set
  calendar_seat_cycle_freeze_rp_year = null,
  calendar_seat_cycle_freeze_rp_month = null
where id = 1;

-- Clear calendar dedupe for midterm/presidential cycles only (keeps inauguration_2029, budget_*, etc.)
delete from public.simulation_calendar_events
where event_key like 'midterms%'
   or event_key like 'presidential%'
   or event_key like 'leadership_close_midterm%'
   or event_key like 'leadership_close_post_pres%';

-- All automated cycle seat races (House, Senate, President) created with a cycle key
delete from public.elections
where calendar_cycle_key is not null;

commit;
