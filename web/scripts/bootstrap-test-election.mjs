#!/usr/bin/env node
/**
 * Bootstrap a test House election: player candidate + dual-party NPC placeholders in primary.
 * Usage: node scripts/bootstrap-test-election.mjs [user_id]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const path = resolve(__dirname, "../.env.local");
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const targetUserId = process.argv[2]?.trim();

function addHours(iso, h) {
  return new Date(new Date(iso).getTime() + h * 3600_000).toISOString();
}

async function main() {
  let userId = targetUserId;
  if (!userId) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, character_name, party, residence_state, home_district_code")
      .not("party", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    const pick =
      profiles?.find((p) => p.home_district_code && p.party) ??
      profiles?.find((p) => p.party) ??
      profiles?.[0];
    if (!pick) throw new Error("No profiles found. Pass user_id as first argument.");
    userId = pick.id;
    console.log(`Using profile: ${pick.character_name ?? pick.id} (${pick.party}, ${pick.home_district_code ?? "no district"})`);
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id, character_name, party, residence_state, home_district_code")
    .eq("id", userId)
    .single();
  if (pErr || !profile) throw new Error(`Profile not found: ${userId}`);

  const party = String(profile.party ?? "").toLowerCase();
  if (!["democrat", "republican", "independent"].includes(party)) {
    throw new Error(`Set party on character first (current: ${profile.party ?? "none"})`);
  }

  const district = profile.home_district_code?.trim().toUpperCase();
  if (!district || !/^(NE|SO|WE)-\d{2}$/.test(district)) {
    throw new Error(`Profile needs home district (e.g. NE-01). Current: ${profile.home_district_code ?? "none"}`);
  }

  const state = district.slice(0, 2);

  const { data: openRace } = await supabase
    .from("elections")
    .select("id, phase")
    .eq("office", "house")
    .eq("district_code", district)
    .neq("phase", "closed")
    .maybeSingle();

  if (openRace) {
    console.log(`Open race already exists for ${district}: ${openRace.id} (${openRace.phase})`);
    console.log(`View: /elections/${openRace.id}`);
    return;
  }

  const now = new Date().toISOString();
  const filing_closes_at = addHours(now, 24);
  const primary_closes_at = addHours(filing_closes_at, 24);
  const general_closes_at = addHours(primary_closes_at, 48);

  const { data: election, error: eErr } = await supabase
    .from("elections")
    .insert({
      office: "house",
      state,
      district_code: district,
      phase: "primary",
      filing_opens_at: now,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide: true,
      filing_window_started_at: now,
      npc_opponents_seeded: false,
    })
    .select("id")
    .single();
  if (eErr) throw eErr;

  const electionId = election.id;

  const { error: cErr } = await supabase.from("election_candidates").insert({
    election_id: electionId,
    user_id: userId,
    party,
    campaign_points_total: 0,
    primary_winner: false,
    is_npc: false,
  });
  if (cErr) throw cErr;

  const { data: seeded, error: sErr } = await supabase.rpc("seed_election_npc_opponents", {
    p_election_id: electionId,
  });
  if (sErr) throw sErr;

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, party, is_npc, npc_name, campaign_points_total, primary_winner")
    .eq("election_id", electionId);

  console.log("\nElection ready:");
  console.log(`  ID:       ${electionId}`);
  console.log(`  Seat:     ${district} (${state})`);
  console.log(`  Phase:    primary (closes ${primary_closes_at})`);
  console.log(`  Player:   ${profile.character_name ?? userId} (${party})`);
  console.log("  NPC placeholders:");
  for (const c of candidates ?? []) {
    if (c.is_npc) {
      console.log(`    - ${c.npc_name} (${c.party}, ${c.campaign_points_total} pts)`);
    }
  }
  console.log(`\nOpen: /elections/${electionId}`);
  console.log(`Seeded NPCs: ${seeded ? "yes" : "already present"}`);
  console.log("\nNext: vote in your party primary, then admin advances to general.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
