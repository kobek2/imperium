"use client";

import { useMemo, useState } from "react";
import { scoreGeneralElection, scorePresidentialElection } from "@/lib/election-engine";
import type { UsRegion } from "@/lib/regions";

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
  user_id: string;
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
    if (election.office === "president") {
      const states = ["CA", "TX", "OH"];
      const perState = states.map((state) => ({
        state,
        candidates: inputs.map((row) => ({
          ...row,
          campaignPoints: row.campaignPoints / states.length,
        })),
        votesByCandidate: {},
      }));
      const regions: { region: UsRegion; votesByCandidate: Record<string, number> }[] =
        [
          { region: "west", votesByCandidate: {} },
          { region: "south", votesByCandidate: {} },
          { region: "northeast_midwest", votesByCandidate: {} },
        ];
      for (const c of candidates) {
        regions[0].votesByCandidate[c.id] = demoVotes[c.id] ?? 0;
      }
      return scorePresidentialElection(perState, regions);
    }
    const tally: Record<string, number> = {};
    for (const c of candidates) tally[c.id] = demoVotes[c.id] ?? 0;
    return scoreGeneralElection(inputs, tally);
  }, [candidates, demoVotes, election.office]);

  return (
    <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Election board
        </p>
        <h1 className="text-2xl font-semibold">
          {election.district_code ?? election.state ?? "United States"} · {election.office}
        </h1>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Phase: <span className="font-mono">{election.phase}</span>. Wire Discord party
          roles to gate primaries. Use Supabase columns to store filing clocks; this
          panel previews the math layer only.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Community vote simulator (40%)</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Enter demo vote counts per candidate id to see normalized totals merge with
          campaign scores.
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
        ) : election.office === "president" ? (
          <pre className="mt-3 overflow-x-auto border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-xs">
            {JSON.stringify(modeled, null, 2)}
          </pre>
        ) : (
          <pre className="mt-3 overflow-x-auto border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-xs">
            {JSON.stringify(modeled, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
