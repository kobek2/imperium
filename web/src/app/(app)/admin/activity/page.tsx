import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPanelPage } from "@/lib/staff-access";
import { loadAdminServerActivitySnapshot } from "@/lib/admin-server-activity";
import { ServerActivityDashboard } from "./server-activity-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminServerActivityPage() {
  await requireStaffPanelPage();
  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/admin");

  const snapshot = await loadAdminServerActivitySnapshot(supabase);

  return <ServerActivityDashboard snapshot={snapshot} />;
}
