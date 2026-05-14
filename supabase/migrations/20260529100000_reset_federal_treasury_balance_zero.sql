-- Housekeeping: zero the single federal cash pool row (id = 1). Re-run or adjust if you need a different baseline.

update public.federal_treasury
set balance = 0
where id = 1;

notify pgrst, 'reload schema';
