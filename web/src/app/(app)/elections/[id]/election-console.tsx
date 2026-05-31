"use client";

import { useMemo, useState } from "react";
import { scoreGeneralElection } from "@/lib/election-engine";

type Election = {
  id: string;
  office: "house" | "senate" | "president";
  phase: "filing" | "primary" | "general" | "closed";
  state: string | null;
  district_code: string | null;
};

type Candidate = {
  id: string;
  party: "democrat" | "republican" | "independent";
  campaign_points_total: number;
  user_id: string | null;
};

export function ElectionConsole({
  election,
  candidates,
}: {
  election: Election;
  candidates: Candidate[];
}) {
  const [demoVotes, setDemoVotes] = useState<Record<string, number>>({});

  const modeled = useMemo(() => {
    if (!candidates.length) return null;
    const inputs = candidates.map((c) => ({
      id: c.id,
      party: c.party,
      campaignPoints: Number(c.campaign_points_total ?? 0),
    }));
    const tally: Record<string, number> = {};
    for (const c of candidates) tally[c.id] = demoVotes[c.id] ?? 0;
    return scoreGeneralElection(inputs, tally);
  }, [candidates, demoVotes]);

  const seatLabel =
    election.office === "president"
      ? "United States"
      : (election.district_code ?? election.state ?? "Seat");

  return (
    <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Election board
        </p>
        <h1 className="text-2xl font-semibold">
          {seatLabel} · {election.office}
        </h1>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Phase: <span className="font-mono">{election.phase}</span>. National and regional races
          use the same points-only campaign model.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Community vote simulator (no winner impact)</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Demo vote inputs are retained for UI previews only; winner logic is points-only.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {candidates.map((c) => (
            <label key={c.id} className="grid gap-1 text-xs font-semibold uppercase">
              Votes — {c.id.slice(0, 8)}…
              <input
                type="number"
                min={0}
                className="border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-sm normal-case"
                value={demoVotes[c.id] ?? 0}
                onChange={(e) =>
                  setDemoVotes((prev) => ({
                    ...prev,
                    [c.id]: Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Modeled totals</h2>
        {!modeled ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">Add candidates to preview.</p>
        ) : (
          <pre className="mt-3 overflow-x-auto border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-xs">
            {JSON.stringify(modeled, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
