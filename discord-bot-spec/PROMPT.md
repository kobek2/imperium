# Prompt: Imperium staff Discord bot

Use this document as the **system / task prompt** for implementing a Discord bot that automates common **staff (FEC) operations** for **Imperium**, a political simulation game. The live product is a **Next.js** app in the parent monorepo under `web/`, backed by **Supabase (Postgres + RLS + RPCs)**. Schema and policies live in `supabase/migrations/`.

## Product context

- **Players** sign in with **Discord** via Supabase Auth. Table `public.profiles` is 1:1 with `auth.users`: `profiles.id` = Supabase user UUID, `profiles.discord_user_id` (text, unique) = Discord snowflake, `profiles.discord_username` = display handle.
- **Staff / admin authority** is expressed in two layers:
  1. **Database (RLS / SECURITY DEFINER RPCs)** — function `public.is_staff_admin(uid uuid)` (see migrations, e.g. `20260418120000_election_admin_rls.sql`, `20260456000000_staff_super_is_staff_admin.sql`): true if `profiles.office_role = 'admin'` OR `government_role_grants` has `role_key` in `('admin', 'staff_super')`. Many mutations (elections, party officer finalization, etc.) require this **authenticated** user id.
  2. **Web app** — `web/src/lib/staff-access.ts` + `web/src/lib/staff-permissions.ts`: panel access uses broader `staff_*` grant keys; some server actions use `web/src/lib/is-admin.ts` (`requireAdmin`) which currently checks effective role keys for **`admin` only** (align bot privileges with **DB truth** + your operational policy; do not assume every web action allows `staff_super` without verifying code).

## Why a separate bot service

The existing “backend” is **not** a standalone HTTP API: privileged work runs as **Next.js server actions** (`"use server"`) with the user’s Supabase session cookie/JWT. A Discord bot has **no** browser session. You must either:

- **A (recommended for v1 read-heavy):** Bot uses **Supabase service role** only for **read-only** queries that are safe to expose to trusted staff (e.g. profile lookup by Discord id, election list). **No** service-role writes that bypass RLS unless explicitly designed and reviewed.
- **B (writes / RPCs):** Add a **small trusted HTTP bridge** (e.g. Supabase Edge Function, Cloudflare Worker, or minimal Node server) that:
  - Verifies **Discord Interaction** signatures (slash commands) **or** a shared secret for internal webhooks.
  - Maps the invoking Discord user to `profiles.discord_user_id`, loads their `auth.users` id, and confirms **`is_staff_admin`** (or the specific `staff_*` grant you need) using a **service role** query **before** performing an action.
  - For operations that **must** run as the user for RLS (`auth.uid()`), you either **mint a short-lived JWT** for that user (if your Supabase project supports it) or add **new SECURITY DEFINER RPCs** that take explicit checks (Discord-verified operator id) — **prefer new RPCs reviewed like existing migrations** over bypassing RLS blindly.

Reference examples of admin-gated RPCs: `supabase/migrations/20260448000000_party_finalize_officer_admin_and_close.sql` (`party_finalize_officer_election`).

## Migrations and schema to read first

Skim at least:

- `supabase/migrations/20260416000000_init.sql` — `profiles`, `elections`, `election_candidates`, `bills`, core enums.
- `supabase/migrations/20260417000000_government_role_grants.sql` — grant model.
- `supabase/migrations/20260418120000_election_admin_rls.sql` — `is_staff_admin`, election admin policies.
- `supabase/migrations/20260456000000_staff_super_is_staff_admin.sql` — `staff_super` equivalence in DB.
- `supabase/migrations/20260418210000_fix_discord_username_trigger.sql` — how profiles tie to Discord on signup.

Then scan migrations touching **party leadership**, **fiscal / economy staff**, **campaign**, **world chat** if you add related commands later.

## Web admin surface (feature ideas for commands)

Mirror workflows from `web/src/app/(app)/admin/`:

| Area | Route | Bot direction |
|------|--------|----------------|
| Overview / ops | `/admin`, `/admin/operations` | Help text, permission self-check, deep links to web |
| Elections | `/admin/elections` | Lookups: open races, phases, filing windows; later: gated phase nudges (needs bridge) |
| Members | `/admin/members` | `/whois` by mention or snowflake → profile + grants summary (read-only) |
| Economy | `/admin/economy` | Read-only balances if queries exist; writes only via approved RPCs |
| Party leadership | `/admin/party-leadership` | Status + link; finalize-style actions only via secured bridge matching `party_finalize_officer_election` rules |
| Activity | `/admin/activity` | Optional: push digest to a staff channel on a schedule (separate worker) |

Implementation references: `web/src/app/actions/elections.ts` (election mutations), `web/src/lib/staff-access.ts`, `web/src/lib/profile-roles.ts`.

## Deliverables (what to build)

1. **Repository layout** — Node **TypeScript** project (e.g. `pnpm` or `npm`), `discord.js` v14+ **or** official **Interactions** HTTP handler if you prefer stateless slash commands behind a public URL.
2. **Configuration** — `.env.example`: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` (if interactions URL), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `STAFF_GUILD_ID`, `ALLOWED_COMMAND_ROLE_IDS` (comma-separated Discord role snowflakes), `LOG_LEVEL`.
3. **Permission model** — Only users who pass **both** (a) Discord guild role allowlist (optional but recommended) **and** (b) Imperium staff check via `profiles` + `government_role_grants` / `office_role` may run privileged commands. Log all privileged invocations (Discord user id, command, result).
4. **Commands (MVP)**  
   - `staffping` or `staffhelp` — confirms bot is alive and caller’s Imperium staff status (no DB leak for non-staff).  
   - `whois <user>` — resolve Discord → `profiles` row (character name, party, district/state if set, office_role, grant keys summary).  
   - `elections` (subcommand: `open` / `list`) — read-only list of non-closed elections with ids for cross-reference with web admin.  
5. **Documentation** — `README.md`: how to invite the bot, required OAuth scopes / intents (`GuildMembers` if you resolve members by id in large guilds), how to run locally, deployment note (Fly.io, Railway, etc.), **security** section on service role handling.
6. **Non-goals for first iteration** — Mass DMs, deleting messages, assigning Discord roles based on game office (possible later), any economy write without a designed RPC.

## Quality bar

- Type-safe SQL access (Supabase JS client with generated types optional).
- No secrets in logs; rotate tokens if leaked.
- Rate-limit slash command usage per user if you expose expensive queries.
- When in doubt, **read-only** until a migration + RPC explicitly supports the automation.

## Success criteria

Staff can run **whois** and **election list** from Discord without opening Supabase SQL editor; privileged writes are either out of scope or implemented through a **signed, audited** bridge aligned with `is_staff_admin` semantics in migrations.
