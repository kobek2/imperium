import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPageAny } from "@/lib/staff-access";
import { LeadershipToggle, type LeadershipSessionRow } from "../elections/leadership-toggle";

export default async function AdminLeadershipPage() {
  await requireStaffPageAny(["elections", "simulation"]);

  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/");

  const { data: sessions, error: sessionsErr } = await supabase
    .from("leadership_sessions")
    .select("id, chamber, phase, majority_party, opens_at, closes_at, closed_at")
    .eq("phase", "open");

  const leadershipSchemaMissing =
    !!sessionsErr &&
    (sessionsErr.message.toLowerCase().includes("leadership_sessions") || sessionsErr.code === "PGRST205");

  const sessionRows = (sessions ?? []) as LeadershipSessionRow[];
  const houseSession = sessionRows.find((s) => s.chamber === "house") ?? null;
  const senateSession = sessionRows.find((s) => s.chamber === "senate") ?? null;

  return (
    <div className="max-w-4xl space-y-6 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--psc-border)] pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Administration
          </p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Chamber leadership</h1>
          <p className="mt-2 max-w-2xl text-[var(--psc-muted)]">
            Manual 24-hour House and Senate leadership windows (same flow as the simulation calendar at inauguration
            milestones). One open session per chamber.
          </p>
        </div>
        <Link href="/admin/elections" className="text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2">
          ← Elections console
        </Link>
      </div>

      <LeadershipToggle
        houseSession={houseSession}
        senateSession={senateSession}
        schemaMissing={leadershipSchemaMissing}
      />
    </div>
  );
}
