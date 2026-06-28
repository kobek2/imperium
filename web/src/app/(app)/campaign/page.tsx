import { redirect } from "next/navigation";
import { CampaignWarRoom } from "@/components/campaign-war-room";
import { loadCampaignWarRoomHub } from "@/lib/campaign-manager-data";
import { getIsAdmin } from "@/lib/is-admin";
import { getServerAuth } from "@/lib/supabase/server";

export default async function CampaignPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: profile }, isAdmin] = await Promise.all([
    supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    getIsAdmin(),
  ]);

  const data = await loadCampaignWarRoomHub(supabase, user.id);
  const userParty = profile?.party ? String(profile.party).trim().toLowerCase() : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">War Room</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
          Central command for Campaign Manager season. Morning CST: elections and PAC warfare. Afternoon/evening CST:
          Congress and legislation. The Republican machine watches your moves and counter-spends.
        </p>
      </header>

      <CampaignWarRoom data={data} isAdmin={isAdmin} userParty={userParty} />
    </div>
  );
}
