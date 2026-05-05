import type { BillChamber } from "@/lib/bill-types";

/** Chamber that receives a bill after the originating chamber passes its floor vote. */
export function receivingChamberForOrigination(originating: BillChamber): BillChamber {
  return originating === "house" ? "senate" : "house";
}

/** Which chamber's leadership may edit bill text (hopper, docket, debate phases). */
export function leadershipEditChamberForBillStatus(
  status: string,
  originating_chamber: BillChamber,
): BillChamber | null {
  if (status === "submitted" || status === "leadership_review" || status === "on_docket") return originating_chamber;
  if (status === "debate") return originating_chamber;
  if (status === "other_chamber_debate") return receivingChamberForOrigination(originating_chamber);
  return null;
}

/** Whether amendments may be proposed for this bill status. */
export function isDebateStatus(status: string): boolean {
  return status === "debate" || status === "other_chamber_debate";
}

/** Leadership hopper review targets the originating chamber. */
export function hopperChamber(originating_chamber: BillChamber): BillChamber {
  return originating_chamber;
}
