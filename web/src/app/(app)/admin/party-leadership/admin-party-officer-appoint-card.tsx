"use client";

import { useEffect, useState, useTransition } from "react";
import {
  adminAppointPartyOfficer,
  searchPartyAffiliateProfiles,
  type PartyMemberSearchHit,
} from "@/app/actions/party";

const OFFICES = [
  { value: "chair", label: "Chair" },
  { value: "vice_chair", label: "Vice chair" },
  { value: "treasurer", label: "Treasurer" },
] as const;

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

function profileBits(p: PartyMemberSearchHit) {
  const bits = [p.home_district_code, p.residence_state].filter(Boolean);
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}

export function AdminPartyOfficerAppointCard({
  partyKey,
  partyLabel,
  canAppoint,
}: {
  partyKey: "democrat" | "republican";
  partyLabel: string;
  canAppoint: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PartyMemberSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<PartyMemberSearchHit | null>(null);
  const [office, setOffice] = useState<(typeof OFFICES)[number]["value"]>("chair");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const id = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        try {
          const r = await searchPartyAffiliateProfiles(partyKey, q);
          setHits(r);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 320);
    return () => window.clearTimeout(id);
  }, [query, partyKey]);

  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-base font-semibold text-[var(--psc-ink)]">{partyLabel}</h2>
      <p className="text-[11px] text-[var(--psc-muted)]">
        Search a party member, choose chair / vice chair / treasurer, then install them immediately (clears in-progress
        votes and candidacies for that office).
      </p>

      {!canAppoint ? (
        <p className="text-xs text-[var(--psc-muted)]">
          Appointments require full staff (<span className="font-mono">admin</span> or{" "}
          <span className="font-mono">staff_super</span>).
        </p>
      ) : (
        <>
          {msg ? (
            <p
              className={`rounded border px-2 py-1.5 text-[11px] ${
                msg.kind === "ok"
                  ? "border-emerald-800/40 bg-emerald-950/10 text-emerald-950"
                  : "border-rose-800/40 bg-rose-950/10 text-rose-950"
              }`}
            >
              {msg.text}
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
              Find member
            </label>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or Discord…"
              className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)]"
            />
            {searching ? <p className="text-[10px] text-[var(--psc-muted)]">Searching…</p> : null}
            {hits.length > 0 ? (
              <ul className="max-h-40 overflow-auto rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] text-xs">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPick(h);
                        setMsg(null);
                      }}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--psc-panel)] ${
                        pick?.id === h.id ? "bg-[var(--psc-panel)]" : ""
                      }`}
                    >
                      <span className="font-semibold text-[var(--psc-ink)]">{h.character_name}</span>
                      <span className="font-mono text-[10px] text-[var(--psc-muted)]">
                        {h.discord_username ?? "—"}
                        {profileBits(h)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--psc-border)] pt-3">
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
              Office
              <select
                value={office}
                onChange={(e) => setOffice(e.target.value as (typeof OFFICES)[number]["value"])}
                className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
              >
                {OFFICES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pending || !pick}
              className={btn}
              onClick={() => {
                if (!pick) return;
                setMsg(null);
                start(async () => {
                  try {
                    await adminAppointPartyOfficer({ partyKey, office, userId: pick.id });
                    setMsg({ kind: "ok", text: "Officer appointed." });
                  } catch (e) {
                    setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
                  }
                });
              }}
            >
              {pending ? "Saving…" : "Appoint officer"}
            </button>
          </div>
          {!pick ? <p className="text-[10px] text-[var(--psc-muted)]">Select someone from the search list first.</p> : null}
        </>
      )}
    </div>
  );
}
