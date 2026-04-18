"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { profilePath } from "@/components/profile-card";

export type AdminMemberRow = {
  id: string;
  character_name: string | null;
  discord_username: string | null;
  discord_user_id: string | null;
  office_role: string | null;
  party: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  created_at: string;
  grant_roles: string[];
};

function roleShort(key: string) {
  const full = POLITICAL_ROLE_LABELS[key];
  if (!full) return key;
  return full.length > 32 ? key.replace(/_/g, " ") : full;
}

function partyLabel(p: string | null | undefined) {
  if (p === "democrat") return "Dem.";
  if (p === "republican") return "Rep.";
  if (p === "independent") return "Ind.";
  return p ?? "—";
}

export function AdminMembersTable({ rows }: { rows: AdminMemberRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [
        r.character_name,
        r.discord_username,
        r.discord_user_id,
        r.party,
        r.residence_state,
        r.home_district_code,
        r.office_role,
        r.id,
        ...r.grant_roles,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, Discord, state, district, role…"
          className="min-w-0 flex-1 rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)] sm:max-w-md"
        />
        <span className="text-xs text-[var(--psc-muted)]">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--psc-border)]">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead className="border-b border-[var(--psc-border)] bg-[var(--psc-canvas)]/80 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            <tr>
              <th className="px-3 py-2">Character</th>
              <th className="px-3 py-2">Discord</th>
              <th className="px-3 py-2">Discord ID</th>
              <th className="px-3 py-2">Party</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">District</th>
              <th className="px-3 py-2">Legacy role</th>
              <th className="px-3 py-2">Role grants</th>
              <th className="px-3 py-2">Joined</th>
              <th className="px-3 py-2">Profile</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const href = profilePath(r.id);
              const grantsLine =
                r.grant_roles.length > 0
                  ? r.grant_roles.map((k) => roleShort(k)).join(" · ")
                  : "—";
              return (
                <tr key={r.id} className="border-b border-[var(--psc-border)]/60 odd:bg-[var(--psc-canvas)]/40">
                  <td className="px-3 py-2 font-medium text-[var(--psc-ink)]">
                    {r.character_name?.trim() || "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--psc-muted)]">{r.discord_username ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--psc-muted)]">
                    {r.discord_user_id ?? "—"}
                  </td>
                  <td className="px-3 py-2">{partyLabel(r.party)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.residence_state ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.home_district_code ?? "—"}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs" title={r.office_role ?? ""}>
                    {r.office_role ?? "—"}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-xs" title={grantsLine}>
                    {grantsLine}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--psc-muted)]">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    {href ? (
                      <Link href={href} className="font-semibold text-[var(--psc-accent)] underline">
                        View
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
