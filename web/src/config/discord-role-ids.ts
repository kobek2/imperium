import discordRoleIdToRoleKey from "./discord-role-map.json";

/** Your guild’s Discord role snowflake → PolSim `role_key` (see `political-roles.ts`). */
export const DISCORD_ROLE_ID_TO_ROLE_KEY: Record<string, string> =
  discordRoleIdToRoleKey;

/** Role keys that the Discord bot manages in `government_role_grants` (manual grants like `admin` stay untouched). */
export const BOT_MANAGED_ROLE_KEYS = new Set(
  Object.values(discordRoleIdToRoleKey),
);
