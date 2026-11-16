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
