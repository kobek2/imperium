/**
 * Single human-readable title from merged government role keys (Discord grants + legacy office_role).
 */

const ROLE_ORDER: { key: string; label: string }[] = [
  { key: "president", label: "President" },
  { key: "vice_president", label: "Vice President" },
  { key: "speaker", label: "Speaker of the House" },
  { key: "president_pro_tempore", label: "President pro tempore" },
  { key: "senate_majority_leader", label: "Senate Majority Leader" },
  { key: "senate_majority_whip", label: "Senate Majority Whip" },
  { key: "senate_minority_leader", label: "Senate Minority Leader" },
  { key: "senate_minority_whip", label: "Senate Minority Whip" },
  { key: "house_majority_leader", label: "House Majority Leader" },
  { key: "house_majority_whip", label: "House Majority Whip" },
  { key: "house_minority_leader", label: "House Minority Leader" },
  { key: "house_minority_whip", label: "House Minority Whip" },
  { key: "chief_justice", label: "Chief Justice" },
  { key: "associate_justice", label: "Associate Justice" },
  { key: "senator", label: "Senator" },
  { key: "representative", label: "Representative" },
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
