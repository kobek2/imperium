/** User-facing status for bills (pipeline uses more granular DB enum values). */
export function billStatusDisplay(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted — leadership review";
    case "debate":
      return "Debate — floor vote not open";
    case "other_chamber_review":
      return "Other chamber — leadership review";
    case "other_chamber_debate":
      return "Other chamber — debate";
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
      return "Failed";
    case "failed":
      return "Failed (floor vote)";
    default:
      return status.replaceAll("_", " ");
  }
}

export function isBillInFloorVoting(status: string): boolean {
  return status === "house_floor" || status === "senate_floor";
}
