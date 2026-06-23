import { processBillDeadlines } from "@/lib/bill-pipeline";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getCongressAttentionSnapshotForRequest } from "@/lib/congress-viewer-attention";
import { getServerAuth } from "@/lib/supabase/server";
import { CongressChamberNav, type CongressChamberBadgeCounts } from "./congress-chamber-nav";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();
  let chamberBadges: CongressChamberBadgeCounts | null = null;
  if (supabase) {
    const [, , , attentionSnap] = await Promise.all([
      processBillDeadlines(supabase),
      runElectionPhaseSchedule(supabase),
      supabase.rpc("advance_leadership_sessions_by_schedule"),
      user ? getCongressAttentionSnapshotForRequest(supabase, user.id) : Promise.resolve(null),
    ]);
    if (attentionSnap) {
      chamberBadges = {
        hopper: attentionSnap.hopperLeadershipBadge,
      };
    }
  }

  return (
    <div className="space-y-8">
      <CongressChamberNav showHopper={false} chamberBadges={chamberBadges} />
      {children}
    </div>
  );
}
