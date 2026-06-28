"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bootCampaignManagerSeason } from "@/app/actions/campaign-manager";
import { RIVAL_DIFFICULTY_LABELS, type RivalDifficulty } from "@/lib/campaign-manager-config";

export function AdminBootCampaignSeasonButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [difficulty, setDifficulty] = useState<RivalDifficulty>("normal");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="rounded border border-[var(--psc-seal)]/30 bg-[var(--psc-canvas)]/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-seal)]">
        Campaign Manager season
      </p>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Boot Season 0: human Democrat vs Republican AI rival, President + 10 House + 6 Senate. Opens filing windows
        and enables the War Room at <code className="font-mono">/campaign</code>.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-[var(--psc-muted)]">
          Rival difficulty
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as RivalDifficulty)}
            className="mt-0.5 block rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1 text-xs"
          >
            {(Object.keys(RIVAL_DIFFICULTY_LABELS) as RivalDifficulty[]).map((key) => (
              <option key={key} value={key}>
                {RIVAL_DIFFICULTY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMessage(null);
              const r = await bootCampaignManagerSeason(difficulty);
              setMessage(r.message);
              if (r.ok) router.refresh();
            })
          }
          className="rounded border border-[var(--psc-seal)] bg-[var(--psc-seal)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Booting…" : "Boot Campaign Manager season"}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-[11px] text-[var(--psc-muted)]" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
