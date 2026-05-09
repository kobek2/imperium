import type { BillFloorYeaNayTally } from "@/lib/bill-types";

/** User-facing status for bills (pipeline uses more granular DB enum values). */
export function billStatusDisplay(
  status: string,
  opts?: { originatingChamber?: "house" | "senate" | null },
): string {
  const receiving =
    opts?.originatingChamber === "house"
      ? "Senate"
      : opts?.originatingChamber === "senate"
        ? "House"
        : "Receiving chamber";
  switch (status) {
    case "submitted":
      return "Submitted — leadership review";
    case "leadership_review":
      return "Leadership review (timed hopper)";
    case "rejected":
      return "Rejected by leadership";
    case "expired":
      return "Expired (Congress reset)";
    case "debate":
      return "Debate — floor vote not open";
    case "other_chamber_review":
      return `${receiving} — leadership review`;
    case "other_chamber_debate":
      return `${receiving} — debate`;
    case "on_docket":
      return "On docket — voting not open";
    case "house_floor":
      return "House floor — in voting";
    case "senate_floor":
      return "Senate floor — in voting";
    case "house_committee":
      return "House committee";
    case "senate_committee":
      return "Senate committee";
    case "passed_congress":
      return "Passed Congress";
    case "oval":
      return "President’s desk";
    case "law":
      return "Passed (signed into law)";
    case "vetoed":
      return "Failed (vetoed)";
    case "dead":
      return "Closed";
    case "failed":
      return "Did not advance";
    default:
      return status.replaceAll("_", " ");
  }
}

/**
 * Plain-language reason a bill left the active calendar (for terminal statuses).
 * Uses yea/nay totals when present to separate floor defeat from receiving-chamber leadership rejection.
 */
export function billTerminalOutcomeExplanation(
  status: string,
  opts: {
    originatingChamber: "house" | "senate";
    floorTally?: BillFloorYeaNayTally | null;
    /** Set when this bill is (or was) a Senate confirmation nomination. */
    isAppointmentConfirmationBill?: boolean;
  },
): string | null {
  const orig = opts.originatingChamber;
  const t = opts.floorTally ?? { house_yea: 0, house_nay: 0, senate_yea: 0, senate_nay: 0 };
  const hy = t.house_yea;
  const hn = t.house_nay;
  const sy = t.senate_yea;
  const sn = t.senate_nay;
  const houseCast = hy + hn > 0;
  const senateCast = sy + sn > 0;
  const housePassed = hy > hn;
  const senatePassed = sy > sn;

  switch (status) {
    case "rejected":
      return "Leadership in the originating chamber rejected this bill before debate.";
    case "expired":
      return "This bill timed out or was cleared during a Congress reset.";
    case "vetoed":
      return "The President vetoed this bill; it did not become law.";
    case "dead":
      if (opts.isAppointmentConfirmationBill) {
        return "Confirmation vote failed — the nomination was not confirmed.";
      }
      return "This bill is off the active calendar (legacy status, staff closure, or an older rejection path).";
    case "failed":
      if (orig === "house") {
        if (houseCast && !housePassed && !senateCast) {
          return `House floor did not pass (yea–nay ${hy}–${hn}).`;
        }
        if (housePassed && !senateCast) {
          return `Senate leadership rejected this bill before a Senate floor vote (House had passed ${hy}–${hn}).`;
        }
        if (housePassed && senateCast && !senatePassed) {
          return `Senate floor did not pass (yea–nay ${sy}–${sn}).`;
        }
        if (!houseCast && !senateCast) {
          return "Recorded as failed with no yea/nay votes — it may have been closed by maintenance or staff.";
        }
        if (!housePassed && senateCast) {
          return `House did not pass (${hy}–${hn}); Senate also recorded ${sy}–${sn}.`;
        }
        return `Final yea–nay margins: House ${hy}–${hn}, Senate ${sy}–${sn}.`;
      }
      if (senateCast && !senatePassed && !houseCast) {
        return `Senate floor did not pass (yea–nay ${sy}–${sn}).`;
      }
      if (senatePassed && !houseCast) {
        return `House leadership rejected this bill before a House floor vote (Senate had passed ${sy}–${sn}).`;
      }
      if (senatePassed && houseCast && !housePassed) {
        return `House floor did not pass (yea–nay ${hy}–${hn}).`;
      }
      if (!houseCast && !senateCast) {
        return "Recorded as failed with no yea/nay votes — it may have been closed by maintenance or staff.";
      }
      return `Final yea–nay margins: Senate ${sy}–${sn}, House ${hy}–${hn}.`;
    default:
      return null;
  }
}

export function isBillInFloorVoting(status: string): boolean {
  return status === "house_floor" || status === "senate_floor";
}
