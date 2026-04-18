import { redirect } from "next/navigation";
import { getIsAdmin } from "@/lib/is-admin";

/**
 * Past results live under Admin → Elections → Archive. Non-admins are sent back to active races.
 */
export default async function ElectionsArchivePage() {
  if (await getIsAdmin()) {
    redirect("/admin/elections?tab=archive");
  }
  redirect("/elections");
}
