-- Year-end fiscal summary → one inbox row per profile when an FY is marked closed.

alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check
  check (
    kind in (
      'election_win',
      'bill_milestone',
      'party_leadership',
      'whip_instruction',
      'executive_order',
      'diplomatic_crisis',
      'fiscal_year_report'
    )
  );

create or replace function public._inbox_after_fy_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_body text;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  if NEW.status is distinct from 'closed' or OLD.status = 'closed' then
    return NEW;
  end if;

  select * into s from public.fiscal_year_close_summaries where fiscal_year_id = NEW.id limit 1;
  if not found then
    return NEW;
  end if;

  v_body := format(
    'Appropriations (enacted): %s | Tax assessed: %s | Tax collected: %s | Funding ratio: %s | Wallet-sum GDP at close: %s. National metrics were rolled into the new fiscal year. Open Inbox for this summary anytime.',
    trim(to_char(coalesce(s.appropriations_total, 0), 'FM999,999,999,999')),
    trim(to_char(coalesce(s.tax_assessed_total, 0), 'FM999,999,999,999')),
    trim(to_char(coalesce(s.tax_collected_total, 0), 'FM999,999,999,999')),
    trim(to_char(round(coalesce(s.funding_ratio, 0) * 100, 2), 'FM999,990.00')) || '%',
    trim(to_char(coalesce(NEW.gdp_closing_total, 0), 'FM999,999,999,999'))
  );

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  select
    p.id,
    'fiscal_year_report',
    'Fiscal year closed: ' || coalesce(NEW.label, 'FY'),
    v_body,
    '/inbox',
    'fiscal_year_report:' || NEW.id::text
  from public.profiles p
  on conflict (user_id, dedupe_key) do nothing;

  return NEW;
end;
$$;

drop trigger if exists trg_inbox_fy_closed on public.rp_fiscal_years;
create trigger trg_inbox_fy_closed
  after update of status on public.rp_fiscal_years
  for each row
  execute function public._inbox_after_fy_closed();

notify pgrst, 'reload schema';
