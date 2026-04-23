import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { tryCreateClient } from "@/lib/supabase/server";
import { PartyDirectoryCard } from "./party-directory-card";

const PARTIES = [
  { key: "democrat" as const, name: "Democratic Party" },
  { key: "republican" as const, name: "Republican Party" },
];

export default async function PartiesHubPage() {
  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgs } = await supabase.from("party_organizations").select("party_key, treasury_balance");

  const { data: counts } = await supabase.from("profiles").select("party");
  const countByParty: Record<string, number> = { democrat: 0, republican: 0, independent: 0 };
  for (const row of counts ?? []) {
    const p = row.party as string | null;
    if (p && p in countByParty) countByParty[p] += 1;
  }

  const treasury = new Map((orgs ?? []).map((o) => [o.party_key as string, Number(o.treasury_balance)]));

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Party directory</h1>
      </header>

      <ul className="grid gap-6 md:grid-cols-2">
        {PARTIES.map((p) => (
          <PartyDirectoryCard
            key={p.key}
            partyKey={p.key}
            title={p.name}
            treasury={treasury.get(p.key) ?? 0}
            members={countByParty[p.key] ?? 0}
          />
        ))}
      </ul>

      <section className="rounded-2xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Independents</h2>
            <p className="mt-1 max-w-xl text-sm text-[var(--psc-muted)]">
              Not a party organization in this directory.{" "}
              <span className="font-mono tabular-nums text-[var(--psc-ink)]">{countByParty.independent ?? 0}</span>{" "}
              registered independent{countByParty.independent === 1 ? "" : "s"}.
            </p>
          </div>
          <NavRouteButton href="/economy" className="shrink-0 px-4 py-2.5">
            Economy
          </NavRouteButton>
        </div>
      </section>
    </div>
  );
}
