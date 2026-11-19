# Custom servers: add your own MCP server

Design: https://claude.ai/artifact/WG5cPBcJmAPv4bMZ3upQRr (approved by the owner, Nov 17 2026, with every
recommendation). Build Board: Orders 110 (design) to 114.

When an agent needs a tool the built-in connectors don't have, the owner can add any MCP server by
its address. Nobody at the business reviewed a custom server's code, so it gets every guard a built-in
server has plus tighter limits. The limits are code (`core/custom-mcp-rules.ts`); the profile is a
row the owner edits (`mcp_custom_servers`). Its sign-in sits in `mcp_connections` under the same id
(`c_` and 8 letters or digits), sealed in the vault like every other.

Decisions (the owner, 2026-11-17): custom servers are read-only now (writes later only as Draft-forever
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
| Tool check | A fingerprint of everything an agent relies on (name, title, description, inputs, read-only claim) for each turned-on tool. Any change, or a tool gone, pauses the server with what changed; the page shows the new version marked Changed. **Accept the change** keeps names, lines and pins, takes the new version, and turns off anything gone or no longer read-only. New tools arrive off. It runs right before every run that uses the server (slice 2), and from **Check tools now**. | `customFingerprint`, `checkCustomTools`, `acceptTools`, `checkCustomServer` |
| Pause | **Pause for every agent** at any time, without Controls. Running again needs Controls and never clears a pause for a refused sign-in or changed tools. | `pauseCustom` |
| Remove | Cancels the sign-in where the server has a revoke address, forgets it, and deletes the row. Allowed without Controls. The log stays. | `removeCustomServer` |
| Log | Added, connected, tool on or off, paused, resumed, tools changed, checked or accepted, revoked, disconnected. Never a token. | `mcp_connection_events` |

Shorter limits than built-in servers: 15 seconds a call. Calls carry the token or key with
`redirect: "error"`, as for built-in servers. Between the address check and the request a host's
DNS could change; the check runs right before each request to keep that window small.

Slice 1 gave no agent a custom tool; slice 2 does, below.

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

## Slice 2: grant custom read tools to agents

A turned-on tool shows up in the builder's Tools step as a tile of its own, named after its
server, next to the built-in connections. Ticking it grants it like any other read tool: the
agent's next version is a draft until **Try it** and **Go live**.

| Step | What happens | Where |
|---|---|---|
| Grant | A custom tool's id is its server's id, two underscores, and its name made safe (`c_ab12cd34__query_insights`). A spec may hold at most 20. Saving refuses one that isn't turned on now. Heads can't hand one out in a proposal: only the owner grants them, in the builder. | `customToolId`, `readSpec`, `customGone`, `hireDraft` |
| Warning | The server's tile repeats the warning that someone else runs it. When the agent also reads money or email (any Mercury or Gmail tool), the tile says so: warn, don't block. | `ConnStep` in `Flow.tsx` |
| Before a run | For each server the spec uses: still on Connections, connected, not paused, and the tool check passes now (a passing check isn't logged, so the log keeps what matters). A server that fails offers the run none of its tools, and the run's summary says which and why. Only tools still on and exactly as accepted are built. | `loadCustomTools`, `readyCustomServers`, `checkCustomServer(id, false, { quiet })` |
| Inputs | Only inputs that aren't pinned and are plain values are offered (text at most 300 characters and no links, numbers, true/false, one of the server's choices), checked in code. Pins are laid over them, and the whole lot may weigh 2 KB. | `customParams`, `checkInput`, `customArgs` |
| Call | Through the in-app MCP host like every read tool, then to the server with the token or key from the vault. The tool must still be on and unchanged at the moment of the call. 15 seconds a call; at most 20 custom calls a run. | `customDefs`, `callCustomTool`, `MAX_CUSTOM_CALLS` |
| Reply | Text, cut to 20,000 characters (and to the runner's limit for the model), handed over as untrusted data, with no numbers worked out in code and no rows an action could name. The run's rules add a line saying so. | `customReply`, `CUSTOM_RULES` |
| Playbooks | Custom tools are never playbook steps: each run calls them live, after the tool check. In a playbook run they stay callable once the playbook's data is in. | `runExplore` |
| Replay | Every call's inputs and reply show in the run replay, like any tool. | `run_steps` |
| Connections | A server's page says which agents have its tools. | `CustomDetail` |

Only `core/tools/custom.ts` may import `callCustomTool` (lint). No migration.

### Giving a custom tool to an agent (click by click)

1. Turn the tool on first: **Connections**, **Your servers**, the server, **Turn on** next to the tool.
2. Open **Crew**, tap the agent, then **Edit** (or **Build**, then the agent).
3. Go to the **Tools** step. Tap the tile with the server's name.
4. Read the note on the tile, then tick the tool under **Can read**.
5. Tap **See what it finds today** to check it (a tool that needs inputs is tried only during a run).
6. **Save**, then **Try it**. If the run looks right, tap **Go live**.


## Slice 3: Find a tool and connector requests

**Find a tool** (`/connections/find`) is where you go when an agent needs something no connection
has. It is opened by a yes on a new-tool proposal (`?for=<proposal>`, which fills the proposal's
words into the ask), by **Find a tool** under the builder's Tools step and under Try it
(`?agent=<id>`, with a link back to that agent's Tools step), and from Connections. Three ways:

1. **Use a connection you have.** The built-in connections that are set up, with what they read,
   and your servers that are connected with tools turned on. You still grant on the Tools step.
2. **Add a server by its address.** A short list of servers we know of (`KNOWN_SERVERS` in
   `core/connector-rules.ts`), each marked **Not vetted**. **Add** opens Connections with the name
   and address filled in (`/connections?s=new&known=<key>`); the address is looked up in that list
   in code, never taken from the link, an agent or a page. The warning and every check still run.
3. **Ask for a built-in connector.** Service name and what agents should read, your words only
   (no links). One request per service (`connector_requests`, names compared as lowercase letters
   and digits), counted, newest 20 asks kept. The first ask adds a Build Board card (Backlog, Owner
   Claude, Track Agent builder, in the board's card shape); later asks raise the count in the
   card's title ("Connector: PostHog (3 asks)"). Adding a server by address also counts as an ask
   for that service (under the known name when the address is on the list).

**Asked for** lists the requests, most asked first. **A built-in connector is ready** (shown when
the service is a built-in connection in the list) and **Close** close a request and move its card
to Done; a new ask opens it again. Neither changes any agent, so neither needs Controls on.

Replaced: the Proposals page's **Build list** and **Mark built**, and the Build Board card a yes on
a new tool used to make (`boardCard`). The one new tool already said yes to (website analytics,
from Avery) moved to PostHog's request with its card.

Migration `20261201090000_connector_requests.sql` (table, RLS on with no policies, and that one row).

### Finding a tool (click by click)

1. Open **Connections** and tap **Find a tool** in the line under the title (or tap **Find a tool**
   under an agent's Tools step, or under its Try it result).
2. If a connection you have covers it, tap it to see its tools, then grant it on the agent's
   **Tools** step.
3. If a server on the list fits, tap **Docs** to read about it, then **Add**. On Connections, check
   the name and address, pick how it signs in, tap **Add server**, read the warning and tap **I trust
   it, add it**. Then follow slice 1 and 2 above to sign in, turn tools on and grant them.
4. Otherwise, under **Ask for a built-in connector**, type the service (like Square) and what agents
   should read from it, and tap **Ask for it**. It shows under **Asked for**, with **Card** opening
   its Build Board card.
5. When a built-in connector for it is merged, tap **A built-in connector is ready** on its request
   (or **Close** if you no longer need it).

## Goal numbers: measure a goal with a number from your own tool (card 133)

A turned-on tool can be marked **Use as a goal number** on its server's page. The number then shows
in the goal picker under **From your own tools**, and a goal on it is read the same way every time.

| Step | What happens | Where |
|---|---|---|
| Set up | The owner gives the field in the reply (up to three names joined by dots, like `numbers.lowest_days_of_cover`), a name, what it counts (a count, dollars, days or months) and the shape (a level to stay at or above, or a total to reach by a date). Owner only, Controls on. Every required input must be pinned first, because code calls the tool on its own. Stored on the tool's row (`tools_on.<tool>.number`); no new table. | `GoalNumberForm`, `customNumber`, `setCustomNumber`, `checkGoalNumber` |
| Key | `n_` and 12 characters of a hash of the server, the tool and the field, so renaming the tool or the number keeps every goal on it. | `numberKey` |
| Picker | Each number is a measure for this business only (`numberDefs`), passed to `measureOf`, `planGoal` and `progress` beside core's list. | `ownMeasures`, `ownMeasureDefs`, `GoalForm` |
| Reading | The server must be on Connections, connected, not paused and pass its tool check right then (the same check as before a run). The tool is called with its pins only, through `core/tools/custom.ts`, the only file that may call a custom tool. Code reads the field: only a plain finite number within ±1 billion counts. Anything else shows Couldn't read, with why. | `readOwnNumber`, `callCustomToolData`, `numberFrom` |
| Changes | Any change to the tool pauses the server, so its goals show Couldn't read until the owner accepts the change; accepting keeps the goal number. Turning the tool off, or unpinning a needed input, ends it. | `acceptTools`, `setCustomTool` |

A goal decides nothing an agent may do, so a number from an outside server can only move its goal's
own line; it never chooses a recipient, URL, product or category. Tests: `npm run check:goal-numbers`.
No migration.

### Using a tool as a goal number (click by click)

1. In the Control Room, open **Connections** and tap your server under **Your servers**.
2. Under **Tools**, find a tool that's **On**. If it has inputs marked "(needed)", tap **Edit** and pin them first.
3. Tap **Use as a goal number**.
4. Type the **Field in the reply** (the server's docs say which), a **Name on goals**, pick what **It counts** and what **A goal on it is**, and tap **Save**.
5. Open **Crew**, tap **New goal**, and pick it under **From your own tools**.
