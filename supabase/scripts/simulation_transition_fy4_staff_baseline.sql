-- Requires migration 20260523100000_admin_simulation_transition_fy4_staff_baseline.sql
-- Preconditions: active fiscal year must be FY 3 (year_index = 3).
-- Run in SQL editor or: supabase db push

select public.admin_simulation_transition_fy4_staff_baseline();
