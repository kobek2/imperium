/**
 * Single human-readable title from merged government role keys (Discord grants + legacy office_role).
 */

const ROLE_ORDER: { key: string; label: string }[] = [
  { key: "mayor", label: "Mayor of New York City" },
  { key: "council_spokesperson", label: "Council Spokesperson" },
  { key: "council_member", label: "City Council Member" },
  { key: "dept_finance", label: "Commissioner of Finance" },
  { key: "dept_police", label: "Police Commissioner" },
  { key: "dept_public_works", label: "Commissioner of Public Works" },
  { key: "dept_parks", label: "Commissioner of Parks & Recreation" },
  { key: "dept_planning", label: "Director of City Planning" },
  // Legacy federal keys (shown only if still held)
  { key: "president", label: "President (archived role)" },
  { key: "vice_president", label: "Vice President (archived role)" },
  { key: "speaker", label: "Speaker of the House (archived)" },
  { key: "president_pro_tempore", label: "President pro tempore (archived)" },
  { key: "senate_majority_leader", label: "Senate Majority Leader (archived)" },
  { key: "senate_majority_whip", label: "Senate Majority Whip (archived)" },
  { key: "senate_minority_leader", label: "Senate Minority Leader (archived)" },
  { key: "senate_minority_whip", label: "Senate Minority Whip (archived)" },
  { key: "house_majority_leader", label: "House Majority Leader (archived)" },
  { key: "house_majority_whip", label: "House Majority Whip (archived)" },
  { key: "house_minority_leader", label: "House Minority Leader (archived)" },
  { key: "house_minority_whip", label: "House Minority Whip (archived)" },
  { key: "chief_justice", label: "Chief Justice (archived)" },
  { key: "associate_justice", label: "Associate Justice (archived)" },
  { key: "senator", label: "Senator (archived)" },
  { key: "representative", label: "Representative (archived)" },
  { key: "citizen", label: "Citizen" },
];

/** Title-case each whitespace-delimited word (for profile headlines). */
export function titleCaseEachWord(input: string): string {
  const t = input.trim();
  if (!t) return t;
  return t
    .split(/\s+/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export function formatPrimaryGovernmentTitle(roleKeys: string[]): string {
  const set = new Set(roleKeys);
  if (set.has("admin") && roleKeys.length === 1) {
    return "Administrator";
  }
  for (const { key, label } of ROLE_ORDER) {
    if (set.has(key)) return label;
  }
  if (set.has("admin")) return "Administrator";
  return "Citizen";
}
