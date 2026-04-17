const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { Events } = require("discord.js");

const roleMap = require(path.join(
  __dirname,
  "..",
  "web",
  "src",
  "config",
  "discord-role-map.json",
));

const MANAGED_ROLE_KEYS = [...new Set(Object.values(roleMap))];

function createSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Rewrites bot-managed rows in `government_role_grants` from the member’s current Discord roles.
 * Requires `profiles.discord_user_id` to match the member’s Discord id (set at signup / trigger).
 */
async function syncMemberGrants(supabase, member) {
  const discordUserId = member.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (profileError) {
    console.error("profiles lookup", profileError.message);
    return;
  }
  if (!profile) return;

  const desired = new Set();
  for (const [roleId, roleKey] of Object.entries(roleMap)) {
    if (member.roles.cache.has(roleId)) desired.add(roleKey);
  }

  const { error: delErr } = await supabase
    .from("government_role_grants")
    .delete()
    .eq("user_id", profile.id)
    .in("role_key", MANAGED_ROLE_KEYS);

  if (delErr) {
    console.error("grants delete", delErr.message);
    return;
  }

  if (desired.size === 0) return;

  const rows = [...desired].map((role_key) => ({
    user_id: profile.id,
    role_key,
  }));

  const { error: insErr } = await supabase.from("government_role_grants").insert(rows);
  if (insErr) console.error("grants insert", insErr.message);
}

function setupRoleSync(client) {
  const supabase = createSupabase();
  if (!supabase) {
    console.warn(
      "Supabase URL + SUPABASE_SERVICE_ROLE_KEY missing — government_role_grants sync disabled.",
    );
    return;
  }

  const guildId = process.env.DISCORD_GUILD_ID;

  client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
    if (newMember.guild.id !== guildId) return;
    try {
      await syncMemberGrants(supabase, newMember);
    } catch (e) {
      console.error("GuildMemberUpdate sync", e);
    }
  });

  console.log(
    `Role sync: ${Object.keys(roleMap).length} Discord roles → government_role_grants (GuildMemberUpdate).`,
  );
}

module.exports = { setupRoleSync, syncMemberGrants };
