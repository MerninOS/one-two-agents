# Build a connector

A connector is an MCP server with a **profile**: what it signs in with, the exact scopes it asks
for, and every tool code may call, by name. A business connects its own account on Connections; it
never edits the profile. The rules are in `CLAUDE.md`; the full design is `docs/mcp-everywhere.md`.

If a business only needs a read tool from a server that already exists, it can add that server as a
**custom server** on Connections without any code (`docs/custom-servers.md`). Build a connector when
it should ship with OPERATOR for everyone.

## 1. A hosted server, or our own

- **Hosted** (the service runs an MCP server, like Klaviyo and Mercury): use it when its read tools
  fit and its scopes can be narrowed to what the profile needs.
- **Our own** (like Notion, Gmail and Shopify): when the hosted one reaches too far, or there isn't
  one. Write `integrations/<name>-server.ts`. It is the only file that calls the service's API, and
  only `integrations/mcp.ts` reaches it: add both to `eslint.config.mjs` like the others.

## 2. The profile

Add an entry to `MCP_SERVERS` in `core/mcp-rules.ts`:

- `auth` (`oauth` or `key`), `url` for a hosted server, `scopes`: the narrowest that cover the tools;
  a sign-in or key that carries more is refused.
- `readTools`: the tools agents may read through `callMcpTool`. A tool the server adds later does
  nothing until a pull request names it here.
- `reportTools`: only for our own servers, written by code after a run, never by a model.
- `writeTools`: almost always empty. A write is a gateway action type: it starts at Draft (an approval
  card) and goes through `core/gateway`, never an agent (see the hard rules).
- `signInHint`: one line shown next to Connect.

## 3. Tools agents see

Give each read tool an entry in `core/tools/catalog.ts` with plain inputs. A tool's reply is untrusted data: it never chooses a
recipient, URL, product or category.

## 4. Test without an account

`npm run check:mcp` tests profiles and the tool path with no network. Add cases for your profile:
the scopes, a refused extra scope, a tool that isn't named. Then `npm run check` and
`npm run check:all`.

## 5. The pull request

Say which account type you tested with and the scopes it asked for. Changes to `core/mcp-rules.ts`
and `integrations/mcp.ts` need a maintainer's review (`.github/CODEOWNERS`).
