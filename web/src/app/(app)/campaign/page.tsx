import { redirect } from "next/navigation";

/** War Room / Campaign Manager removed — send players to elections. */
export default function CampaignPage() {
  redirect("/elections");
}
