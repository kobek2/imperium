-- One-shot reset for local / staging testing of the AG court docket.
-- Run in Supabase SQL editor (or: `psql $DATABASE_URL -f supabase/scripts/reset_court_docket_for_testing.sql`).

begin;

-- Clear all docketed cases so the next /cabinet/justice load opens a fresh case.
truncate public.rp_court_cases;

-- Clear AG daily hours so the budget refills.
delete from public.cabinet_daily_hours where role_key = 'attorney_general';

-- Clear AG-related inbox items so the next case_filed insert is not deduped.
delete from public.inbox_items
where dedupe_key like 'court_case_filed:%'
   or dedupe_key like 'court_directive:%'
   or dedupe_key like 'court_ruling:%';

-- Reset DOJ public confidence to the baseline so outcome deltas are visible.
update public.rp_cabinet_department_metrics
set body = jsonb_set(coalesce(body, '{}'::jsonb), '{public_confidence}', to_jsonb(55))
where portfolio_key = 'justice';

-- Restore any bills the court struck during testing back to law (only if their previous status was law).
update public.bills
set
  status = 'law'::public.bill_status,
  struck_down_by_court_case_id = null
where struck_down_by_court_case_id is not null;

commit;
