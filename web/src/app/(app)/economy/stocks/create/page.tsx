import { redirect } from "next/navigation";
import { StockMarketNav } from "@/components/stock-market-nav";
import { CompanyCreateWizard } from "@/components/company-create-wizard";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyCreatePage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Incorporate a company</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Pay the founding fee, file your IPO, and list shares on the public market.
        </p>
      </header>
      <StockMarketNav active="create" />
      <CompanyCreateWizard />
    </div>
  );
}
