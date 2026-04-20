import { tryCreateClient } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { CongressChamberNav } from "./congress-chamber-nav";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const supabase = await tryCreateClient();
  if (supabase) {
    await processBillDeadlines(supabase);
    await runElectionPhaseSchedule(supabase);
  }

  let showHopper = false;
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    showHopper = Boolean(user);
  }

  return (
    <div className="space-y-8">
      <CongressChamberNav showHopper={showHopper} />
      {children}
    </div>
  );
}
