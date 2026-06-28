"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fileStrategistBill, type CampaignActionResult } from "@/app/actions/campaign-manager";
import type { StrategistBillRow } from "@/lib/campaign-manager-data";

export function WarRoomCongressPanel({
  bills,
  congressWindow,
  isStrategist,
}: {
  bills: StrategistBillRow[];
  congressWindow: boolean;
  isStrategist: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CampaignActionResult | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [chamber, setChamber] = useState<"house" | "senate">("house");

  function run(fn: () => Promise<CampaignActionResult>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!congressWindow ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
          Legislation unlocks during the <strong>Congress cycle</strong> (noon–midnight CST). During the morning
          election window, focus on PAC spending and races.
        </p>
      ) : null}

      {isStrategist ? (
        <div className="rounded border border-[var(--psc-border)] p-4">
          <h4 className="font-semibold">File caucus legislation</h4>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
            Bills enter the floor under an NPC sponsor name. The rival will file GOP measures the same window.
          </p>
          <div className="mt-3 space-y-3">
            <label className="block text-xs text-[var(--psc-muted)]">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
                placeholder="e.g. Clean Energy Jobs Act"
              />
            </label>
            <label className="block text-xs text-[var(--psc-muted)]">
              Chamber
              <select
                value={chamber}
                onChange={(e) => setChamber(e.target.value as "house" | "senate")}
                className="mt-1 block w-full max-w-xs rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
              >
                <option value="house">House</option>
                <option value="senate">Senate</option>
              </select>
            </label>
            <label className="block text-xs text-[var(--psc-muted)]">
              Bill text
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
                placeholder="Summary of provisions…"
              />
            </label>
            <button
              type="button"
              disabled={pending || !congressWindow}
              onClick={() => run(() => fileStrategistBill({ title, contentMd: body, chamber }))}
              className="rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              File to floor
            </button>
          </div>
          {flash ? (
            <p className={`mt-2 text-sm ${flash.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
              {flash.message}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">Enroll as strategist to draft legislation.</p>
      )}

      <div>
        <h4 className="font-semibold">War room docket</h4>
        {bills.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">No strategist-filed bills yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--psc-border)]/60 text-sm">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <Link href={`/bill/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                    {b.title}
                  </Link>
                  {" · "}
                  <span className={b.isRival ? "text-red-700" : "text-blue-700"}>
                    {b.isRival ? "GOP" : "Dem"} {b.chamber}
                  </span>
                  {b.sponsorLabel ? ` · ${b.sponsorLabel}` : ""}
                </span>
                <span className="text-xs text-[var(--psc-muted)]">{b.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
