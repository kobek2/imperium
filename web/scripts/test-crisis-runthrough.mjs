#!/usr/bin/env node
/**
 * Crisis newsroom smoke test (service role).
 * Usage: node scripts/test-crisis-runthrough.mjs
 *
 * 1. Verifies crisis migration tables/columns exist
 * 2. Spawns a breaking news crisis if none active
 * 3. Assigns president + sample congress members
 * 4. Prints a browser walkthrough for /events
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

async function schemaOk() {
  const checks = [
    supabase.from("simulation_event_responses").select("id").limit(1),
    supabase.from("presidential_statements").select("id").limit(1),
    supabase.from("simulation_event_templates").select("crisis_trigger_instrument").limit(1),
    supabase.from("executive_orders").select("story_arc_id").limit(1),
    supabase.from("bills").select("crisis_story_arc_id").limit(1),
  ];
  const results = await Promise.all(checks);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("\n❌ Crisis migration not applied yet:");
    console.error(`   ${failed.error.message}`);
    console.error("\n   Run: supabase db push   (or apply 20260707120000_crisis_response_engine.sql)");
    return false;
  }
  return true;
}

async function findPresident() {
  const { data: grant } = await supabase
    .from("government_role_grants")
    .select("user_id, profiles(character_name)")
    .eq("role_key", "president")
    .limit(1)
    .maybeSingle();
  if (grant?.user_id) {
    return {
      id: grant.user_id,
      name: grant.profiles?.character_name ?? grant.user_id,
    };
  }
  const { data: legacy } = await supabase
    .from("profiles")
    .select("id, character_name")
    .eq("office_role", "president")
    .limit(1)
    .maybeSingle();
  if (legacy) return { id: legacy.id, name: legacy.character_name ?? legacy.id };
  const { data: admin } = await supabase
    .from("profiles")
    .select("id, character_name")
    .in("office_role", ["admin", "president"])
    .limit(1)
    .maybeSingle();
  if (admin) return { id: admin.id, name: admin.character_name ?? admin.id, fallback: true };
  return null;
}

async function activeNewsCrisis() {
  const { data, error } = await supabase
    .from("simulation_event_instances")
    .select("id, title, story_arc_id, template_key, status, deadline_at, beat_number")
    .eq("status", "active")
    .like("template_key", "news_%")
    .order("opened_at", { ascending: false })
    .limit(3);
  if (error) throw error;
  return data ?? [];
}

async function spawnCrisis() {
  const preferredKey = "news_border_surge";
  let pick = null;
  const { data: preferred } = await supabase
    .from("simulation_event_templates")
    .select(
      "template_key, title, summary, body, dateline, default_hours, default_severity, topic, category",
    )
    .eq("template_key", preferredKey)
    .eq("enabled", true)
    .maybeSingle();
  if (preferred) {
    pick = preferred;
  } else {
    const { data: tpl, error: tErr } = await supabase
      .from("simulation_event_templates")
      .select(
        "template_key, title, summary, body, dateline, default_hours, default_severity, topic, category",
      )
      .eq("enabled", true)
      .eq("is_starter", true)
      .like("template_key", "news_%")
      .order("template_key")
      .limit(20);
    if (tErr) throw tErr;
    if (!tpl?.length) throw new Error("No news starter templates in pool.");
    pick = tpl[Math.floor(Math.random() * tpl.length)];
  }
  const arcId = crypto.randomUUID();
  const hours = Math.max(4, Math.min(72, pick.default_hours ?? 24));
  const deadline = new Date(Date.now() + hours * 3600_000).toISOString();

  const { data: inst, error: iErr } = await supabase
    .from("simulation_event_instances")
    .insert({
      template_key: pick.template_key,
      title: pick.title,
      summary: pick.summary,
      body: pick.body,
      dateline: pick.dateline,
      deadline_at: deadline,
      severity: pick.default_severity ?? 3,
      story_arc_id: arcId,
      beat_number: 1,
      beat_label: "breaking",
      status: "active",
      metadata: {
        smoke_test: true,
        topic: pick.topic,
        category: pick.category,
      },
    })
    .select("id, title, story_arc_id, template_key, deadline_at")
    .single();
  if (iErr) throw iErr;

  const president = await findPresident();
  if (president) {
    const { error: aErr } = await supabase.from("simulation_event_assignments").insert({
      instance_id: inst.id,
      assignee_user_id: president.id,
      role_label: "President",
      is_primary: true,
    });
    if (aErr) console.warn("President assignment:", aErr.message);
    else if (president.fallback) {
      console.log(`  (using ${president.name} as stand-in president — no president grant in sim)`);
    }
  }

  const { data: members } = await supabase
    .from("government_role_grants")
    .select("user_id")
    .in("role_key", ["representative", "senator"])
    .limit(8);
  const memberIds = [...new Set((members ?? []).map((m) => m.user_id))].slice(0, 6);
  for (const uid of memberIds) {
    await supabase.from("simulation_event_assignments").insert({
      instance_id: inst.id,
      assignee_user_id: uid,
      role_label: "Member of Congress",
      is_primary: false,
    });
  }

  return { inst, president, congressCount: memberIds.length, template: pick.template_key };
}

async function listArcBeats(arcId) {
  const { data } = await supabase
    .from("simulation_event_instances")
    .select("id, beat_number, beat_label, title, template_key, status, opened_at")
    .eq("story_arc_id", arcId)
    .order("beat_number", { ascending: true });
  return data ?? [];
}

async function listResponses(arcId) {
  const { data } = await supabase
    .from("simulation_event_responses")
    .select("instrument, document_table, created_at, actor_user_id")
    .eq("story_arc_id", arcId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function tryDailyTick() {
  const { data, error } = await supabase.rpc("rp_simulation_events_daily_tick");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function main() {
  console.log("=== Crisis newsroom smoke test ===\n");

  const ok = await schemaOk();
  if (!ok) process.exit(1);
  console.log("✓ Crisis schema present\n");

  const president = await findPresident();
  if (president) {
    console.log(`President in sim: ${president.name}`);
  } else {
    console.log("⚠ No president grant found — briefing UI will not show presidential instruments.");
  }

  let active = await activeNewsCrisis();
  let spawned = null;

  const hasBorder = active.some((a) => a.template_key === "news_border_surge");
  if (active.length < 2 && !hasBorder) {
    console.log("\nSpawning border-surge crisis (has scripted EO follow-up)…");
    const arcId = crypto.randomUUID();
    const { data: tpl } = await supabase
      .from("simulation_event_templates")
      .select("*")
      .eq("template_key", "news_border_surge")
      .single();
    if (tpl) {
      const hours = Math.max(4, Math.min(72, tpl.default_hours ?? 36));
      const { data: inst } = await supabase
        .from("simulation_event_instances")
        .insert({
          template_key: tpl.template_key,
          title: tpl.title,
          summary: tpl.summary,
          body: tpl.body,
          dateline: tpl.dateline,
          deadline_at: new Date(Date.now() + hours * 3600_000).toISOString(),
          severity: tpl.default_severity ?? 4,
          story_arc_id: arcId,
          beat_number: 1,
          beat_label: "breaking",
          status: "active",
          metadata: { smoke_test: true, topic: tpl.topic, category: tpl.category },
        })
        .select("id, title, story_arc_id, template_key")
        .single();
      const president = await findPresident();
      if (president && inst) {
        await supabase.from("simulation_event_assignments").insert({
          instance_id: inst.id,
          assignee_user_id: president.id,
          role_label: "President",
          is_primary: true,
        });
      }
      console.log(`✓ Border crisis: ${inst?.title}`);
      console.log(`  arc: ${inst?.story_arc_id}`);
      active = await activeNewsCrisis();
    }
  }

  if (active.length) {
    console.log(`\n✓ ${active.length} active news crisis(es) already on the wire:`);
    for (const a of active) {
      console.log(`  · [${a.template_key}] ${a.title}`);
      console.log(`    arc: ${a.story_arc_id}  deadline: ${a.deadline_at}`);
    }
  } else {
    console.log("\nNo active news crisis — spawning one for testing…");
    spawned = await spawnCrisis();
    console.log(`✓ Spawned: ${spawned.inst.title}`);
    console.log(`  template: ${spawned.template}`);
    console.log(`  arc id:   ${spawned.inst.story_arc_id}`);
    console.log(`  assigned: president + ${spawned.congressCount} congress members`);
    active = await activeNewsCrisis();
  }

  const arc = active[0]?.story_arc_id;
  if (arc) {
    const beats = await listArcBeats(arc);
    const responses = await listResponses(arc);
    console.log(`\nArc timeline (${beats.length} beat(s)):`);
    for (const b of beats) {
      console.log(`  ${b.beat_number}. [${b.beat_label}] ${b.title} (${b.status})`);
    }
    if (responses.length) {
      console.log(`\nRecorded responses (${responses.length}):`);
      for (const r of responses) {
        console.log(`  · ${r.instrument} via ${r.document_table} at ${r.created_at}`);
      }
    } else {
      console.log("\nNo government responses recorded yet on this arc.");
    }
  }

  console.log("\n--- Daily tick (optional) ---");
  const tick = await tryDailyTick();
  if (tick.ok) {
    console.log("Tick result:", JSON.stringify(tick.data, null, 2));
  } else {
    console.log("(Tick skipped or already ran today:", tick.error, ")");
  }

  console.log("\n=== Browser walkthrough ===\n");
  console.log("1. Sign in as the PRESIDENT (or a assigned member of Congress).");
  console.log("2. Open  /events");
  console.log("   → You should see «Your crisis briefings» above the wire feed.");
  console.log("3. As president:");
  console.log("   → Expand «Issue executive order» and write your own title + body.");
  console.log("   → Publish. The arc should get a follow-up wire beat if one is scripted for EO.");
  console.log("4. As Congress:");
  console.log("   → Click «File crisis legislation» → write a bill → file it.");
  console.log("   → If it becomes law, the arc can resolve as bill_enacted.");
  console.log("5. Refresh /events and watch the story arc grow in the feed below.");
  console.log("6. Admin override: /admin/elections → Newsroom (publish follow-up, resolve expired).");
  if (arc) {
    console.log(`\nDirect link: /events#evt-${active[0].id}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
