import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { PacDashboard } from "@/components/pac-dashboard";
import { getServerAuth } from "@/lib/supabase/server";
import { loadMyPacDisclosures, loadPacContributionTargets } from "@/lib/business-data";
import type { PacStatus } from "@/components/pac-dashboard";

export default async function EconomyPacPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: activeFy }, { data: pacRpc }] = await Promise.all([
    supabase.from("rp_fiscal_years").select("economy_activity_frozen").eq("status", "active").maybeSingle(),
    supabase.rpc("pac_my_status"),
  ]);

  const [contributionTargets, disclosures] = await Promise.all([
    loadPacContributionTargets(supabase, user.id),
    loadMyPacDisclosures(supabase, user.id),
  ]);
  const pacStatus = ((pacRpc as PacStatus | null) ?? { has_pac: false }) as PacStatus;
  const economyFrozen = Boolean((activeFy as { economy_activity_frozen?: boolean } | null)?.economy_activity_frozen);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">PAC</h1>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Treasury for disclosed general-election contributions. Campaign ads on your own races still run from your wallet on{" "}
            <NavRouteButton href="/economy" className="inline-flex px-1 py-0 text-xs">
              Economy
            </NavRouteButton>{" "}
            or an election page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavRouteButton href="/elections">Elections</NavRouteButton>
          <NavRouteButton href="/economy/stocks">Stocks</NavRouteButton>
          <NavRouteButton href="/economy">Economy</NavRouteButton>
        </div>
      </header>
      <PacDashboard
        pacStatus={pacStatus}
        contributionTargets={contributionTargets}
        economyFrozen={economyFrozen}
      />
      {disclosures.length > 0 ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">Your disclosed contributions</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">Public filings from this PAC treasury.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {disclosures.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--psc-border)]/60 pb-2 last:border-0">
                <span className="font-medium text-[var(--psc-ink)]">{r.label}</span>
                <span className="text-[var(--psc-muted)]">
                  ${r.amount.toLocaleString()} → +{r.campaignPoints} pts ·{" "}
                  {new Date(r.disclosedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
