/**
 * PolSim Discord bot — role sync and announcements.
 *
 * Required env (see /web/.env.example):
 *   DISCORD_BOT_TOKEN
 *   DISCORD_GUILD_ID
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *
 * Next steps:
 * 1. Listen to Supabase Realtime on `elections` / `bills` or poll REST for changes.
 * 2. When `winner_user_id` is set, map office → Discord role id and guild.members.edit.
 * 3. Post embeds to configured announcement channels.
 * // TODO: Discord webhook — notify #floor-session channel (bill floor opens, debate milestones, policy updates).
 */

require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const { setupRoleSync } = require("./role-sync");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !guildId) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error("Unable to fetch guild — check DISCORD_GUILD_ID and bot invites.");
    return;
  }
  console.log(`Connected to guild ${guild.name}`);
  setupRoleSync(client);
});

client.login(token).catch((err) => {
  console.error(err);
  process.exit(1);
});
