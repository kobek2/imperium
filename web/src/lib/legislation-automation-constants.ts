/** Hopper: Speaker / Senate ML must act before auto-accept to docket/debate. */
export const HOPPER_LEADERSHIP_HOURS = 48;

/** After debate opens, auto floor vote if no vote is scheduled. */
export const DEBATE_AUTO_FLOOR_HOURS = 24;

/** Receiving chamber leadership must accept before auto-advance to debate. */
export const OTHER_CHAMBER_REVIEW_HOURS = 48;

/** Legacy on-docket (no debate clock) before auto floor vote. */
export const ON_DOCKET_AUTO_FLOOR_HOURS = 72;

export function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
