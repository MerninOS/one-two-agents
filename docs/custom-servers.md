# Custom servers: add your own MCP server

Design: https://claude.ai/artifact/WG5cPBcJmAPv4bMZ3upQRr (approved by Zak, Nov 17 2026, with every
recommendation). Build Board: Orders 110 (design) to 114.

When an agent needs a tool the built-in connectors don't have, the owner can add any MCP server by
its address. Nobody at One Two reviewed a custom server's code, so it gets every guard a built-in
server has plus tighter limits. The limits are code (`core/custom-mcp-rules.ts`); the profile is a
row the owner edits (`mcp_custom_servers`). Its sign-in sits in `mcp_connections` under the same id
(`c_` and 8 letters or digits), sealed in the vault like every other.

Decisions (Zak, 2026-11-17): custom servers are read-only now (writes later only as Draft-forever
cards, with their own yes); warn but don't block when a money or email agent gets a custom tool;
only the owner adds servers, from Connections with Controls on, and heads may ask for a service but
never give an address; Find a tool shows a short list of known servers (not vetted); Piper's
analytics will be PostHog; one business per deployment, tenancy is its own epic.

Slices: 1 add a server by URL on Connections, 2 grant custom read tools to agents, 3 Find a tool and
connector requests, 4 (later, own yes) custom write tools at Draft forever.

## Slice 1: add a server by URL on Connections

Connections has a **Your servers** row under the built-in ones, with an **Add a server by URL** tile.

| Step | What happens | Where |
|---|---|---|
| Add | Name, address, and how it signs in (its own page, or a key). The owner confirms the warning before anything is saved. Needs Controls on. At most 10 servers. | `AddServerForm`, `customAdd`, `addCustomServer` |
| Address check | https on port 443, a public host name (no IP address, localhost, single-label or internal name like `.local`, no user or password in it). The name's addresses must all be public (not private, loopback, link-local, CGNAT, multicast or reserved), checked again right before every request. A built-in server's address is refused. | `checkAddress`, `isPublicIp`, `assertPublic` |
| Sign-in details (own page) | Read from the server's protected-resource document, never following a redirect, and every address they name (sign-in page, token, registration, revoke) must pass the address check. The server must allow dynamic client registration. | `discover(url, true)` |
| Scopes | The scopes the server offers, none ticked. Only ticked ones are asked for; when the server lists none, none are asked for by name. The token is bound to the server's address (RFC 8707). | `ScopesAndConnect`, `saveCustomScopes`, `startConnect` |
| Key | Sent only to the server's own address as a bearer token. The server must answer `initialize` and `tools/list` with it before it's kept. Never shown again. | `saveCustomKey` |
| Tools | The server's list as accepted (name, title, description, inputs, read-only claim), at most 200. Every tool starts off. | `readToolList`, `mcp_custom_servers.tools` |
| Turn on | Only a tool the server marks read-only (and not destructive) whose required inputs are plain values. The owner sets the name and the one line agents read instead of the server's description, and may pin inputs (text up to 300 characters, no links or line breaks; numbers; true/false; one of the server's choices). Turning a tool on grants it to no agent. Needs Controls on. | `cantTurnOn`, `checkLabel`, `checkLine`, `checkPins`, `setCustomTool` |
| Tool check | A fingerprint of everything an agent relies on (name, title, description, inputs, read-only claim) for each turned-on tool. Any change, or a tool gone, pauses the server with what changed; the page shows the new version marked Changed. **Accept the change** keeps names, lines and pins, takes the new version, and turns off anything gone or no longer read-only. New tools arrive off. Slice 2 runs it before every run that uses the server; slice 1 has **Check tools now**. | `customFingerprint`, `checkCustomTools`, `acceptTools`, `checkCustomServer` |
| Pause | **Pause for every agent** at any time, without Controls. Running again needs Controls and never clears a pause for a refused sign-in or changed tools. | `pauseCustom` |
| Remove | Cancels the sign-in where the server has a revoke address, forgets it, and deletes the row. Allowed without Controls. The log stays. | `removeCustomServer` |
| Log | Added, connected, tool on or off, paused, resumed, tools changed, checked or accepted, revoked, disconnected. Never a token. | `mcp_connection_events` |

Shorter limits than built-in servers: 15 seconds a call. Calls carry the token or key with
`redirect: "error"`, as for built-in servers. Between the address check and the request a host's
DNS could change; the check runs right before each request to keep that window small.

No agent can use a custom tool in this slice.

Migration: `supabase/migrations/20261130090000_custom_mcp_servers.sql` (`mcp_custom_servers`, RLS on,
no policies; six new sign-in log events). Apply it before merging: Connections reads the table.

### Adding a server (click by click)

1. In the Control Room, open **Connections** in the menu.
2. Under **Your servers**, tap **Add a server by URL**.
3. Type a **Name** (for example PostHog) and paste the **Server address** from the service's docs.
4. Pick **On its own sign-in page** if the docs say to sign in, or **With a key the service gave you**.
5. Tap **Add server**, read the warning, and tap **I trust it, add it**.
6. Own sign-in page: tick only the scopes reading needs, tap **Connect**, and say yes on the
   service's page. Key: paste it and tap **Lock key in the vault**.
7. Under **Tools**, tap **Turn on** next to a tool marked **Reads**, check the name and line agents
   will see, pin any input that should never change, and tap **Turn on**.
