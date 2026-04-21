import { redirect } from "next/navigation";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";

/**
 * Past results live under Admin → Elections → Archive. Others are sent back to active races.
 */
export default async function ElectionsArchivePage() {
  if (await getStaffMayAccessElectionsConsole()) {
    redirect("/admin/elections?tab=archive");
  }
  redirect("/elections");
}
