# Every integration over MCP

Design: https://claude.ai/artifact/8SWRasPZ2DPeoxQBiSHhBg (approved by Zak, Nov 15 2026).
Build Board: Orders 90 (design) to 98.

The runner speaks only MCP. Each server has a profile in code (`core/mcp-rules.ts`): its address,
the exact scopes to ask for, its read tools, and later its write tools with the gateway action
type each becomes. A business connects its own account with a Connect button and never edits a
profile. Writes go through the gateway and start at Draft. Tenancy is a separate epic.

Slices: 1 runner speaks only MCP, 2 credential vault, 3 profiles and connection registry,
4 Notion, 5 Mercury, 6 Gmail (reads and drafts; send stays off), 7 Shopify on our own server,
8 cleanup.

## Slice 1: the runner speaks only MCP

Every read and calculate call goes through the in-app MCP server (`core/tools/mcp-host.ts`): a
JSON-RPC `tools/call` over the tool list, crossing as JSON, read back with the same
`parseRpc`/`toolPayload` that read Klaviyo's replies. Callers use `core/tools/call.ts`
(`callTool`, `listTools`): the runner's explore and playbook steps, the playbook dry run and the
builder's tool check. The server serves only tools that read or work numbers out (not reports,
actions or Claude's own web tools), checks every input again, passes the caller's context in
`_meta["one-two/ctx"]`, and drops numbers that aren't finite. A tool's error comes back as it was.
`npm run check:mcp` fails if anything else calls a tool's `run`.

Report and action tools stay out of MCP on purpose: code delivers reports after a run, and
actions are staged for the gateway.

## Slice 2: the credential vault

| Rule | Where |
|---|---|
| Sign-ins sealed with AES-256-GCM under `MCP_SECRET_KEY`, a key of its own | `core/vault.ts`, `integrations/mcp.ts` |
| Each sealed value names its key (`v2.<key id>.…`); `MCP_SECRET_KEY_OLD` still opens what it sealed; rows move onto the current key when read, or all at once with **Re-lock now** | `seal`, `open`, `readSecret`, `resealAll` |
| Slice 6 rows (key made from the service role key) open once and are moved; nothing new is sealed that way | `legacyKey` |
| Without `MCP_SECRET_KEY` nothing can be connected or renewed | `VAULT_MISSING` |
| Only the vault's two users import it: the MCP client (reads) and the gateway (future writes) | `eslint.config.mjs` |
| Ask for the profile's scopes only, cut to what the server supports; never the server's whole list | `MCP_SERVERS[id].scopes`, `pickScopes` |
| Token values never reach a saved error, the log or the browser | `scrubSecrets` |
| Requests carrying a code, token or client secret never follow a redirect; only discovery documents do | `fetchJson`, `rpc` |
| A rotated refresh token replaces the old one at once | `readTokens` |
| A failed renewal or a 401/403 pauses the connection (`paused_at`) until Zak signs in again | `pause`, `accessToken` |
| Disconnect asks the server to cancel the sign-in (RFC 7009) where it has a revoke address, then forgets it | `disconnectMcp` |
| Sign-in log without token values: connected, refreshed, refresh_failed, refused, revoked, revoke_failed, disconnected, resealed | `mcp_connection_events` |

Migration: `supabase/migrations/20261126090000_mcp_vault.sql` (`mcp_connections.paused_at`,
`mcp_connection_events`, RLS on, no policies).

### Changing the key

1. In Vercel, copy the value of `MCP_SECRET_KEY` into a new variable `MCP_SECRET_KEY_OLD`.
2. Set `MCP_SECRET_KEY` to a new value (`openssl rand -base64 32`), redeploy.
3. On Connections, open any MCP connection and tap **Re-lock now**.
4. Delete `MCP_SECRET_KEY_OLD`, redeploy.

## Slice 3: server profiles and the tool check

Each server's profile in `core/mcp-rules.ts` (`MCP_SERVERS`) holds its address, the scopes to ask
for, its read tools, its write tools with the gateway action type each becomes (none yet), and
who should sign in. Only a pull request changes a profile; a business only connects its account.
The Connections page and the floor's health read every server from this registry.

The tool check: when Zak signs in, the server's `tools/list` is fingerprinted (each read tool's
input schema, key order ignored) and saved in `mcp_connections.tools_seen`. Before a call, at most
every `TOOL_CHECK_HOURS` (6), the list is compared again (`checkTools`). A read tool that's gone or
whose inputs changed pauses the server with a note saying which, logged as `tools_changed`, until
Zak looks and signs in again, which accepts the tools as they are then.

Migration: `supabase/migrations/20261127090000_mcp_tool_check.sql` (`tools_seen`,
`tools_checked_at`, two new log events). The code reads the new columns, so apply it before merging.

## Slice 4: Notion on our own server

Notion's hosted MCP server signs in with OAuth as a person, reaches everything that person can see
and has no read-only switch. So Notion runs on our own MCP server, in the app
(`integrations/notion-server.ts`), over Notion's REST API (`integrations/notion-api.ts`) with the
agents' internal integration key. That key sees only the pages and databases shared with the
integration (Zak's choice, 2026-11-16).

- The profile (`MCP_SERVERS.notion`) has `auth: "token"`: Zak pastes the integration's key once on
  Connections. `saveMcpKey` checks its shape (`looksLikeNotionKey`), asks Notion whose it is
  (`users/me`, must be a bot), and seals it in the vault. It is never shown again. `NOTION_TOKEN`
  is gone from the code and should be deleted in Vercel.
- Two read tools agents may be granted: `notion_page_text` and `notion_row_on`.
- Four report tools (`reportTools`, `mayReport`): `notion_create_page`, `notion_create_row`,
  `notion_update_row`, `notion_archive_row`. These write report pages and rows into One Two's own
  workspace, like an email to Zak. Code calls them after a run (briefs, books pages, lead lists,
  Build Board cards). A model never calls one, and a hosted server can never have them.
- Every call goes through `callLocalTool` in `integrations/mcp.ts`. It opens the key for that call,
  sends a JSON-RPC `tools/call` to the server as JSON, and reads the reply with the same code that
  reads a remote server's reply. Errors are scrubbed. A 401 from Notion pauses the connection
  until a new key is pasted. A 403 or 404 means a page isn't shared, which doesn't pause it.
- The server checks every request again (`checkNotionArgs` in `core/notion-blocks.ts`). Ids must be
  32 hex characters, at most 100 blocks are sent, and only the profile's tools are served.
- There is no tool check for our own server, because its tools ship with the app.
- Disconnect forgets the key. Notion has no API to cancel an integration key: to make an old key
  stop working, refresh the integration's secret in Notion.
- Lint: only `notion-server.ts` imports `notion-api.ts`, and only `integrations/mcp.ts` imports
  `notion-server.ts`. Everything else uses `integrations/notion.ts`.

No migration.
