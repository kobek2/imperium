export type BillChamber = "house" | "senate";

/** Yea/nay totals from `bill_votes` for each chamber’s floor. */
export type BillFloorYeaNayTally = {
  house_yea: number;
  house_nay: number;
  senate_yea: number;
  senate_nay: number;
};
