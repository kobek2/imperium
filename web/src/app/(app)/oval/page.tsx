import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { presidentialAction } from "@/app/actions/bills";
import { OvalAppointmentForm } from "./appointment-form";
import { SubmitButton } from "@/components/submit-button";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canActAsPresident } from "@/lib/role-capabilities";
import { BillCard, type BillVote, type VoterProfile } from "../congress/bill-card";

export default async function OvalPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to unlock the Oval Office.
      </div>
    );
  }

  if (!user) redirect("/login");

  await processBillDeadlines(supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const president = canActAsPresident(roleKeys);

  const { data: desk } = await supabase
    .from("bills")
    .select(
      "id, title, author_id, content_html, content_md, status, originating_chamber, created_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
    )
    .eq("status", "oval")
    .order("created_at", { ascending: false });

  const deskList = desk ?? [];
  const deskIds = deskList.map((b) => b.id);

  let deskVotes: BillVote[] = [];
  if (deskIds.length) {
    const { data: rawVotes } = await supabase
      .from("bill_votes")
      .select("bill_id, voter_id, chamber, vote")
      .in("bill_id", deskIds);
    deskVotes = (rawVotes ?? []) as BillVote[];
  }

  const authorIds = deskList.map((b) => b.author_id).filter(Boolean);
  const voterIds = Array.from(new Set([...deskVotes.map((v) => v.voter_id), ...authorIds]));
  const voterById = new Map<string, VoterProfile>();
  if (voterIds.length) {
    const { data: voterProfiles } = await supabase
      .from("profiles")
      .select("id, character_name, party")
      .in("id", voterIds);
    for (const p of (voterProfiles ?? []) as VoterProfile[]) voterById.set(p.id, p);
  }

  const votesByBill = new Map<string, BillVote[]>();
  for (const v of deskVotes) {
    const list = votesByBill.get(v.bill_id) ?? [];
    list.push(v);
    votesByBill.set(v.bill_id, list);
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold">Executive desk</h1>
      </header>

      {president ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">Appointment + confirmation</h2>
          <OvalAppointmentForm />
        </section>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">
          Oval tools unlock when the user has the <code className="font-mono">president</code>{" "}
          grant (or <code className="font-mono">admin</code>) via{" "}
          <code className="font-mono">government_role_grants</code> or legacy{" "}
          <code className="font-mono">profiles.office_role</code>.
        </p>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Awaiting signature</h2>
        {!deskList.length ? (
          <p className="text-sm text-[var(--psc-muted)]">No bills on the desk.</p>
        ) : (
          <div className="space-y-6">
            {deskList.map((bill) => (
              <div key={bill.id} className="space-y-3">
                <BillCard
                  bill={bill}
                  votes={votesByBill.get(bill.id) ?? []}
                  voterById={voterById}
                  userId={user.id}
                  userChambers={[]}
                />
                {president ? (
                  <form action={presidentialAction} className="flex gap-3">
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <SubmitButton
                      name="action"
                      value="sign"
                      pendingLabel="Signing…"
                      className="border border-green-800 bg-green-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
                    >
                      Sign
                    </SubmitButton>
                    <SubmitButton
                      name="action"
                      value="veto"
                      pendingLabel="Vetoing…"
                      className="border border-red-800 bg-red-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
                    >
                      Veto
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
