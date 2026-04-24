import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { FileBillForm } from "../file-bill-form";
import {
  canFileFederalLegislation,
  canFileLegislationInChamber,
} from "@/lib/legislative-eligibility";
import { CongressDocketSection } from "../congress-docket-section";
import { filterBillsForSenateDocket, loadCongressDocket } from "../load-congress-docket";

export default async function CongressSenatePage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open the hopper.
      </div>
    );
  }

  if (!user) redirect("/login");

  const docket = await loadCongressDocket(supabase, user.id);
  const { billList, votesByBill, voterById, roleKeys, leadershipSessions, isRunningMate, canBreakSenateTie } =
    docket;

  const senateBills = filterBillsForSenateDocket(billList);
  const canFile = canFileFederalLegislation(roleKeys);
  const showSenateFiling = canFileLegislationInChamber(roleKeys, "senate");
  const canFileHouseOnly =
    canFileLegislationInChamber(roleKeys, "house") && !canFileLegislationInChamber(roleKeys, "senate");

  const userChambers: ("house" | "senate")[] = [];
  const rk = new Set(roleKeys);
  if (rk.has("representative") || rk.has("president") || rk.has("admin")) userChambers.push("house");
  if (rk.has("senator") || rk.has("admin")) userChambers.push("senate");

  const senateLeadershipSessions = (leadershipSessions ?? []).filter((s) => s.chamber === "senate");
  const isSenateMember = rk.has("senator") || rk.has("admin");
  const observeSenate = !isSenateMember;

  return (
    <div className="space-y-10">
      <p className="text-sm text-[var(--psc-muted)]">
        <Link href="/congress" className="font-semibold text-[var(--psc-accent)] underline">
          ← Congress overview
        </Link>
      </p>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">United States Senate</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Senate-originated bills follow review → docket → floor vote. When a bill is on the Senate floor, members vote
          here; Vice Presidential tie-breaks follow the usual rules shown on each bill.
        </p>
        {observeSenate ? (
          <p className="mt-4 rounded-md border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-sm text-[var(--psc-muted)]">
            You&apos;re viewing the Senate docket as a visitor. File and most floor votes are limited to seated
            Senators (tie-break rules still apply to the Vice President when shown on a bill).
          </p>
        ) : null}
      </section>

      {senateLeadershipSessions.length ? (
        <section className="space-y-3 border border-amber-700 bg-amber-50 p-5">
          <h3 className="text-base font-semibold text-amber-900">Senate leadership election in session</h3>
          <ul className="space-y-2">
            {senateLeadershipSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-white px-3 py-2"
              >
                <p className="text-xs text-[var(--psc-muted)]">Closes {new Date(s.closes_at).toLocaleString()}</p>
                {isSenateMember ? (
                  <Link
                    href={`/congress/leadership/session/${s.id}`}
                    className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
                  >
                    Open Senate ballot →
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--psc-muted)]">Senators only</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h3 className="text-lg font-semibold text-[var(--psc-ink)]">File Senate legislation</h3>
        {showSenateFiling ? (
          <>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Your seat files in the Senate.</p>
            <FileBillForm originatingChamber="senate" />
          </>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-[var(--psc-muted)]">
            {canFileHouseOnly ? (
              <p>
                Your seated role files House-originated measures. Use the{" "}
                <Link href="/congress/house" className="font-semibold text-[var(--psc-accent)] underline">
                  House
                </Link>{" "}
                page to file.
              </p>
            ) : !canFile ? (
              <p>
                Filing unlocks when your profile has a <strong className="text-[var(--psc-ink)]">Representative</strong>
                , <strong className="text-[var(--psc-ink)]">Senator</strong>, or{" "}
                <strong className="text-[var(--psc-ink)]">President</strong> role (via Discord role sync / grants).
              </p>
            ) : (
              <p>You can&apos;t file Senate legislation with your current roles.</p>
            )}
          </div>
        )}
      </section>

      <CongressDocketSection
        sectionId="senate-docket"
        heading="Senate docket"
        subheading="Measures filed in the Senate and any bill currently on the Senate floor (including House-originated measures after they clear the House)."
        shellClassName="border-[var(--psc-border)] bg-white"
        headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        bills={senateBills}
        votesByBill={votesByBill}
        voterById={voterById}
        userId={user.id}
        userChambers={userChambers}
        isRunningMate={isRunningMate}
        canBreakSenateTie={canBreakSenateTie}
        suppressVoteForms={observeSenate}
        emptyLabel="No Senate-originated bills on the docket."
      />
    </div>
  );
}
