"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  advanceLegislativeRound,
  bribeNpc,
  nominateLeadership,
  proposeRoundBill,
  setActiveRoundBill,
  startLegislativeRound,
  whipNpc,
  type CampaignActionResult,
} from "@/app/actions/campaign-manager";
import type { LegislativeRoundBundle } from "@/lib/legislative-round-data";
import { phaseLabel } from "@/lib/legislative-round-data";

const LEADERSHIP_ROLES = [
  { key: "speaker", label: "Speaker" },
  { key: "house_majority_leader", label: "Majority Leader" },
  { key: "house_minority_leader", label: "Minority Leader" },
] as const;

export function WarRoomLegislativeRound({
  bundle,
  congressWindow,
  isStrategist,
}: {
  bundle: LegislativeRoundBundle;
  congressWindow: boolean;
  isStrategist: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CampaignActionResult | null>(null);
  const [nomSim, setNomSim] = useState("");
  const [nomRole, setNomRole] = useState("speaker");
  const [sponsorSim, setSponsorSim] = useState("");
  const [billTitle, setBillTitle] = useState("");
  const [billSummary, setBillSummary] = useState("");
  const [whipSim, setWhipSim] = useState("");
  const [whipVote, setWhipVote] = useState<"yea" | "nay">("yea");
  const [bribeSim, setBribeSim] = useState("");
  const [bribeAmount, setBribeAmount] = useState("500000");

  const { status, caucus, bills, leadership, humanParty } = bundle;
  const houseCaucus = useMemo(() => caucus.filter((c) => c.chamber === "house"), [caucus]);
  const myHouse = useMemo(() => houseCaucus.filter((c) => c.party === humanParty), [houseCaucus, humanParty]);
  const rivalHouse = useMemo(() => houseCaucus.filter((c) => c.party !== humanParty), [houseCaucus, humanParty]);
  const activeBill = bills.find((b) => b.id === status.activeBillId);

  function run(fn: () => Promise<CampaignActionResult>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  if (!congressWindow) {
    return (
      <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
        Congress minigame unlocks <strong>noon–midnight CST</strong>. Morning hours are for PAC / elections.
      </p>
    );
  }

  if (!isStrategist) {
    return <p className="text-sm text-[var(--psc-muted)]">Enroll as party strategist to run caucus rounds.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Legislative round</p>
          <p className="font-semibold text-[var(--psc-ink)]">{phaseLabel(status.roundPhase)}</p>
        </div>
        <div className="text-right text-sm tabular-nums">
          <p>Your capital: <strong>{status.myPoliticalCapital}</strong></p>
          <p className="text-xs text-[var(--psc-muted)]">Rival: {status.rivalPoliticalCapital}</p>
        </div>
      </div>

      {!status.roundId ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(startLegislativeRound)}
          className="rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Start tonight&apos;s legislative round
        </button>
      ) : (
        <>
          {status.roundPhase === "leadership" ? (
            <section className="rounded border border-[var(--psc-border)] p-4">
              <h4 className="font-semibold">Nominate leadership</h4>
              <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                Pick house caucus NPCs. Advance when ready — rival fills GOP slots automatically.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-[var(--psc-muted)]">
                  NPC
                  <select value={nomSim} onChange={(e) => setNomSim(e.target.value)} className="mt-1 block rounded border border-[var(--psc-border)] px-2 py-1.5 text-sm">
                    <option value="">Select…</option>
                    {myHouse.map((c) => (
                      <option key={c.simPoliticianId} value={c.simPoliticianId}>
                        {c.name} · cap {c.politicalCapital}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--psc-muted)]">
                  Role
                  <select value={nomRole} onChange={(e) => setNomRole(e.target.value)} className="mt-1 block rounded border border-[var(--psc-border)] px-2 py-1.5 text-sm">
                    {LEADERSHIP_ROLES.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={pending || !nomSim} onClick={() => run(() => nominateLeadership(nomSim, nomRole))} className="rounded border border-[var(--psc-border)] px-3 py-1.5 text-sm">
                  Nominate
                </button>
              </div>
              {leadership.length > 0 ? (
                <ul className="mt-3 text-xs text-[var(--psc-muted)]">
                  {leadership.map((l) => (
                    <li key={`${l.roleKey}-${l.simPoliticianId}`}>
                      {l.roleKey}: {l.name} ({l.party}){l.won ? " ✓" : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {status.roundPhase === "proposals" ? (
            <section className="rounded border border-[var(--psc-border)] p-4">
              <h4 className="font-semibold">Propose legislation</h4>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                <label className="text-xs text-[var(--psc-muted)]">
                  Sponsor (your caucus)
                  <select value={sponsorSim} onChange={(e) => setSponsorSim(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5 text-sm">
                    <option value="">Select…</option>
                    {myHouse.map((c) => (
                      <option key={c.simPoliticianId} value={c.simPoliticianId}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--psc-muted)]">
                  Title
                  <input value={billTitle} onChange={(e) => setBillTitle(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5 text-sm" />
                </label>
                <label className="col-span-full text-xs text-[var(--psc-muted)]">
                  Summary
                  <textarea value={billSummary} onChange={(e) => setBillSummary(e.target.value)} rows={3} className="mt-1 block w-full rounded border px-2 py-1.5 text-sm" />
                </label>
              </div>
              <button
                type="button"
                disabled={pending || status.humanProposalSubmitted}
                onClick={() => run(() => proposeRoundBill({ sponsorSimId: sponsorSim, title: billTitle, summary: billSummary }))}
                className="mt-3 rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {status.humanProposalSubmitted ? "Bill proposed" : "Propose bill"}
              </button>
              {bills.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold text-[var(--psc-muted)]">Round docket — select floor bill</p>
                  {bills.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setActiveRoundBill(b.id))}
                      className={`block w-full rounded border px-3 py-2 text-left text-sm ${status.activeBillId === b.id ? "border-[var(--psc-seal)] bg-[var(--psc-canvas)]" : "border-[var(--psc-border)]"}`}
                    >
                      <span className={b.party === humanParty ? "text-blue-700" : "text-red-700"}>{b.party === humanParty ? "Dem" : "GOP"}</span>
                      {" · "}{b.title} <span className="text-xs text-[var(--psc-muted)]">({b.sponsorName})</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {status.roundPhase === "house_vote" || status.roundPhase === "senate_vote" ? (
            <section className="rounded border border-[var(--psc-border)] p-4">
              <h4 className="font-semibold">{status.roundPhase === "house_vote" ? "House" : "Senate"} floor</h4>
              {activeBill ? (
                <p className="mt-1 text-sm">Floor bill: <strong>{activeBill.title}</strong> ({activeBill.party})</p>
              ) : null}
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Whip your caucus (3 capital) or bribe a rival (min $500K PAC, low loyalty targets).
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select value={whipSim} onChange={(e) => setWhipSim(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
                  <option value="">Whip target…</option>
                  {caucus.filter((c) => c.chamber === (status.roundPhase === "house_vote" ? "house" : "senate")).map((c) => (
                    <option key={c.simPoliticianId} value={c.simPoliticianId}>
                      {c.name} · {c.party} · cap {c.politicalCapital}
                    </option>
                  ))}
                </select>
                <select value={whipVote} onChange={(e) => setWhipVote(e.target.value as "yea" | "nay")} className="rounded border px-2 py-1.5 text-sm">
                  <option value="yea">Yea</option>
                  <option value="nay">Nay</option>
                </select>
                <button type="button" disabled={pending || !whipSim} onClick={() => run(() => whipNpc(whipSim, whipVote))} className="rounded border px-3 py-1.5 text-sm">
                  Whip
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <select value={bribeSim} onChange={(e) => setBribeSim(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
                  <option value="">Bribe rival…</option>
                  {rivalHouse.map((c) => (
                    <option key={c.simPoliticianId} value={c.simPoliticianId}>
                      {c.name} · loyalty {c.whipLoyalty}
                    </option>
                  ))}
                </select>
                <input type="number" step={250000} value={bribeAmount} onChange={(e) => setBribeAmount(e.target.value)} className="w-32 rounded border px-2 py-1.5 text-sm" />
                <button type="button" disabled={pending || !bribeSim} onClick={() => run(() => bribeNpc(bribeSim, "yea", Number(bribeAmount)))} className="rounded border px-3 py-1.5 text-sm">
                  Bribe for YEA
                </button>
              </div>
            </section>
          ) : null}

          {status.roundPhase === "presidential" ? (
            <p className="text-sm text-[var(--psc-muted)]">Ready for presidential sign/veto. Click advance to resolve.</p>
          ) : null}

          {status.roundPhase === "completed" && activeBill ? (
            <p className="text-sm">
              Result: {activeBill.signed ? "Signed into law" : activeBill.vetoed ? "Vetoed" : "Failed"} —
              House {activeBill.houseYeas}-{activeBill.houseNays}, Senate {activeBill.senateYeas}-{activeBill.senateNays}
            </p>
          ) : null}

          {status.roundPhase && status.roundPhase !== "completed" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(advanceLegislativeRound)}
              className="rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Advance phase →
            </button>
          ) : null}
        </>
      )}

      <section>
        <h4 className="text-sm font-semibold">War caucus roster</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {caucus.map((c) => (
            <div key={c.simPoliticianId} className="rounded border border-[var(--psc-border)] px-2 py-1.5 text-xs">
              <span className={c.party === humanParty ? "text-blue-700" : "text-red-700"}>{c.party === humanParty ? "D" : "R"}</span>
              {" "}{c.name} · {c.seatLabel} · cap {c.politicalCapital}
            </div>
          ))}
        </div>
      </section>

      {flash ? (
        <p className={`text-sm ${flash.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{flash.message}</p>
      ) : null}
    </div>
  );
}
