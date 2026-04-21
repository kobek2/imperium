import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { submitBill } from "@/app/actions/bills";
import {
  canFileFederalLegislation,
  canFileLegislationInChamber,
} from "@/lib/legislative-eligibility";
import { CongressDocketSection } from "../congress-docket-section";
import { loadCongressDocket } from "../load-congress-docket";

export default async function CongressHousePage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open the hopper.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const docket = await loadCongressDocket(supabase, user.id);
  const { billList, votesByBill, voterById, roleKeys, leadershipSessions, isRunningMate, canBreakSenateTie } =
    docket;

  const houseBills = billList.filter((b) => b.originating_chamber === "house");
  const canFile = canFileFederalLegislation(roleKeys);
  const showHouseFiling = canFileLegislationInChamber(roleKeys, "house");
  const canFileSenateOnly =
    canFileLegislationInChamber(roleKeys, "senate") && !canFileLegislationInChamber(roleKeys, "house");

  const userChambers: ("house" | "senate")[] = [];
  const rk = new Set(roleKeys);
  if (rk.has("representative") || rk.has("president") || rk.has("admin")) userChambers.push("house");
  if (rk.has("senator") || rk.has("admin")) userChambers.push("senate");

  const houseLeadershipSessions = (leadershipSessions ?? []).filter((s) => s.chamber === "house");
  const isHouseMember = rk.has("representative") || rk.has("president") || rk.has("admin");
  const observeHouse = !isHouseMember;

  return (
    <div className="space-y-10">
      <p className="text-sm text-[var(--psc-muted)]">
        <Link href="/congress" className="font-semibold text-[var(--psc-accent)] underline">
          ← Congress overview
        </Link>
      </p>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">House of Representatives</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          House-originated bills: leadership has <strong className="text-[var(--psc-ink)]">12 hours</strong> to schedule
          from the hopper; if scheduled, the House has{" "}
          <strong className="text-[var(--psc-ink)]">24 hours</strong> to vote before the bill moves on. Other chambers
          still act in sequence — cards show both House and Senate tallies when relevant.
        </p>
        {observeHouse ? (
          <p className="mt-4 rounded-md border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-sm text-[var(--psc-muted)]">
            You&apos;re viewing the House docket as a visitor. File and floor votes stay limited to seated
            Representatives.
          </p>
        ) : null}
      </section>

      {houseLeadershipSessions.length ? (
        <section className="space-y-3 border border-amber-700 bg-amber-50 p-5">
          <h3 className="text-base font-semibold text-amber-900">House leadership election in session</h3>
          <ul className="space-y-2">
            {houseLeadershipSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-white px-3 py-2"
              >
                <p className="text-xs text-[var(--psc-muted)]">Closes {new Date(s.closes_at).toLocaleString()}</p>
                {isHouseMember ? (
                  <Link
                    href={`/congress/leadership/session/${s.id}`}
                    className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
                  >
                    Open House ballot →
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--psc-muted)]">Representatives only</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h3 className="text-lg font-semibold text-[var(--psc-ink)]">File House legislation</h3>
        {showHouseFiling ? (
          <>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Your seat files in the House.</p>
            <form action={submitBill} className="mt-4 grid gap-4 md:grid-cols-2">
              <input type="hidden" name="originating_chamber" value="house" />
              <label className="grid gap-2 text-sm font-semibold md:col-span-2">
                Title
                <input
                  name="title"
                  required
                  className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold md:col-span-2">
                Markdown body
                <textarea
                  name="content_md"
                  rows={6}
                  required
                  className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
                />
              </label>
            <button
              type="submit"
              className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2 hover:brightness-110"
            >
              File House bill
            </button>
            </form>
          </>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-[var(--psc-muted)]">
            {canFileSenateOnly ? (
              <p>
                Your seated role files Senate-originated measures. Use the{" "}
                <Link href="/congress/senate" className="font-semibold text-[var(--psc-accent)] underline">
                  Senate
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
              <p>You can&apos;t file House legislation with your current roles.</p>
            )}
          </div>
        )}
      </section>

      <CongressDocketSection
        sectionId="house-docket"
        heading="House docket"
        subheading="All active measures that originated in the House."
        shellClassName="border-[var(--psc-border)] bg-white"
        headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        bills={houseBills}
        votesByBill={votesByBill}
        voterById={voterById}
        userId={user.id}
        userChambers={userChambers}
        isRunningMate={isRunningMate}
        canBreakSenateTie={canBreakSenateTie}
        suppressVoteForms={observeHouse}
        emptyLabel="No House-originated bills on the docket."
      />
    </div>
  );
}
