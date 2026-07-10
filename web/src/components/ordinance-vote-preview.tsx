"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchOrdinanceVotePreviewClient,
  resolveOrdinancePreviewScores,
  type OrdinanceVotePreviewResult,
} from "@/lib/council-ordinance-preview";
import type { OrdinanceStanceParams } from "@/lib/city-ordinance-param-score";
import { deriveCoalitionKeyForParametricIssue } from "@/lib/city-ordinance-param-score";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function OrdinanceVotePreviewPanel({
  category,
  issueKey,
  stanceKey,
  stanceParams,
  issueEconomicScore,
  issueSocialScore,
}: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: OrdinanceStanceParams | null;
  issueEconomicScore?: number;
  issueSocialScore?: number;
}) {
  const liveScores = useMemo(
    () =>
      resolveOrdinancePreviewScores({
        issueKey,
        stanceParams,
        issueEconomicScore,
        issueSocialScore,
      }),
    [issueKey, stanceParams, issueEconomicScore, issueSocialScore],
  );

  const debouncedEconomic = useDebouncedValue(liveScores?.economic, 280);
  const debouncedSocial = useDebouncedValue(liveScores?.social, 280);
  const debouncedStance = useDebouncedValue(stanceKey ?? "", 280);
  const debouncedCoalition = useDebouncedValue(
    liveScores ? deriveCoalitionKeyForParametricIssue(issueKey, liveScores.economic) ?? "" : "",
    280,
  );

  const [preview, setPreview] = useState<OrdinanceVotePreviewResult | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveKey = liveScores
    ? `${liveScores.economic}:${liveScores.social}:${deriveCoalitionKeyForParametricIssue(issueKey, liveScores.economic) ?? ""}`
    : `stance:${stanceKey ?? ""}`;
  const debouncedKey = liveScores
    ? `${debouncedEconomic}:${debouncedSocial}:${debouncedCoalition}`
    : `stance:${debouncedStance}`;
  const whipStale = settledKey !== null && settledKey !== debouncedKey;

  useEffect(() => {
    if (liveScores && (debouncedEconomic == null || debouncedSocial == null)) return;
    if (!liveScores && !debouncedStance) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchOrdinanceVotePreviewClient(
      liveScores
        ? {
            category,
            issueKey,
            stanceParams,
            issueEconomicScore: debouncedEconomic!,
            issueSocialScore: debouncedSocial!,
            stanceKey: debouncedCoalition || null,
          }
        : {
            category,
            issueKey,
            stanceKey: debouncedStance,
          },
    )
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError("Could not load whip preview.");
          setLoading(false);
          return;
        }
        setPreview(result);
        setSettledKey(debouncedKey);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load whip preview.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    category,
    issueKey,
    stanceParams,
    liveScores,
    debouncedEconomic,
    debouncedSocial,
    debouncedStance,
    debouncedCoalition,
    debouncedKey,
  ]);

  if (!liveScores && !stanceKey) return null;

  if (loading && !preview && !error) {
    return (
      <p className="text-xs text-[var(--psc-muted)]">Estimating NPC council votes…</p>
    );
  }

  if (error && !preview) {
    return <p className="text-xs text-red-700">{error}</p>;
  }

  const displayEconomic = liveScores?.economic ?? preview?.issueEconomicScore ?? 0;
  const displaySocial = liveScores?.social ?? preview?.issueSocialScore ?? 0;
  const yeas = preview?.yeas ?? 0;
  const nays = preview?.nays ?? 0;
  const passes = preview?.passes ?? false;
  const rollCall = preview?.rollCall ?? [];

  const tone = passes
    ? "border-green-400/60 bg-green-50/50"
    : "border-amber-400/60 bg-amber-50/50";

  return (
    <div className={`rounded border p-3 ${tone}`}>
      <p className="text-sm font-semibold text-[var(--psc-ink)]">
        Projected NPC vote: {whipStale ? "…" : `${yeas}–${nays}`}
        {!whipStale && passes ? (
          <span className="ml-2 text-green-800">· likely passes (needs 4 yeas)</span>
        ) : !whipStale ? (
          <span className="ml-2 text-amber-900">· likely fails without player yeas</span>
        ) : (
          <span className="ml-2 text-[var(--psc-muted)]">· updating whip count…</span>
        )}
      </p>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Scores fed to whip model: economic{" "}
        <span className="font-mono font-semibold text-[var(--psc-ink)]">{displayEconomic}</span>
        , social{" "}
        <span className="font-mono font-semibold text-[var(--psc-ink)]">{displaySocial}</span>
        {liveKey !== debouncedKey ? (
          <span className="ml-1 text-[10px]">(whip recalculating)</span>
        ) : null}
      </p>
      {rollCall.length > 0 ? (
        <ul
          className={`mt-2 grid gap-1 text-xs sm:grid-cols-2 ${
            whipStale ? "opacity-50" : ""
          }`}
        >
          {rollCall.map((row) => (
            <li key={row.wardCode} className="flex justify-between gap-2 text-[var(--psc-ink)]">
              <span>
                {row.wardCode} · {row.voterLabel}
              </span>
              <span
                className={`font-semibold uppercase ${
                  row.vote === "yea" ? "text-green-800" : "text-red-800"
                }`}
              >
                {row.vote}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-[10px] text-[var(--psc-muted)]">
        Assumes NPC seats only. Player-held wards override these lines when they vote.
      </p>
    </div>
  );
}
