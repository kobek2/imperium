import Link from "next/link";
import { requireStaffPageAny } from "@/lib/staff-access";
import { createElection } from "@/app/actions/elections";
import { getServerAuth } from "@/lib/supabase/server";
import {
  countTotalPlayers,
  loadDistrictPopulations,
  loadStatePopulations,
} from "@/lib/seat-populations";
import { CreateElectionForm } from "./create-election-form";

export default async function NewElectionPage() {
  await requireStaffPageAny(["elections", "simulation"]);

  const { supabase } = await getServerAuth();
  // Pull populations so the form can show "CA-01 — 2 players" and flag empty seats before
  // admins create elections no one is going to file for.
  const [districts, states, totalPlayers] = supabase
    ? await Promise.all([
        loadDistrictPopulations(supabase),
        loadStatePopulations(supabase),
        countTotalPlayers(supabase),
      ])
    : [[], [], 0];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Link
        href="/admin/elections"
        className="admin-textlink text-sm font-semibold text-[var(--psc-accent)]"
      >
        ← Elections
      </Link>
      <div>
        <h2 className="text-xl font-semibold">Create election</h2>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Phases advance automatically based on the schedule below. Defaults are filing 24h, primary 24h,
          general 48h — edit the durations if you want a different cadence.
        </p>
      </div>
      <CreateElectionForm
        action={createElection}
        districts={districts}
        states={states}
        totalPlayers={totalPlayers}
      />
    </div>
  );
}
