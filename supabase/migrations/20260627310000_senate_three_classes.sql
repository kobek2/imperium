-- Baseline update: allow Senate seat classes 1-3.

alter table public.elections drop constraint if exists elections_senate_class_check;
alter table public.elections
  add constraint elections_senate_class_check check (senate_class is null or senate_class between 1 and 3);

alter table public.states drop constraint if exists states_senate_class_check;
alter table public.states
  add constraint states_senate_class_check check (senate_class is null or senate_class between 1 and 3);
