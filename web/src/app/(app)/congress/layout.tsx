import { processBillDeadlines } from "@/lib/bill-pipeline";
import { getCongressAttentionSnapshotForRequest } from "@/lib/congress-viewer-attention";
import { getServerAuth } from "@/lib/supabase/server";
import { CongressChamberNav, type CongressChamberBadgeCounts } from "./congress-chamber-nav";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();
  let chamberBadges: CongressChamberBadgeCounts | null = null;
  if (supabase) {
    const [, attentionSnap] = await Promise.all([
      processBillDeadlines(supabase),
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
