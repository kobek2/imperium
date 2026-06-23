export type CampaignAdInventory = {
  persuasion: number;
  attack: number;
};

const PERSUASION_SKUS = new Set(["campaign_ad_persuasion", "campaign_ad"]);
const ATTACK_SKUS = new Set(["campaign_ad_attack"]);

export function sumCampaignAdInventory(
  rows: Array<{ sku: string; quantity: number | null }> | null | undefined,
): CampaignAdInventory {
  let persuasion = 0;
  let attack = 0;
  for (const row of rows ?? []) {
    const qty = Math.max(0, Number(row.quantity ?? 0));
    if (PERSUASION_SKUS.has(row.sku)) persuasion += qty;
    else if (ATTACK_SKUS.has(row.sku)) attack += qty;
  }
  return { persuasion, attack };
}

export function totalCampaignAdInventory(inv: CampaignAdInventory): number {
  return inv.persuasion + inv.attack;
}
