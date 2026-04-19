import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";

const PARTIES = [
  { key: "democrat", name: "Democratic Party" },
  { key: "republican", name: "Republican Party" },
] as const;

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
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Party directory</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--psc-muted)]">
          Each party has a pooled treasury (deposit from the Economy page). Members elect a chair, vice chair, and
          treasurer — declare candidacy, vote, then an admin finalizes the tally to install officers.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {PARTIES.map((p) => (
          <li key={p.key} className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">{p.name}</h2>
            <p className="mt-2 font-mono text-sm text-[var(--psc-muted)]">
              Treasury:{" "}
              <span className="text-[var(--psc-ink)]">
                ${(treasury.get(p.key) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Members: {countByParty[p.key] ?? 0}</p>
            <Link
              href={`/parties/${p.key}`}
              className="mt-4 inline-block text-sm font-semibold text-[var(--psc-accent)] underline"
            >
              Open party room →
            </Link>
          </li>
        ))}
      </ul>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 text-sm text-[var(--psc-muted)]">
        <strong className="text-[var(--psc-ink)]">Independents</strong> do not use a party treasury or officer slate
        here ({countByParty.independent ?? 0} registered). Use personal transfers under Economy to coordinate
        informally.
      </section>
    </div>
  );
}
