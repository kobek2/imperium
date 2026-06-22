"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CampaignAdType } from "@/lib/economy-config";
import { CAMPAIGN_AD_TYPES, ECONOMY_MAX_OFFLINE_HOURS } from "@/lib/economy-config";
import { SECTOR_BILL_MEASURES } from "@/lib/legislation-stock";

function revalidateEconomy() {
  revalidatePath("/economy");
  revalidatePath("/economy/pac");
  revalidatePath("/economy/stocks");
  revalidatePath("/economy/stocks/create");
  revalidatePath("/economy/stocks/portfolio");
  revalidatePath("/economy/stocks/trades");
  revalidatePath("/economy/stocks/market-events");
  revalidatePath("/economy/stocks/sectors");
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  revalidatePath("/economy/leaderboard");
  revalidatePath("/parties");
}

function assertPartyTreasuryKey(party: string): string | null {
  if (party === "democrat" || party === "republican") return party;
  return null;
}

export async function collectEconomyIncome(): Promise<{
  ok: boolean;
  message: string;
  details?: Array<{ label: string; value: string; tone?: "positive" | "negative" | "neutral" }>;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("economy_collect_income", { p_body: {} });
  if (error) return { ok: false, message: error.message };
  const payload = (data as {
    paid?: number;
    party_levy?: number;
    hours?: number;
    party_levy_salary_base?: number;
    role_hourly?: number;
    gross_collect?: number;
  }) ?? { paid: 0 };
  const paid = Number(payload.paid ?? 0);
  const partyLevy = Number(payload.party_levy ?? 0);
  const hours = Math.max(0, Number(payload.hours ?? 0));
  const salaryBase = Number(payload.party_levy_salary_base ?? 0);
  const roleHourly = Math.max(0, Number(payload.role_hourly ?? 0));
  const grossBeforeLevy = Number(payload.gross_collect ?? paid + partyLevy);
  const roleSlice = roleHourly * hours;
  revalidateEconomy();
  if (paid <= 0) {
    return {
      ok: true,
      message: `Nothing to collect yet (max ${ECONOMY_MAX_OFFLINE_HOURS}h accrual).`,
    };
  }
  return {
    ok: true,
    message: `Collected payout (${hours}h accrual).`,
    details: [
      { label: "Net deposited", value: `+$${paid.toLocaleString()}`, tone: "positive" },
      { label: "Role income", value: `+$${roleSlice.toLocaleString()}`, tone: "positive" },
      { label: "Gross before party tax", value: `+$${grossBeforeLevy.toLocaleString()}`, tone: "positive" },
      ...(partyLevy > 0
        ? [{
            label: "Party tax to treasury",
            value: `-$${partyLevy.toLocaleString(undefined, { maximumFractionDigits: 0 })}${
              salaryBase > 0 ? ` (${Math.round((partyLevy / salaryBase) * 100)}%)` : ""
            }`,
            tone: "negative" as const,
          }]
        : []),
    ],
  };
}

function normalizeDiscordUsernameInput(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("@")) s = s.slice(1).trim();
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash).trim();
  return s;
}

export async function transferToPlayer(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const recipientUserId = String(formData.get("recipient_user_id") ?? "").trim();
  const raw = String(formData.get("recipient_discord_username") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  const handle = normalizeDiscordUsernameInput(raw);
  if ((!recipientUserId && !handle) || !Number.isFinite(amt) || amt <= 0) {
    return { ok: false, message: "Select a recipient and enter a valid amount." };
  }
  if (!recipientUserId && /[%_]/.test(handle)) {
    return { ok: false, message: "Discord username cannot contain % or _." };
  }

  let to = recipientUserId;
  if (!to) {
    const { data: rows, error: qErr } = await supabase.from("profiles").select("id").ilike("discord_username", handle);
    if (qErr) return { ok: false, message: qErr.message };
    const ids = (rows ?? []) as Array<{ id: string }>;
    if (ids.length === 0) return { ok: false, message: "No player found with that Discord username." };
    if (ids.length > 1) return { ok: false, message: "More than one profile matches that Discord username." };
    to = ids[0].id;
  }
  if (to === user.id) return { ok: false, message: "You cannot transfer to yourself." };

  const { error } = await supabase.rpc("economy_transfer_to_user", { p_to_user: to, p_amount: amt });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "Transfer complete." };
}

export async function depositPartyTreasury(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: prof, error: pErr } = await supabase.from("profiles").select("party").eq("id", user.id).maybeSingle();
  if (pErr) return { ok: false, message: pErr.message };
  const aff = String((prof as { party?: string } | null)?.party ?? "").trim();
  if (aff !== "democrat" && aff !== "republican") {
    return { ok: false, message: "Only Democratic or Republican affiliates can deposit to a party treasury." };
  }

  const party = String(formData.get("party_key") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!party || !Number.isFinite(amt) || amt <= 0) return { ok: false, message: "Invalid party or amount." };
  if (party !== aff) return { ok: false, message: "You can only deposit to your own party's treasury." };
  if (!assertPartyTreasuryKey(party)) return { ok: false, message: "Only major parties maintain a pooled treasury." };

  const { error } = await supabase.rpc("economy_party_deposit", { p_party: party, p_amount: amt });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "Deposited to party treasury." };
}

export async function applyCampaignAd(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const combined = String(formData.get("candidacy") ?? "").trim();
  const adType = String(formData.get("ad_type") ?? "persuasion").trim() as CampaignAdType;
  let electionId = String(formData.get("election_id") ?? "").trim();
  let candidateId = String(formData.get("candidate_id") ?? "").trim();
  if (combined.includes("__")) {
    const parts = combined.split("__");
    electionId = (parts[0] ?? "").trim();
    candidateId = (parts[1] ?? "").trim();
  }
  if (!electionId || !candidateId) return { ok: false, message: "Missing election or candidate." };
  if (!(adType in CAMPAIGN_AD_TYPES)) return { ok: false, message: "Invalid ad type." };

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at, leadership_role")
    .eq("id", electionId)
    .maybeSingle();
  if (!election) return { ok: false, message: "Election not found." };
  if (election.leadership_role) return { ok: false, message: "Campaign ads don't apply to leadership races." };
  if (election.phase !== "general") return { ok: false, message: "Campaign ads only work during the general election." };
  if (new Date() > new Date(election.general_closes_at)) return { ok: false, message: "General election is closed." };

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("id", candidateId)
    .eq("election_id", electionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) return { ok: false, message: "You must be a candidate in this race to run ads." };

  let targetCandidate: string | null = null;
  if (adType === "attack") {
    targetCandidate =
      String(formData.get("attack_target_id") ?? formData.get("attack_target") ?? "").trim() || null;
    if (!targetCandidate) return { ok: false, message: "Attack ads need an opponent target." };
  }

  const { data, error } = await supabase.rpc("economy_use_campaign_ad", {
    p_election: electionId,
    p_candidate: candidateId,
    p_qty: 1,
    p_ad_type: adType,
    p_target_candidate: targetCandidate,
  });
  if (error) return { ok: false, message: error.message };
  const payload = data as {
    points?: number;
    cost?: number;
    ad_type?: string;
    outcome?: string;
    npc_counter_attack?: boolean;
    npc_speech?: boolean;
  };
  revalidateEconomy();
  revalidatePath("/elections");
  revalidatePath(`/elections/${electionId}`);
  const cfg = CAMPAIGN_AD_TYPES[adType];
  const pts = Number(payload.points ?? cfg.points);
  let message: string;
  if (adType === "attack" && payload.outcome === "attack_miss") {
    message = `Attack ad missed (−$${Number(payload.cost ?? cfg.cost).toLocaleString()}) — backlash cost you 1 point.`;
  } else if (adType === "attack" && payload.outcome === "attack_hit") {
    message = `Attack ad landed (−$${Number(payload.cost ?? cfg.cost).toLocaleString()}) → opponent −4 points.`;
  } else if (pts > 0) {
    message = `Ran ${cfg.label} (−$${Number(payload.cost ?? cfg.cost).toLocaleString()}) → +${pts} points.`;
  } else {
    message = `Ran ${cfg.label} (−$${Number(payload.cost ?? cfg.cost).toLocaleString()}).`;
  }
  if (payload.npc_speech) message += " Your opponent just gave a speech.";
  if (payload.npc_counter_attack) message += " They ran a reactive attack ad against you.";
  return { ok: true, message };
}

/** @deprecated Ads are wallet-direct; use applyCampaignAd */
export async function buyCampaignAds(): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: "Buy ads when you run them on an election — select an ad type there." };
}

/** @deprecated */
export async function applyCampaignAdFromInventory(formData: FormData): Promise<{ ok: boolean; message: string }> {
  return applyCampaignAd(formData);
}

export async function registerPac(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const name = String(formData.get("pac_name") ?? "").trim();
  if (name.length < 3) return { ok: false, message: "PAC name must be at least 3 characters." };
  const { error } = await supabase.rpc("economy_register_pac", { p_name: name, p_dark: false });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: `PAC "${name}" registered.` };
}

export async function fundPacTreasury(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, message: "Enter a valid amount." };
  const { data, error } = await supabase.rpc("pac_fund_treasury", { p_amount: amt });
  if (error) return { ok: false, message: error.message };
  const treasury = Number((data as { treasury_balance?: number })?.treasury_balance ?? 0);
  revalidateEconomy();
  return { ok: true, message: `Treasury now $${treasury.toLocaleString()}.` };
}

export async function contributePacToCandidate(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const combined = String(formData.get("candidacy") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!combined.includes("__")) return { ok: false, message: "Select a candidate." };
  const [electionId, candidateId] = combined.split("__");
  if (!electionId || !candidateId) return { ok: false, message: "Select a candidate." };
  if (!Number.isFinite(amt) || amt < 100_000) return { ok: false, message: "Minimum contribution is $100,000." };

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at, leadership_role")
    .eq("id", electionId)
    .maybeSingle();
  if (!election) return { ok: false, message: "Election not found." };
  if (election.leadership_role) return { ok: false, message: "PAC contributions don't apply to leadership races." };
  if (election.phase !== "general") return { ok: false, message: "Contributions only work during the general election." };
  if (new Date() > new Date(election.general_closes_at)) return { ok: false, message: "General election is closed." };

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id, user_id")
    .eq("id", candidateId)
    .eq("election_id", electionId)
    .maybeSingle();
  if (!candidate) return { ok: false, message: "Candidate not found in this race." };
  if (candidate.user_id === user.id) return { ok: false, message: "You can't contribute to your own candidacy." };

  const { data, error } = await supabase.rpc("pac_contribute_to_candidate", {
    p_election: electionId,
    p_candidate: candidateId,
    p_amount: amt,
    p_dark: false,
  });
  if (error) return { ok: false, message: error.message };
  const pts = Number((data as { campaign_points?: number })?.campaign_points ?? 0);
  revalidateEconomy();
  revalidatePath("/elections");
  if (electionId) revalidatePath(`/elections/${electionId}`);
  return {
    ok: true,
    message: `Disclosed: $${amt.toLocaleString()} → +${pts} campaign points.`,
  };
}

export async function suggestCompanyTicker(name: string): Promise<{ ok: boolean; ticker?: string; message?: string }> {
  const supabase = await createClient();
  const trimmed = name.trim();
  if (trimmed.length < 3) return { ok: false, message: "Enter a company name first." };
  const { data, error } = await supabase.rpc("suggest_company_ticker", { p_name: trimmed });
  if (error) return { ok: false, message: error.message };
  return { ok: true, ticker: String(data ?? "") };
}

export async function checkTickerAvailable(ticker: string): Promise<{ ok: boolean; available: boolean; message?: string }> {
  const supabase = await createClient();
  const normalized = ticker.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length < 3 || normalized.length > 5) {
    return { ok: true, available: false, message: "Ticker must be 3–5 uppercase letters." };
  }
  const { data, error } = await supabase.rpc("check_ticker_available", { p_ticker: normalized });
  if (error) return { ok: false, available: false, message: error.message };
  return { ok: true, available: data === true };
}

export async function foundPublicCompany(formData: FormData): Promise<{ ok: boolean; message: string; ticker?: string }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const primaryFocus = String(formData.get("primary_focus") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const strategy = String(formData.get("strategy") ?? "stable").trim();
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
  const valuation = Number(String(formData.get("valuation") ?? "").trim());
  const totalShares = Number(String(formData.get("total_shares") ?? "").trim());
  const publicShares = Number(String(formData.get("public_shares") ?? "").trim());

  if (name.length < 3) return { ok: false, message: "Company name must be at least 3 characters." };
  if (!description) return { ok: false, message: "Company description is required." };
  if (!primaryFocus) return { ok: false, message: "Primary focus is required." };
  if (!Number.isFinite(valuation) || valuation < 1_000_000) {
    return { ok: false, message: "Minimum company valuation is $1,000,000." };
  }
  if (!Number.isFinite(totalShares) || totalShares < 1_000) {
    return { ok: false, message: "Minimum total shares is 1,000." };
  }
  if (!Number.isFinite(publicShares) || publicShares < 1 || publicShares >= totalShares) {
    return { ok: false, message: "Public shares must be between 1 and total shares minus 1." };
  }
  const founderShares = totalShares - publicShares;
  if (founderShares <= totalShares / 2) {
    return { ok: false, message: "Founder must retain majority ownership (>50%)." };
  }

  const { data, error } = await supabase.rpc("found_public_company", {
    p_name: name,
    p_description: description,
    p_primary_focus: primaryFocus,
    p_sector: sector,
    p_strategy: strategy,
    p_ticker: ticker,
    p_valuation: valuation,
    p_total_shares: Math.floor(totalShares),
    p_public_shares: Math.floor(publicShares),
  });
  if (error) return { ok: false, message: error.message };

  const payload = data as { ticker_symbol?: string; price_per_share?: number } | null;
  const sym = payload?.ticker_symbol ?? ticker;
  const price = Number(payload?.price_per_share ?? 0);
  revalidateEconomy();
  revalidatePath(`/economy/stocks/${sym}`);
  return {
    ok: true,
    ticker: sym,
    message: `IPO complete — ${name} (${sym}) listed at $${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/share.`,
  };
}

/** @deprecated Use foundPublicCompany */
export async function foundBusiness(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const capital = Number(String(formData.get("capital") ?? "").trim());
  const listed = Number(String(formData.get("shares_listed") ?? "1000").trim());
  if (name.length < 3) return { ok: false, message: "Business name required." };
  const { error } = await supabase.rpc("found_business", {
    p_name: name,
    p_sector: sector,
    p_capital: capital,
    p_shares_listed: Math.floor(listed),
  });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: `Founded ${name} in ${sector}.` };
}

export async function buyStock(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const shares = Number(String(formData.get("shares") ?? "").trim());
  if (!businessId || !Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Invalid order." };
  const { error } = await supabase.rpc("buy_stock", { p_business: businessId, p_shares: Math.floor(shares) });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: `Bought ${shares} shares.` };
}

export async function sellStock(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const shares = Number(String(formData.get("shares") ?? "").trim());
  if (!businessId || !Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Invalid order." };
  const { error } = await supabase.rpc("sell_stock", { p_business: businessId, p_shares: Math.floor(shares) });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: `Sold ${shares} shares.` };
}

export async function investInBusiness(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!businessId || !Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Invalid investment." };
  const { data, error } = await supabase.rpc("invest_in_business", { p_business: businessId, p_amount: amount });
  if (error) return { ok: false, message: error.message };
  const price = Number((data as { price_per_share?: number })?.price_per_share ?? 0);
  revalidateEconomy();
  return { ok: true, message: `Invested $${amount.toLocaleString()} in treasury. Share price now $${price.toLocaleString()}.` };
}

export async function payBusinessDividend(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const perShare = Number(String(formData.get("amount_per_share") ?? "").trim());
  if (!businessId || !Number.isFinite(perShare) || perShare <= 0) return { ok: false, message: "Invalid dividend." };
  const { data, error } = await supabase.rpc("pay_dividend", { p_business: businessId, p_amount_per_share: perShare });
  if (error) return { ok: false, message: error.message };
  const price = Number((data as { price_per_share?: number })?.price_per_share ?? 0);
  revalidateEconomy();
  return { ok: true, message: `Dividend paid. Share price now $${price.toLocaleString()}.` };
}

export async function withdrawBusinessEarnings(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!businessId || !Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Invalid withdrawal." };
  const { data, error } = await supabase.rpc("withdraw_business_earnings", { p_business: businessId, p_amount: amount });
  if (error) return { ok: false, message: error.message };
  const price = Number((data as { price_per_share?: number })?.price_per_share ?? 0);
  revalidateEconomy();
  return { ok: true, message: `Withdrew $${amount.toLocaleString()}. Share price now $${price.toLocaleString()}.` };
}

export async function discloseCompanyBillPosition(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const companyId = String(formData.get("company_id") ?? "").trim();
  const billId = String(formData.get("bill_id") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim().toLowerCase();
  if (!companyId || !billId) return { ok: false, message: "Missing company or bill." };
  if (!["support", "oppose", "neutral"].includes(position)) {
    return { ok: false, message: "Position must be support, oppose, or neutral." };
  }
  const { error } = await supabase.rpc("disclose_company_bill_position", {
    p_company_id: companyId,
    p_bill_id: billId,
    p_position: position,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/bill/${billId}`);
  revalidateEconomy();
  return { ok: true, message: `Position disclosed: ${position}.` };
}

export async function fundCompanyLobbyOffer(input: {
  companyId: string;
  recipientUserId: string;
  amount: number;
  measureKey: string;
  billTitle: string;
  billContentMd: string;
  message?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const measure = input.measureKey.trim();
  const amount = Number(input.amount);
  if (!input.companyId || !input.recipientUserId) return { ok: false, message: "Missing company or recipient." };
  if (!Number.isFinite(amount) || amount < 100_000) {
    return { ok: false, message: "Minimum lobby payment is $100,000." };
  }
  const effect = SECTOR_BILL_MEASURES.find((m) => m.key === measure)?.stockEffect;
  if (effect == null) return { ok: false, message: "Invalid legislation type." };
  if (!input.billTitle.trim() || !input.billContentMd.trim()) {
    return { ok: false, message: "Bill title and text are required." };
  }

  const { data, error } = await supabase.rpc("fund_company_lobby_offer", {
    p_company_id: input.companyId,
    p_recipient_user_id: input.recipientUserId,
    p_amount: amount,
    p_measure_key: measure,
    p_stock_market_effect: effect,
    p_bill_title: input.billTitle.trim(),
    p_bill_content_md: input.billContentMd.trim(),
    p_message: input.message ?? null,
  });
  if (error) return { ok: false, message: error.message };

  revalidateEconomy();
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  const offerId = (data as { offer_id?: string })?.offer_id;
  return {
    ok: true,
    message: offerId
      ? `Lobby offer sent. Shareholder paid ${formatUsd(amount)} to file sector legislation.`
      : `Lobby offer sent.`,
  };
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString()}`;
}

export type CompanyLobbyOfferRow = {
  id: string;
  company_id: string;
  company_name: string;
  ticker_symbol: string | null;
  owner_user_id: string;
  recipient_user_id: string;
  amount: number;
  measure_key: string;
  affected_sector: string;
  stock_market_effect: number;
  bill_title: string;
  bill_content_md: string;
  message: string | null;
  status: string;
};

export async function listFundedLobbyOffersForUser(): Promise<CompanyLobbyOfferRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("company_lobby_offers")
    .select(
      "id, company_id, owner_user_id, recipient_user_id, amount, measure_key, affected_sector, stock_market_effect, bill_title, bill_content_md, message, status, company:businesses(name, ticker_symbol)",
    )
    .eq("recipient_user_id", user.id)
    .eq("status", "funded")
    .order("created_at", { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => {
    const companyRaw = row.company as { name: string; ticker_symbol: string | null } | { name: string; ticker_symbol: string | null }[] | null;
    const company = Array.isArray(companyRaw) ? (companyRaw[0] ?? null) : companyRaw;
    return {
      id: row.id as string,
      company_id: row.company_id as string,
      company_name: company?.name ?? "Company",
      ticker_symbol: company?.ticker_symbol ?? null,
      owner_user_id: row.owner_user_id as string,
      recipient_user_id: row.recipient_user_id as string,
      amount: Number(row.amount),
      measure_key: row.measure_key as string,
      affected_sector: row.affected_sector as string,
      stock_market_effect: Number(row.stock_market_effect),
      bill_title: row.bill_title as string,
      bill_content_md: row.bill_content_md as string,
      message: (row.message as string | null) ?? null,
      status: row.status as string,
    };
  });
}

export type BlackjackTableState = {
  active: boolean;
  bet?: number;
  player_hand?: number[];
  player_value?: number;
  dealer_up?: number;
  dealer_hand?: number[];
  dealer_value?: number;
  dealer_hole_hidden?: boolean;
  outcome?: string;
  message?: string;
  balance?: number;
};

export async function blackjackTableState(): Promise<{ ok: boolean; state: BlackjackTableState; message?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("economy_blackjack_state");
  if (error) return { ok: false, state: { active: false }, message: error.message };
  return { ok: true, state: (data ?? { active: false }) as BlackjackTableState };
}

export async function blackjackStart(
  formData: FormData,
): Promise<{ ok: boolean; message: string; state?: BlackjackTableState }> {
  const supabase = await createClient();
  const bet = Number(String(formData.get("bet") ?? "").trim());
  if (!Number.isFinite(bet)) return { ok: false, message: "Invalid bet." };
  const { data, error } = await supabase.rpc("economy_blackjack_start", { p_bet: bet });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  const state = data as BlackjackTableState;
  return { ok: true, message: state.message ?? "Round started.", state };
}

export async function blackjackAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string; state?: BlackjackTableState }> {
  const supabase = await createClient();
  const action = String(formData.get("action") ?? "").trim().toLowerCase();
  if (action !== "hit" && action !== "stand") return { ok: false, message: "Invalid action." };
  const { data, error } = await supabase.rpc("economy_blackjack_action", { p_action: action });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  const state = data as BlackjackTableState;
  return { ok: true, message: state.message ?? "OK", state };
}
