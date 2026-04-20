import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { EconomyDashboard } from "./economy-dashboard";

export default async function EconomyPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase to use the economy.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: wallet }, { data: pac }, { data: invRows }, { data: ledger }, { data: myCands }, { data: meProf }] =
    await Promise.all([
      supabase.from("economy_wallets").select("balance, last_collected_at").eq("user_id", user.id).maybeSingle(),
      supabase.from("economy_pacs").select("level").eq("user_id", user.id).maybeSingle(),
      supabase.from("economy_inventory").select("sku, quantity").eq("user_id", user.id),
      supabase
        .from("economy_ledger")
        .select("id, wallet_user_id, delta, kind, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase.from("election_candidates").select("id, election_id").eq("user_id", user.id),
      supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    ]);

  const aff = String((meProf as { party?: string } | null)?.party ?? "").trim();
  const treasuryPartyKey = aff === "democrat" || aff === "republican" ? aff : null;

  const inventory =
    (invRows ?? []).find((r) => (r as { sku: string }).sku === "campaign_ad") ?? null;

  const candList = (myCands ?? []) as Array<{ id: string; election_id: string }>;
  const electionIds = [...new Set(candList.map((c) => c.election_id))];
  const { data: electionRows } =
    electionIds.length > 0
      ? await supabase
          .from("elections")
          .select("id, office, phase, district_code, state, leadership_role")
          .in("id", electionIds)
      : { data: [] as const };

  const electionById = new Map((electionRows ?? []).map((e) => [e.id as string, e]));

  const myCandidacies = candList
    .map((c) => {
      const e = electionById.get(c.election_id) as
        | {
            office: string;
            phase: string;
            district_code: string | null;
            state: string | null;
            leadership_role: string | null;
          }
        | undefined;
      if (!e || e.phase === "closed") return null;
      const slot =
        e.leadership_role
          ? `Leadership · ${e.leadership_role}`
          : e.office === "house"
            ? `House ${e.district_code ?? ""}`
            : e.office === "senate"
              ? `Senate ${e.state ?? ""}`
              : "President";
      return {
        candidate_id: c.id,
        election_id: c.election_id,
        label: `${slot} · ${e.phase}`,
      };
    })
    .filter(Boolean) as Array<{ candidate_id: string; election_id: string; label: string }>;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy</h1>
        </div>
        <Link
          href="/economy/leaderboard"
          className="text-sm font-semibold text-[var(--psc-accent)] underline underline-offset-2"
        >
          Leaderboard
        </Link>
      </header>

      <EconomyDashboard
        wallet={wallet as { balance: number; last_collected_at: string } | null}
        pac={pac as { level: number } | null}
        inventory={inventory as { sku: string; quantity: number } | null}
        recentLedger={(ledger ?? []) as never}
        myCandidacies={myCandidacies}
        viewerId={user.id}
        treasuryPartyKey={treasuryPartyKey}
      />
    </div>
  );
}
