-- Extend officer analytics with implied salary bases for levy rows (for chair preview at draft rates).

create or replace function public.party_leadership_analytics(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
  member_count int;
  wallet_sum numeric;
  treasury_bal numeric;
  board_n int;
  paid_members numeric;
  paid_elections numeric;
  vacant_offices int;
  cand_count int;
  phase text;
  v_saved_rate numeric;
  levy_total_all numeric;
  levy_total_fy numeric;
  levy_base_all numeric;
  levy_base_fy numeric;
  levy_payers int;
  levy_by_member jsonb;
  fy_started timestamptz;
  fy_label text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;

  if not public._party_is_leadership_officer(p_party, v_uid) then
    raise exception 'Analytics are limited to the party chair, vice chair, and treasurer';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select count(*)::int into member_count from public.profiles where party = p_party;

  select coalesce(sum(w.balance), 0) into wallet_sum
  from public.economy_wallets w
  join public.profiles p on p.id = w.user_id
  where p.party = p_party;

  select treasury_balance, member_collect_levy_rate into treasury_bal, v_saved_rate
  from public.party_organizations where party_key = p_party;

  select count(*)::int into board_n from public.party_national_board_members where party_key = p_party;

  select coalesce(sum(el.delta), 0) into paid_members
  from public.economy_ledger el
  join public.profiles p on p.id = el.wallet_user_id
  where p.party = p_party
    and el.kind = 'party_treasury_in'
    and el.detail->>'party' = p_party;

  select coalesce(sum(g.amount), 0) into paid_elections
  from public.party_treasury_election_grants g
  where g.party_key = p_party;

  select count(*)::int into vacant_offices
  from unnest(array['chair', 'vice_chair', 'treasurer']::text[]) o(office)
  where not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party and po.office = o.office and po.user_id is not null
  );

  select count(*)::int into cand_count
  from public.party_officer_candidacies c
  where c.party_key = p_party;

  select leadership_phase into phase from public.party_organizations where party_key = p_party;

  select coalesce(sum(-el.delta), 0) into levy_total_all
  from public.economy_ledger el
  where el.kind = 'party_collect_levy'
    and el.detail->>'party' = p_party;

  select coalesce(sum(
    case
      when el.detail ? 'party_levy_salary_base' then greatest(0::numeric, coalesce((el.detail->>'party_levy_salary_base')::numeric, 0))
      when coalesce(v_saved_rate, 0) > 0 then (-el.delta) / v_saved_rate
      else 0::numeric
    end
  ), 0) into levy_base_all
  from public.economy_ledger el
  where el.kind = 'party_collect_levy'
    and el.detail->>'party' = p_party;

  select y.started_at, y.label into fy_started, fy_label
  from public.rp_fiscal_years y
  where y.status = 'active'
  limit 1;

  if fy_started is null then
    levy_total_fy := 0;
    levy_base_fy := 0;
  else
    select coalesce(sum(-el.delta), 0) into levy_total_fy
    from public.economy_ledger el
    where el.kind = 'party_collect_levy'
      and el.detail->>'party' = p_party
      and el.created_at >= fy_started;

    select coalesce(sum(
      case
        when el.detail ? 'party_levy_salary_base' then greatest(0::numeric, coalesce((el.detail->>'party_levy_salary_base')::numeric, 0))
        when coalesce(v_saved_rate, 0) > 0 then (-el.delta) / v_saved_rate
        else 0::numeric
      end
    ), 0) into levy_base_fy
    from public.economy_ledger el
    where el.kind = 'party_collect_levy'
      and el.detail->>'party' = p_party
      and el.created_at >= fy_started;
  end if;

  select count(distinct el.wallet_user_id)::int into levy_payers
  from public.economy_ledger el
  where el.kind = 'party_collect_levy'
    and el.detail->>'party' = p_party;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', per.uid,
        'character_name', coalesce(nullif(trim(p.character_name), ''), p.discord_username, per.uid::text),
        'total', per.total,
        'salary_base', round(per.salary_base, 2)
      )
      order by per.total desc
    ),
    '[]'::jsonb
  )
  into levy_by_member
  from (
    select el.wallet_user_id as uid,
      sum(-el.delta)::numeric as total,
      sum(
        case
          when el.detail ? 'party_levy_salary_base' then greatest(0::numeric, coalesce((el.detail->>'party_levy_salary_base')::numeric, 0))
          when coalesce(v_saved_rate, 0) > 0 then (-el.delta) / v_saved_rate
          else 0::numeric
        end
      )::numeric as salary_base
    from public.economy_ledger el
    where el.kind = 'party_collect_levy'
      and el.detail->>'party' = p_party
    group by el.wallet_user_id
    order by total desc
    limit 40
  ) per
  join public.profiles p on p.id = per.uid;

  return jsonb_build_object(
    'member_count', member_count,
    'aggregate_member_wallet_usd', wallet_sum,
    'treasury_balance_usd', coalesce(treasury_bal, 0),
    'national_board_seats_filled', board_n,
    'treasury_transferred_to_member_wallets_usd', paid_members,
    'treasury_historic_election_grants_usd', paid_elections,
    'vacant_officer_slots', vacant_offices,
    'leadership_cycle_phase', coalesce(phase, 'idle'),
    'leadership_candidate_rows', cand_count,
    'salary_levy_collected_all_time_usd', round(coalesce(levy_total_all, 0), 2),
    'salary_levy_collected_active_fy_usd', round(coalesce(levy_total_fy, 0), 2),
    'salary_levy_payers_all_time', coalesce(levy_payers, 0),
    'salary_levy_by_member', coalesce(levy_by_member, '[]'::jsonb),
    'salary_levy_active_fy_label', fy_label,
    'salary_levy_salary_base_all_time_usd', round(coalesce(levy_base_all, 0), 2),
    'salary_levy_salary_base_active_fy_usd', round(coalesce(levy_base_fy, 0), 2)
  );
end;
$$;

notify pgrst, 'reload schema';
