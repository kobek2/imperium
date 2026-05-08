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

function countByStatus(
  bills: Array<{ status: string; originating_chamber: "house" | "senate" }>,
  chamber: "house" | "senate",
) {
  const submitted = bills.filter(
    (b) => b.originating_chamber === chamber && (b.status === "submitted" || b.status === "leadership_review"),
  ).length;
  const onDocket = bills.filter((b) => b.originating_chamber === chamber && b.status === "on_docket").length;
  const debate = bills.filter(
    (b) =>
      (b.originating_chamber === chamber && b.status === "debate") ||
      (b.originating_chamber !== chamber && b.status === "other_chamber_debate"),
  ).length;
  const floor = bills.filter((b) => b.status === `${chamber}_floor`).length;
  return { submitted, onDocket, debate, floor };
}

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
  const senateStatus = countByStatus(billList, "senate");

  return (
    <div className="space-y-10">
      <p>
        <Link
          href="/congress"
          className="inline-flex items-center rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-1.5 text-sm font-semibold text-[var(--psc-ink)] shadow-sm hover:bg-[var(--psc-canvas)]"
        >
          ← Congress overview
        </Link>
      </p>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">United States Senate</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Senate-originated bills follow review → docket → floor vote. When a bill is on the Senate floor, members vote
          here; Vice Presidential tie-breaks follow the usual rules shown on each bill.
        </p>
        <p className="mt-3 max-w-3xl rounded-md border border-[var(--psc-border)] bg-[var(--psc-canvas)]/80 px-3 py-2 text-xs leading-relaxed text-[var(--psc-muted)]">
          <strong className="text-[var(--psc-ink)]">House-passed bills</strong> that crossed over appear here under{" "}
          <strong className="text-[var(--psc-ink)]">other chamber review</strong> while Senate leadership decides whether
          to accept them to debate — check Congress overview for a shortcut list.
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
        subheading="Shows Senate pipeline items in chamber workflow: submitted, on_docket, and Senate-floor cards. Bills can also appear in overview sections under leadership review or other-chamber debate depending on stage."
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
        emptyLabel="No bills are currently in the Senate docket view. Check Congress overview for submitted leadership review items, or the “Awaiting receiving chamber” section when the House has sent bills over."
      />
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Senate pipeline snapshot</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          This clarifies where bills are instead of implying they disappeared.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            Submitted: <strong className="text-[var(--psc-ink)]">{senateStatus.submitted}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            On docket: <strong className="text-[var(--psc-ink)]">{senateStatus.onDocket}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            Debate handoff: <strong className="text-[var(--psc-ink)]">{senateStatus.debate}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            Senate floor: <strong className="text-[var(--psc-ink)]">{senateStatus.floor}</strong>
          </li>
        </ul>
      </section>
    </div>
  );
}
