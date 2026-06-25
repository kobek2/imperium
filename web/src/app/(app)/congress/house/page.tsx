import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { FileBillForm } from "../file-bill-form";
import { canFileLegislationInChamber } from "@/lib/legislative-eligibility";
import { getChangePolicyFilingUiGate } from "@/lib/policy-congress-cycle";
import { loadCompanyLobbyFilingContext } from "@/lib/load-company-lobby-filing-context";
import { CongressDocketSection } from "../congress-docket-section";
import { filterBillsForHouseDocket, loadCongressDocket } from "../load-congress-docket";

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

export default async function CongressHousePage({
  searchParams,
}: {
  searchParams?: Promise<{ crisis_arc?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const crisisStoryArcId = String(params.crisis_arc ?? "").trim() || null;
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open Congress.
      </div>
    );
  }

  if (!user) redirect("/login");

  const docket = await loadCongressDocket(supabase, user.id);
  const {
    billList,
    votesByBill,
    voterById,
    roleKeys,
    viewerParty,
    viewerWhipByBillId,
    leadershipSessions,
    isRunningMate,
    canBreakSenateTie,
  } = docket;

  const houseBills = filterBillsForHouseDocket(billList);
  const showHouseFiling = canFileLegislationInChamber(roleKeys, "house");
  const changePolicyGate = showHouseFiling
    ? await getChangePolicyFilingUiGate(supabase, { userId: user.id, roleKeys })
    : { blocked: false as const, message: null as string | null, congressOrdinalLabel: null as string | null };
  const companyLobbyContext = showHouseFiling
    ? await loadCompanyLobbyFilingContext(supabase, user.id)
    : { lobbyOffers: [], ownedCompanies: [] };

  const userChambers: ("house" | "senate")[] = [];
  const rk = new Set(roleKeys);
  if (rk.has("representative") || rk.has("president") || rk.has("admin")) userChambers.push("house");
  if (rk.has("senator") || rk.has("admin")) userChambers.push("senate");

  const houseLeadershipSessions = (leadershipSessions ?? []).filter((s) => s.chamber === "house");
  const isHouseMember = rk.has("representative") || rk.has("president") || rk.has("admin");
  const observeHouse = !isHouseMember;
  const houseStatus = countByStatus(billList, "house");

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">House of Representatives</h2>
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

      {showHouseFiling ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h3 className="text-lg font-semibold text-[var(--psc-ink)]">File House legislation</h3>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">Your seat files in the House.</p>
          <FileBillForm
            originatingChamber="house"
            crisisStoryArcId={crisisStoryArcId}
            changePolicyBlocked={changePolicyGate.blocked}
            changePolicyBlockedMessage={changePolicyGate.message}
            changePolicyCongressLabel={changePolicyGate.congressOrdinalLabel}
            lobbyOffers={companyLobbyContext.lobbyOffers}
            ownedCompanies={companyLobbyContext.ownedCompanies}
          />
        </section>
      ) : null}

      <CongressDocketSection
        sectionId="house-docket"
        chamber="house"
        heading="House docket"
        subheading=""
        shellClassName="border-[var(--psc-border)] bg-white"
        headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        bills={houseBills}
        votesByBill={votesByBill}
        voterById={voterById}
        userId={user.id}
        roleKeys={roleKeys}
        viewerParty={viewerParty}
        viewerWhipByBillId={viewerWhipByBillId}
        userChambers={userChambers}
        isRunningMate={isRunningMate}
        canBreakSenateTie={canBreakSenateTie}
        suppressVoteForms={observeHouse}
        emptyLabel="No House bills in the active pipeline."
      />
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">House pipeline snapshot</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          This clarifies where bills are instead of implying they disappeared.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            Submitted: <strong className="text-[var(--psc-ink)]">{houseStatus.submitted}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            On docket: <strong className="text-[var(--psc-ink)]">{houseStatus.onDocket}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            Debate handoff: <strong className="text-[var(--psc-ink)]">{houseStatus.debate}</strong>
          </li>
          <li className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1">
            House floor: <strong className="text-[var(--psc-ink)]">{houseStatus.floor}</strong>
          </li>
        </ul>
      </section>
    </div>
  );
}
