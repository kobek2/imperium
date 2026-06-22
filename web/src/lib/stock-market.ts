import { BUSINESS_SECTORS, COMPANY_STRATEGIES } from "@/lib/economy-config";

export type CompanyStrategy = (typeof COMPANY_STRATEGIES)[number]["key"];

export function formatUsd(n: number, opts?: { decimals?: number }): string {
  const decimals = opts?.decimals ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatMarketCap(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return formatUsd(n);
}

export function sectorLabel(key: string): string {
  return BUSINESS_SECTORS.find((s) => s.key === key)?.label ?? key.replace(/_/g, " ");
}

export function strategyLabel(key: string | null | undefined): string {
  return COMPANY_STRATEGIES.find((s) => s.key === key)?.label ?? key ?? "—";
}

export function strategyDescription(key: string | null | undefined): string {
  return COMPANY_STRATEGIES.find((s) => s.key === key)?.description ?? "";
}

export function companyDisplayName(name: string, ticker: string | null | undefined): string {
  if (!ticker) return name;
  return `${name} (${ticker})`;
}

export function initialSharePrice(valuation: number, totalShares: number): number {
  if (totalShares <= 0) return 0;
  return Math.round((valuation / totalShares) * 10000) / 10000;
}

export function founderOwnershipPct(founderShares: number, totalShares: number): number {
  if (totalShares <= 0) return 0;
  return (founderShares / totalShares) * 100;
}

export function publicOwnershipPct(publicShares: number, totalShares: number): number {
  if (totalShares <= 0) return 0;
  return (publicShares / totalShares) * 100;
}

export function formatGrowthRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatMarketSharePct(share: number): string {
  if (share >= 10) return `${Math.round(share)}%`;
  if (share >= 1) return `${share.toFixed(1)}%`;
  return `${share.toFixed(2)}%`;
}

export function formatRevenue(n: number): string {
  return formatMarketCap(n);
}

export function ordinalRank(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `#${rank}th`;
  const mod10 = rank % 10;
  if (mod10 === 1) return `#${rank}st`;
  if (mod10 === 2) return `#${rank}nd`;
  if (mod10 === 3) return `#${rank}rd`;
  return `#${rank}th`;
}

export function sectorRankLabel(rank: number, sector: string): string {
  return `${ordinalRank(rank)} ${sectorLabel(sector)} Company`;
}
