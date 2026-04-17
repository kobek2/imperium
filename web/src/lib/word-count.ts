/** Same rules as election speech validation — keep in sync with `submitCampaignSpeech`. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
