"use client";

import { useEffect, useState, useTransition } from "react";
import {
  appointChamberLeadershipForProfile,
  appointHouseSeatForProfile,
  appointPresidentForProfile,
  appointSenateSeatForProfile,
  appointVicePresidentForProfile,
  searchProfilesForAppointment,
  type AppointmentProfileHit,
} from "@/app/actions/congress-appointments";
import { SIM_REGIONS } from "@/lib/regions";
import type { ChamberMemberOption, ExecutiveOfficerOption } from "@/lib/admin-congress-appointment-queries";
import { leadershipRoleLabel, leadershipRolesForChamber, type LeadershipRole } from "@/lib/leadership";

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

function profileSummary(p: AppointmentProfileHit) {
  const bits = [p.home_district_code, p.residence_state].filter(Boolean);
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}

function officerLabel(o: ExecutiveOfficerOption | null) {
  if (!o) return "— vacant —";
  const bits = [o.home_district_code, o.residence_state].filter(Boolean);
  return bits.length ? `${o.character_name} (${bits.join(" · ")})` : o.character_name;
}

export function AdminCongressAppointmentsClient({
  canAppoint,
  houseMembers,
  senateMembers,
  president,
  vicePresident,
}: {
  canAppoint: boolean;
  houseMembers: ChamberMemberOption[];
  senateMembers: ChamberMemberOption[];
  president: ExecutiveOfficerOption | null;
  vicePresident: ExecutiveOfficerOption | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AppointmentProfileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [seatPick, setSeatPick] = useState<AppointmentProfileHit | null>(null);
  const [senateState, setSenateState] = useState("");
  const [senateClass, setSenateClass] = useState<1 | 2 | 3>(1);
  const [houseLeadUser, setHouseLeadUser] = useState("");
  const [houseLeadRole, setHouseLeadRole] = useState<LeadershipRole | "">("");
  const [senateLeadUser, setSenateLeadUser] = useState("");
  const [senateLeadRole, setSenateLeadRole] = useState<LeadershipRole | "">("");

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
          const r = await searchProfilesForAppointment(q);
          setHits(r);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 320);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (seatPick?.residence_state) {
      setSenateState(String(seatPick.residence_state).trim().toUpperCase());
    }
  }, [seatPick?.id, seatPick?.residence_state]);

  const run = (fn: () => Promise<void>) => {
    setMsg(null);
    start(async () => {
      try {
        await fn();
        setMsg({ kind: "ok", text: "Saved." });
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  if (!canAppoint) {
    return (
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Appointments</h3>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Seat, executive, and chamber-leadership appointments require full staff (<span className="font-mono">admin</span>{" "}
          or <span className="font-mono">staff_super</span>) so database role grants can be updated.
        </p>
      </section>
    );
  }

  const houseLeadershipRoles = leadershipRolesForChamber("house");
  const senateLeadershipRoles = leadershipRolesForChamber("senate");

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Appointments</h3>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Search a character, then seat them in the House (their home district) or Senate (must match residence state and
        class), appoint President or Vice President, or assign chamber leadership to an incumbent member.
      </p>

      {msg ? (
        <p
          className={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
            msg.kind === "ok"
              ? "border-emerald-800/40 bg-emerald-950/10 text-emerald-950"
              : "border-rose-800/40 bg-rose-950/10 text-rose-950"
          }`}
        >
          {msg.text}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
          Find character
        </label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or Discord username…"
          className="w-full max-w-md rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)]"
        />
        {searching ? <p className="text-[10px] text-[var(--psc-muted)]">Searching…</p> : null}
        {hits.length > 0 ? (
          <ul className="max-h-44 max-w-md overflow-auto rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] text-xs">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSeatPick(h);
                    setMsg(null);
                  }}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--psc-panel)] ${
                    seatPick?.id === h.id ? "bg-[var(--psc-panel)]" : ""
                  }`}
                >
                  <span className="font-semibold text-[var(--psc-ink)]">{h.character_name}</span>
                  <span className="font-mono text-[10px] text-[var(--psc-muted)]">
                    {h.discord_username ?? "—"}
                    {profileSummary(h)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-6 space-y-3 border-t border-[var(--psc-border)] pt-6">
        <h4 className="text-xs font-semibold text-[var(--psc-ink)]">Executive branch</h4>
        <dl className="grid gap-1 text-[11px] text-[var(--psc-muted)] sm:grid-cols-2">
          <div>
            <dt className="font-semibold uppercase tracking-wide text-[10px]">President</dt>
            <dd className="text-[var(--psc-ink)]">{officerLabel(president)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-[10px]">Vice President</dt>
            <dd className="text-[var(--psc-ink)]">{officerLabel(vicePresident)}</dd>
          </div>
        </dl>
        {!seatPick ? (
          <p className="text-[11px] text-[var(--psc-muted)]">Pick someone from search to appoint.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={btn}
              onClick={() => run(() => appointPresidentForProfile(seatPick.id))}
            >
              Appoint President
            </button>
            <button
              type="button"
              disabled={pending}
              className={btn}
              onClick={() => run(() => appointVicePresidentForProfile(seatPick.id))}
            >
              Appoint Vice President
            </button>
          </div>
        )}
        <p className="text-[10px] text-[var(--psc-muted)]">
          Replaces the current officeholder and updates Oval Office / directory access. Does not change a closed
          presidential race winner field.
        </p>
      </div>

      <div className="mt-6 grid gap-6 border-t border-[var(--psc-border)] pt-6 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold text-[var(--psc-ink)]">Congressional seats</h4>
          {!seatPick ? (
            <p className="mt-2 text-[11px] text-[var(--psc-muted)]">Pick someone from search results first.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-[var(--psc-ink)]">
                <span className="font-semibold">{seatPick.character_name}</span>
                {profileSummary(seatPick)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending || !seatPick.home_district_code?.trim()}
                  className={btn}
                  onClick={() => run(() => appointHouseSeatForProfile(seatPick.id))}
                >
                  Appoint House
                </button>
              </div>
              {!seatPick.home_district_code?.trim() ? (
                <p className="text-[10px] text-amber-950">Set home district on their Character page first.</p>
              ) : null}

              <div className="flex flex-wrap items-end gap-2 border-t border-[var(--psc-border)] pt-3">
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                  Region
                  <select
                    value={senateState}
                    onChange={(e) => setSenateState(e.target.value)}
                    className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                  >
                    <option value="">—</option>
                    {SIM_REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.code} — {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                  Seat
                  <select
                    value={senateClass}
                    onChange={(e) => setSenateClass(Number(e.target.value) as 1 | 2 | 3)}
                    className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={pending || !["NE", "SO", "WE"].includes(senateState)}
                  className={btn}
                  onClick={() => run(() => appointSenateSeatForProfile(seatPick.id, senateState, senateClass))}
                >
                  Appoint Senate
                </button>
              </div>
              <p className="text-[10px] text-[var(--psc-muted)]">
                Their <strong className="text-[var(--psc-ink)]">residence state</strong> must match the seat state.
                Prior holder for that state/class (last closed race winner) is vacated automatically.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="text-xs font-semibold text-[var(--psc-ink)]">House leadership</h4>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                Member
                <select
                  value={houseLeadUser}
                  onChange={(e) => setHouseLeadUser(e.target.value)}
                  className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                >
                  <option value="">—</option>
                  {houseMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.character_name}
                      {m.home_district_code ? ` (${m.home_district_code})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                Role
                <select
                  value={houseLeadRole}
                  onChange={(e) => setHouseLeadRole(e.target.value as LeadershipRole)}
                  className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                >
                  <option value="">—</option>
                  {houseLeadershipRoles.map((r) => (
                    <option key={r} value={r}>
                      {leadershipRoleLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending || !houseLeadUser || !houseLeadRole}
                className={btn}
                onClick={() => run(() => appointChamberLeadershipForProfile(houseLeadUser, houseLeadRole))}
              >
                Appoint
              </button>
            </div>
            {!houseMembers.length ? (
              <p className="mt-1 text-[10px] text-[var(--psc-muted)]">No representatives found in grants/office_role.</p>
            ) : null}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-[var(--psc-ink)]">Senate leadership</h4>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                Member
                <select
                  value={senateLeadUser}
                  onChange={(e) => setSenateLeadUser(e.target.value)}
                  className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                >
                  <option value="">—</option>
                  {senateMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.character_name}
                      {m.residence_state ? ` (${m.residence_state})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                Role
                <select
                  value={senateLeadRole}
                  onChange={(e) => setSenateLeadRole(e.target.value as LeadershipRole)}
                  className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-xs font-normal normal-case text-[var(--psc-ink)]"
                >
                  <option value="">—</option>
                  {senateLeadershipRoles.map((r) => (
                    <option key={r} value={r}>
                      {leadershipRoleLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending || !senateLeadUser || !senateLeadRole}
                className={btn}
                onClick={() => run(() => appointChamberLeadershipForProfile(senateLeadUser, senateLeadRole))}
              >
                Appoint
              </button>
            </div>
            {!senateMembers.length ? (
              <p className="mt-1 text-[10px] text-[var(--psc-muted)]">No senators found in grants/office_role.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
