# Every integration over MCP

Design: https://claude.ai/artifact/8SWRasPZ2DPeoxQBiSHhBg (approved by the owner, Nov 15 2026).
Build Board: Orders 90 (design) to 98.

The runner speaks only MCP. Each server has a profile in code (`core/mcp-rules.ts`): its address,
the exact scopes to ask for, its read tools, and later its write tools with the gateway action
type each becomes. A business connects its own account with a Connect button and never edits a
profile. Writes go through the gateway and start at Draft. Tenancy is a separate epic.

Servers a business adds itself, by address, are in `docs/custom-servers.md`.

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
`_meta["operator/ctx"]`, and drops numbers that aren't finite. A tool's error comes back as it was.
`npm run check:mcp` fails if anything else calls a tool's `run`.

Report and action tools stay out of MCP on purpose: code delivers reports after a run, and
actions are staged for the gateway.

## Slice 2: the credential vault

| Rule | Where |
|---|---|
| Sign-ins sealed with AES-256-GCM under the org's own data key, bound to the org (`v3`); the data key is kept in `org_keys` wrapped by `MCP_SECRET_KEY`, a key of its own (docs/tenancy.md, slice 4) | `core/vault.ts`, `integrations/mcp.ts` |
| Each sealed value names its key (`v2.<key id>.…`); `MCP_SECRET_KEY_OLD` still opens what it sealed; rows move onto the current key when read, or all at once with **Re-lock now** | `seal`, `open`, `readSecret`, `resealAll` |
| Without `MCP_SECRET_KEY` nothing can be connected or renewed | `VAULT_MISSING` |
| Only the vault's two users import it: the MCP client and the gateway | `eslint.config.mjs` |
| Ask for the profile's scopes only, cut to what the server supports; never the server's whole list | `MCP_SERVERS[id].scopes`, `pickScopes` |
| Token values never reach a saved error, the log or the browser | `scrubSecrets` |
| Requests carrying a code, token or client secret never follow a redirect; only discovery documents do | `fetchJson`, `rpc` |
| A rotated refresh token replaces the old one at once | `readTokens` |
| A failed renewal or a 401/403 pauses the connection (`paused_at`) until the owner signs in again | `pause`, `accessToken` |
| Disconnect asks the server to cancel the sign-in (RFC 7009) where it has a revoke address, then forgets it | `disconnectMcp` |
| Sign-in log without token values: connected, refreshed, refresh_failed, refused, revoked, revoke_failed, disconnected, resealed | `mcp_connection_events` |

Migration: `supabase/migrations/20261126090000_mcp_vault.sql` (`mcp_connections.paused_at`,
`mcp_connection_events`, RLS on, no policies).

### Changing the key

1. In Vercel, copy the value of `MCP_SECRET_KEY` into a new variable `MCP_SECRET_KEY_OLD`.
2. Set `MCP_SECRET_KEY` to a new value (`openssl rand -base64 32`), redeploy.
3. On Connections, open any MCP connection and tap **Re-lock now**. This rewraps the org's data key
   with the new `MCP_SECRET_KEY`; the sign-ins themselves stay on the data key.
4. Delete `MCP_SECRET_KEY_OLD`, redeploy.

## Slice 3: server profiles and the tool check

Each server's profile in `core/mcp-rules.ts` (`MCP_SERVERS`) holds its address, the scopes to ask
for, its read tools, its write tools with the gateway action type each becomes (none yet), and
who should sign in. Only a pull request changes a profile; a business only connects its account.
The Connections page and the floor's health read every server from this registry.

The tool check: when the owner signs in, the server's `tools/list` is fingerprinted (each read tool's
input schema, key order ignored) and saved in `mcp_connections.tools_seen`. Before a call, at most
every `TOOL_CHECK_HOURS` (6), the list is compared again (`checkTools`). A read tool that's gone or
whose inputs changed pauses the server with a note saying which, logged as `tools_changed`, until
The owner looks and signs in again, which accepts the tools as they are then.

Migration: `supabase/migrations/20261127090000_mcp_tool_check.sql` (`tools_seen`,
`tools_checked_at`, two new log events). The code reads the new columns, so apply it before merging.

## Slice 4: Notion on our own server

Notion's hosted MCP server signs in with OAuth as a person, reaches everything that person can see
and has no read-only switch. So Notion runs on our own MCP server, in the app
(`integrations/notion-server.ts`), over Notion's REST API (`integrations/notion-api.ts`) with the
agents' internal integration key. That key sees only the pages and databases shared with the
integration (the owner's choice, 2026-11-16).

- The profile (`MCP_SERVERS.notion`) has `auth: "token"`: the owner pastes the integration's key once on
  Connections. `saveMcpKey` checks its shape (`looksLikeNotionKey`), asks Notion whose it is
  (`users/me`, must be a bot), and seals it in the vault. It is never shown again. `NOTION_TOKEN`
  is gone from the code and should be deleted in Vercel.
- Two read tools agents may be granted: `notion_page_text` and `notion_row_on`.
- Four report tools (`reportTools`, `mayReport`): `notion_create_page`, `notion_create_row`,
  `notion_update_row`, `notion_archive_row`. These write report pages and rows into the business's own
  workspace, like an email to the owner. Code calls them after a run (briefs, books pages, lead lists,
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

## Slice 5a: Mercury reads over Mercury's MCP server

Mercury's hosted server (`https://mcp.mercury.com/mcp`) signs in with OAuth and dynamic client
registration. Every write tool needs its own scope (`transactions:request`, `transactions:update`,
`receipts:manage` and so on), and "a connection without a tool's required scope cannot use that write
tool" (Mercury's MCP docs). So the agents' sign-in (`MCP_SERVERS.mercury`) asks for `read` and
`offline_access` only. Even if code tried to call a write tool, that token can't use it, and
`mayCall` names only five read tools: `getAccounts`, `listTransactions`, `listCategories`,
`getTransactionById` and `getOrganization`.

- `integrations/mercury.ts` keeps its exports (`mercuryCash`, `mercuryTransactions`,
  `mercuryCategories`, `mercuryTransaction`) and calls the server through `callMcpTool`. The tool
  check, pausing, refresh and the vault all work as they do for Klaviyo. `hasMercury()` is async
  now, because it reads the sign-in row.
- Replies are read in `core/mercury-rules.ts`, which is pure and tested. A row without an id or a
  finite amount is dropped, never counted as $0. The server may cut a page (`truncatedAt`); the
  same call is then asked again with that limit. If the server says it dropped the date filter
  (`_retryNote`), those rows are not for the asked dates and are not used.
- Connections shows which organization was signed in (`getOrganization`, name only), so a sign-in
  to the household account is easy to spot.
- `MERCURY_API_TOKEN` is gone from the code. `MERCURY_ACCOUNT_IDS` still picks the accounts that count
  as cash.
- Writes (receipt, category, memo) still go through the gateway with `MERCURY_WRITE_TOKEN`. Slice 5b
  moves them to a second, gateway-only sign-in that asks only for the write scopes they need.

No migration.

## Slice 5b: gateway writes on their own Mercury sign-in

The owner's choice (2026-11-16): split the write. Mercury's MCP server can set a charge's category and
memo (`updateTransaction`, scope `transactions:update`). It can't attach a file to a chosen charge:
`createReceiptUploadUrl` + `matchReceipt` upload a receipt and let Mercury's OCR pick the charge,
and there is no way to undo a wrong match. So:

- **Category and memo** go through a second sign-in to the same server, `MCP_SERVERS.mercury_write`.
  It asks for `transactions:update` and `offline_access` only, with no payment, transfer, receipt,
  budget or reimbursement scope. Its one write tool is `updateTransaction`, and it has no read
  tools. The owner connects it under Connections → Mercury → Mercury writes.
- **Receipt files** stay on `MERCURY_WRITE_TOKEN` (`integrations/mercury-write.ts`, now
  `attachReceipt` only), attached to the exact charge an approver approved.
- `callWriteTool` in `integrations/mcp.ts` calls only a profile's write tools. Lint lets only
  `core/gateway` import it, and `check:mcp` checks that too. The gateway still re-checks the
  charge live (through the read sign-in) before writing, and checks that both ways in are set up
  before it writes anything, so a change never lands half done.
- The tool check watches write tools as well (`checkedTools`): if `updateTransaction` changes its
  inputs, the write sign-in pauses until the owner signs in again.

No migration.

## Slice 6: Gmail on our own server, signed in with Google

Google's own Gmail MCP server (`gmailmcp.googleapis.com`) is a Developer Preview: it needs the
preview program, your own OAuth client marked for AI agents, and has no self-registration. It also
can't hand over an attachment's bytes, and Quinn reads receipt PDFs. So Gmail runs on our own server
in the app, like Notion:

- **`integrations/gmail-server.ts`** speaks MCP's JSON-RPC and serves four tools: `gmail_search`,
  `gmail_message`, `gmail_attachment` and `gmail_create_draft`. It serves only the tools of the
  profile it is opened for (`checkedTools`), so the read sign-in can never reach the draft tool.
  There is no send tool, and none may be added. Every input is checked again (`checkGmailArgs` in
  `core/gmail-rules.ts`): message ids before they go into a URL, one plain recipient address with
  no display name, and a subject that can't add a header.
- **`integrations/gmail-api.ts`** is Gmail's REST API: search, read, attachment, create draft. No
  send, trash, modify or label call (`check:mcp` checks the file). Only the Gmail server imports it,
  and only `integrations/mcp.ts` imports the server (lint and `check:mcp` enforce both).
- **Two Google sign-ins**, each a profile in `core/mcp-rules.ts` with `auth: "google"`:
  - `gmail_read` ("Gmail (read only)"): `gmail.readonly` alone. Quinn's receipt search
    (`integrations/gmail-read.ts`, through `callMcpTool`).
  - `gmail` ("Gmail drafts"): `gmail.compose` alone, one write tool, `gmail_create_draft`. Only the
    gateway uses it (`callWriteTool`), after an approver approves a draft; the address always comes from
    the lead's row. The owner sends every email from Gmail.
- **Signing in:** Connect sends the owner to Google's own page with the business's OAuth client
  (`GMAIL_CLIENT_ID`), PKCE, `access_type=offline` and `prompt=consent`. Google's addresses are fixed
  in code (`GOOGLE_AUTH`); there is no discovery or registration. The client secret stays in Vercel
  (`GMAIL_CLIENT_SECRET`) and is never put in the vault, the cookie or the browser. After the code is
  traded, the granted scopes must be exactly the profile's (`scopeProblem`): a box left unticked, or
  an older grant riding along, cancels the sign-in at Google and nothing is kept. The mailbox it
  belongs to is read and shown on Connections. A token Google stops accepting pauses the sign-in.
- **Disconnect** cancels the refresh token at Google. Both sign-ins use the same OAuth client, so
  Google may cancel the other one too; it then shows Paused and the owner signs it in again.
- The tool check doesn't run for our own servers: their tools are in this repo.
- Removed: `GMAIL_REFRESH_TOKEN` and `GMAIL_RECEIPTS_REFRESH_TOKEN` (their refresh tokens are now in
  the vault), `accessToken` and the REST calls in `integrations/gmail.ts` and `gmail-read.ts`.

Setup: add `https://<Control Room domain>/connections/gmail_read/callback` and
`/connections/gmail/callback` as Authorized redirect URIs on the OAuth client (a Web application
client). A consent screen in Testing with user type External makes Google's refresh tokens expire
after 7 days; Internal (Workspace) or In production doesn't.

No migration.

## Slice 7: Shopify on our own server

Shopify's own MCP servers are for storefronts and building apps, not a read-only Admin view of one
store, so Shopify runs on our own server in the app, like Notion and Gmail:

- **`core/shopify-rules.ts`** (pure) holds the rules and core's queries (a day's orders); a template
  pack adds its own fixed queries in its code, listed in `templates/registry.ts`.
  **`core/shopify-queries.ts`** lists them all, one per tool, and builds each tool's variables from
  checked inputs (`shopifyVariables`). No tool takes GraphQL or a search string: a pack's searches
  and settings are fixed in its code, dates must
  be `YYYY-MM-DD`, cursors must look like cursors. `assertReadOnly` refuses anything but a single
  named query, and `scripts/validate-graphql.mjs` still checks every document against Shopify's
  schema. Order reads carry no customer names, emails or addresses.
- **`integrations/shopify-server.ts`** serves `shopify_green_lots`, `shopify_stock_coffees`,
  `shopify_shop_settings`, `shopify_recent_orders`, `shopify_board_orders` and
  `shopify_orders_between`. **`integrations/shopify-api.ts`** is the only file that posts to
  Shopify (`check:mcp` checks that). Lint and `check:mcp` make sure only the server imports it, and
  only `integrations/mcp.ts` imports the server. The facades in `integrations/shopify/*` call
  `callMcpTool("shopify", …)` and keep their shapes, so agents didn't change.
- **The key** (the read-only app's Admin API access token, or a Dev Dashboard app's client secret
  with `SHOPIFY_CLIENT_ID` in Vercel) is pasted on Connections into the vault. Before it is kept, the
  server asks Shopify which shop it opens and every scope the app was granted: a key for another
  store, or one whose app has **any** scope that isn't a read, is refused. A key Shopify stops
  accepting pauses the connection.
- Removed: `integrations/shopify/client.ts`, `SHOPIFY_ADMIN_ACCESS_TOKEN` and `SHOPIFY_CLIENT_SECRET`.
  `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`, `SHOPIFY_CLIENT_ID` and `SHOPIFY_STOCK_COLLECTION`
  stay: none is a secret.

No migration.

## Slice 8: cleanup

- **One credential store.** The last service key outside the vault, the gateway's Mercury receipt
  token (`MERCURY_WRITE_TOKEN`), moved in: it is the `mercury_files` profile, a key pasted under
  Connections → Mercury → Mercury receipt files, served by our own small server
  (`integrations/mercury-files-server.ts`) with one write tool, `mercury_attach_receipt`. It is
  checked on paste (shape, and Mercury must not answer 401). `integrations/mercury-write.ts` is
  gone. Vercel settings now hold only the app's own infrastructure (Supabase, Claude, Resend for
  emails to the owner, `MCP_SECRET_KEY`, Google's OAuth client) and non-secret ids; `check:mcp` fails if
  an old service token comes back into `core/env.ts`.
- **One tool path.** Agents read through `callMcpTool`; code writes reports through report tools;
  every other write is a profile's write tool through `callWriteTool`, now on every kind of server
  (hosted, Google, or our own with a key), still importable only by `core/gateway`.
- The slice 6 vault format (a key made from the service role key) is no longer opened: every row
  was on `MCP_SECRET_KEY` before this shipped (`legacyKey` removed).
- `isOauth` is now `isHosted` (hosted servers that sign in on their own page).
- CLAUDE.md's hard rules talk about servers, profiles, one tool path and one credential store.

No migration.
