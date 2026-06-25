#!/usr/bin/env node
/**
 * Grant president role for RP testing.
 * Usage: node scripts/grant-president.mjs [character_name_or_user_id]
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
  console.error("Missing Supabase env in web/.env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const arg = process.argv[2]?.trim();

async function resolveUserId() {
  if (arg && /^[0-9a-f-]{36}$/i.test(arg)) return arg;

  const name = arg ?? "Bleu Bell";
  const { data } = await supabase
    .from("profiles")
    .select("id, character_name, office_role")
    .ilike("character_name", name)
    .limit(3);
  if (!data?.length) throw new Error(`No profile matching "${name}"`);
  if (data.length > 1) {
    console.log("Multiple matches — pass exact user id:");
    for (const p of data) console.log(`  ${p.id}  ${p.character_name}`);
    throw new Error("Ambiguous character name");
  }
  return data[0].id;
}

async function main() {
  const userId = await resolveUserId();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, character_name, office_role, presidential_signature")
    .eq("id", userId)
    .single();

  const { error: grantErr } = await supabase
    .from("government_role_grants")
    .upsert({ user_id: userId, role_key: "president" }, { onConflict: "user_id,role_key" });

  if (grantErr) {
    const { error: insErr } = await supabase
      .from("government_role_grants")
      .insert({ user_id: userId, role_key: "president" });
    if (insErr) throw insErr;
  }

  const { data: active } = await supabase
    .from("simulation_event_instances")
    .select("id, title, story_arc_id")
    .eq("status", "active")
    .like("template_key", "news_%");

  for (const inst of active ?? []) {
    await supabase.from("simulation_event_assignments").upsert(
      {
        instance_id: inst.id,
        assignee_user_id: userId,
        role_label: "President",
        is_primary: true,
        completed_at: null,
        response_key: null,
      },
      { onConflict: "instance_id,assignee_user_id" },
    );
  }

  console.log(`✓ Granted president to ${profile?.character_name ?? userId}`);
  console.log(`  Signature on file: ${profile?.presidential_signature ? "yes" : "no — set on /oval"}`);
  console.log(`  Crisis assignments refreshed: ${active?.length ?? 0} active story(ies)`);
  console.log("\nNext: sign in as this character → Newsroom → crisis briefing at top.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
