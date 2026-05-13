export type TreasuryLedgerFeedRow = {
  id: string;
  created_at: string;
  wallet_user_id: string;
  delta: number;
  kind: string;
  detail: Record<string, unknown> | null;
};

function profileLabel(
  map: ReadonlyMap<string, { character_name: string | null; discord_username: string | null }>,
  id: string,
): string {
  const p = map.get(id);
  const cn = p?.character_name?.trim();
  if (cn) return cn;
  if (p?.discord_username) return p.discord_username;
  return `${id.slice(0, 8)}…`;
}

function fmtUsd(n: number) {
  return `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describeRow(
  row: TreasuryLedgerFeedRow,
  nameById: ReadonlyMap<string, { character_name: string | null; discord_username: string | null }>,
): { directionLabel: string; detailLine: string | null } {
  const member = profileLabel(nameById, row.wallet_user_id);
  const d = row.detail ?? {};
  const fromOfficer = typeof d.from_officer === "string" && d.from_officer.length > 0 ? d.from_officer : null;

  if (row.kind === "party_treasury_in") {
    const by =
      fromOfficer && fromOfficer !== row.wallet_user_id
        ? `Authorized by ${profileLabel(nameById, fromOfficer)}`
        : null;
    return {
      directionLabel: "Treasury → member",
      detailLine: `${member} received ${fmtUsd(row.delta)}${by ? ` · ${by}` : ""}`,
    };
  }
  if (row.kind === "party_collect_levy") {
    return {
      directionLabel: "Member → treasury (salary levy)",
      detailLine: `${member} withheld ${fmtUsd(row.delta)} on collect`,
    };
  }
  if (row.kind === "party_deposit") {
    return {
      directionLabel: "Member → treasury (voluntary)",
      detailLine: `${member} donated ${fmtUsd(row.delta)}`,
    };
  }
  return { directionLabel: row.kind, detailLine: member };
}

export function PartyLeadershipTreasuryFeed({
  rows,
  nameById,
}: {
  rows: TreasuryLedgerFeedRow[];
  nameById: ReadonlyMap<string, { character_name: string | null; discord_username: string | null }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--psc-muted)]">
        No treasury movements recorded in the ledger for this party yet (transfers, salary levies, or voluntary deposits).
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] text-sm">
      {rows.map((row) => {
        const { directionLabel, detailLine } = describeRow(row, nameById);
        return (
          <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--psc-ink)]">{directionLabel}</div>
              {detailLine ? <div className="mt-0.5 text-xs text-[var(--psc-muted)]">{detailLine}</div> : null}
            </div>
            <time
              className="shrink-0 whitespace-nowrap font-mono text-xs text-[var(--psc-muted)]"
              dateTime={row.created_at}
            >
              {new Date(row.created_at).toLocaleString()}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
