# Cursor prompt: build the Imperium Discord bot (standalone project)

Copy everything **below the line** into a new Cursor chat in your **empty or new folder** for the Discord bot (this is a separate repo/folder from Imperium unless you intentionally nest it).

---

You are implementing a **standalone Node.js + TypeScript** Discord bot for **Imperium**, a U.S. legislative simulation. Imperium’s game code lives elsewhere (Next.js + Supabase); this project is only the **Discord gateway** (slash commands now; bill announcements and webhooks later).

## Hard requirements

1. **Package manager:** `npm` is fine unless the user already chose `pnpm`.
2. **Runtime library:** `discord.js` **v14**.
3. **Language:** TypeScript, executed via **`ts-node`** for local dev (no need for a compiled `dist/` pipeline in v1, but keep `outDir` for future `tsc` builds).
4. **Environment:** Load secrets from **`.env`** (never commit). Provide **`.env.example`** with empty values and short comments.
5. **Git:** `.gitignore` must include `node_modules/`, `dist/`, `.env`, `*.log`.

## `package.json`

- **Dependencies:** `discord.js` (^14).
- **DevDependencies:** `typescript`, `ts-node`, `@types/node`, `dotenv-cli`.
- **Scripts:**
  - `"dev"` and `"start"`: `dotenv -e .env -- ts-node src/index.ts`
  - `"typecheck"`: `tsc --noEmit`

## `tsconfig.json`

Use a Node-friendly setup that works with `ts-node`:

- `"module": "CommonJS"`
- `"moduleResolution": "node"`
- `"target": "ES2022"`
- `"strict": true`
- `"rootDir": "./src"`, `"outDir": "./dist"`
- `"esModuleInterop": true`, `"skipLibCheck": true`
- `"types": ["node"]`
- If the user’s TypeScript is **6.x** and complains about deprecated `moduleResolution: "node"`, add `"ignoreDeprecations": "6.0"` (or align with their TS version docs).

## `src/index.ts` (bootstrap behavior)

- Read **`DISCORD_BOT_TOKEN`**, **`DISCORD_CLIENT_ID`** (Application ID from Discord Developer Portal), **`DISCORD_GUILD_ID`** (test server for **guild** slash commands).
- If any are missing, **print a clear error** and `process.exit(1)`.
- **Register slash commands** with REST API **guild-scoped** (`Routes.applicationGuildCommands(clientId, guildId)`) so commands appear quickly during development.
- Register at least:
  - **`ping`**: `description`: `"Replies with pong"` — **Discord requires `description` on every command.**
- Use `Client` with minimal intents: **`GatewayIntentBits.Guilds`** only unless a later feature needs more.
- On **`ClientReady`**, log `Logged in as <tag>`.
- On **`InteractionCreate`**, handle chat input: **`/ping`** → reply **`Pong!`** with **`ephemeral: true`**.
- Use `main().catch(console.error)` and exit non-zero on fatal errors.

## Discord Developer Portal (document in README)

In `README.md`, include a short checklist:

1. Create Application → **Bot** → reset and copy token → `DISCORD_BOT_TOKEN`.
2. Copy **Application ID** → `DISCORD_CLIENT_ID`.
3. **OAuth2 URL Generator:** scopes **`bot`** + **`applications.commands`**; bot permissions at minimum: View Channel, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads (adjust as needed). Invite to server.
4. Enable **Developer Mode** in Discord → copy **Server ID** → `DISCORD_GUILD_ID`.
5. Note: **guild commands** update quickly; **global** commands can take up to ~1 hour.

## Phase 2 (after `/ping` works): Supabase read-only staff tools

Add **`@supabase/supabase-js`**. Extend `.env.example` with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never expose to browsers)

**Security:** the service role bypasses RLS. Only use it after you verify the **Discord user** invoking the command is allowed:

- Resolve `interaction.user.id` (snowflake) → `profiles.discord_user_id`.
- Check staff: `profiles.office_role = 'admin'` **or** `government_role_grants.role_key in ('admin','staff_super')` (matches DB `is_staff_admin` intent; confirm against Imperium migrations if needed).
- Optionally also require the user to have a specific **Discord role ID** in the guild (env: comma-separated allowlist).

Implement slash commands (all with proper `description` fields):

- **`/staffping`** — confirms bot + whether caller maps to an Imperium staff account (no sensitive data for non-staff).
- **`/whois`** — target: **user option** (mention). Return safe profile summary: character name, party, state/district if present, office role, grant keys (read-only).
- **`/elections list`** — subcommand or separate command: list elections where `phase != 'closed'` (or equivalent), with id + office + phase + key dates for cross-reference with the web admin.

If the Imperium repo is unavailable, document the expected tables/columns in README and use typed interfaces.

## Phase 3 (later, document as roadmap in README)

- **Bill announcements:** small **HTTP server** (e.g. Express or native `http`) with a **shared secret** header; Imperium’s Supabase **Database Webhook** on `bills` INSERT calls it; handler posts embed + link to `{PUBLIC_SITE_URL}/bill/{id}` and optionally creates a **forum/public thread** (e.g. `HOUSE SESSION: …`). Use a separate env section (`ANNOUNCE_WEBHOOK_SECRET`, channel IDs, site base URL).
- Do **not** implement Phase 3 until Phase 1–2 are merged and tested.

## Quality

- No secrets in logs or README examples.
- Run **`npm run typecheck`** and fix all errors before finishing.
- Keep the codebase small and readable; one entry file is OK until Phase 2 justifies splitting modules.

## Done when

1. `npm install` → `npm run dev` → bot online → **`/ping`** returns ephemeral Pong.
2. README explains env vars and Discord invite steps.
3. (If Phase 2 in scope for this task) Supabase-backed commands work for a real staff user and reject everyone else cleanly.

---

End of prompt.
