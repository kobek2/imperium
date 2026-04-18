import type { SimulationRpInstant, SimulationSettingsRow } from "@/lib/simulation-calendar";

export function SimulationRpBanner({
  settings,
  rp,
}: {
  settings: SimulationSettingsRow;
  rp: SimulationRpInstant;
}) {
  return (
    <aside className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 text-sm text-[var(--psc-ink)]">
      <p className="font-semibold">{rp.label}</p>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Pace is fixed at <strong>{settings.rp_months_per_real_day} simulation months</strong> per
        real Earth day, plus an admin offset of <strong>{settings.admin_rp_month_offset}</strong>{" "}
        months. Election phases still use real-world 24-hour windows once a race is opened.
      </p>
    </aside>
  );
}
