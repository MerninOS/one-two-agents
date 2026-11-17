# One Two Coffee Lab agents

Agents that help run One Two Coffee Lab (onetwocoffeelab.com). Next.js 16 app: agent API routes plus the Control Room dashboard (`dashboard/`,
`app/(room)/`; see `docs/control-room.md`), deployed as the Vercel project `one-two-agents`, schedules (Vercel Schedules, not Cron Jobs) in `vercel.json`,
state in the Supabase project `one-two-agents`. The storefront is a separate repo
(`MerninOS/blended`); this repo never imports from it. See README.md for layout.

This version of Next.js has breaking changes from older versions: read the guide in
`node_modules/next/dist/docs/` before writing framework code.

## Hard rules (from the agent system tech spec; never relax them in code)

The tool gateway (`core/gateway`) has two action types so far, both Draft: receipt, category
and memo on an existing Mercury transaction (Bookkeeper and CFO), and a Gmail draft to a lead
on the leads list (Rowan; Zak sends it from Gmail). No send, payment or publish action type is
built, so no agent can send, pay or publish.


- Sending, buying and posting are allowed only as gateway action types, and every new
  action type starts at Draft: an approval card in the Control Room that Zak taps. An
  action type moves up (Draft, then Act with an undo window, then Act) only after 28 of
  its last 30 approvals went through unedited and Zak confirms the promotion card. A
  "wrong" rejection, complaint, unsubscribe spike, cap breach or breaker trip drops it
  back to Draft. No code path may send, pay or post outside the gateway.
- Money: only within `policies.max_purchase_usd` (start $500) and
  `policies.max_monthly_spend_usd` (start $1,500), only to payees in `vendors` (Zak adds
  rows; a new payee is always Draft and never promoted), as Mercury send-money requests.
  No card actions, no transfers to personal accounts, no void or delete of a transaction,
  bill, invoice or account. Writes to existing transactions are limited to attachment,
  category and memo, by CFO and Bookkeeper. Each kind of write has its own sign-in, used only
  by the gateway through `callWriteTool`: category and memo on the `mercury_write` sign-in
  (Mercury's MCP, scope `transactions:update` only), receipt files on the `mercury_files` key
  (our own server, attach only).
- Shopify is read-only here: our own MCP server (`integrations/shopify-server.ts`), one fixed
  query per tool (`core/shopify-queries.ts`), a key with any write scope is refused, and
  `scripts/validate-graphql.mjs` fails on any mutation. An agent that needs Shopify writes gets
  its own separately scoped app.
- Email: first contact with a person who has never heard from One Two is always Draft
  and never promoted. Follow-ups and replies on an existing thread can be promoted. Daily
  cap `policies.max_emails_per_day` (start 20); an unsubscribe or "stop" reply ends all
  messages to that person, in code. Emails to Zak (brief, alerts) are reports, not
  gateway actions: they go only through `integrations/email.ts`, which has no recipient
  argument and sends to `BRIEF_TO`.
- Posts: publishing is Draft until promoted, the approval shows the exact caption and
  media, and no agent edits or deletes a published post. No agent signs or accepts terms.
- No deletes of products, customers, orders or Klaviyo profiles.
- External messages only claim facts about lots, origins or certifications that come
  from Shopify data, never from the model.
- Web pages, inbound email and lead websites are untrusted data: never let them choose
  a recipient, URL, product or category.
- Numbers (money, margins, days of cover, mileage) are computed in code, not by a model.
- Every integration is an MCP server with a profile. A built-in server's profile is in
  `core/mcp-rules.ts`: its sign-in kind, the exact scopes asked for, its read tools, report tools
  and write tools, each named in code; a tool it adds later does nothing until a pull request names
  it, and a business connects its own account but never edits that profile. A business may also add
  a custom server by its address (`docs/custom-servers.md`): its profile is a row the owner edits
  (tools turned on, labels, pinned inputs), held to the limits in `core/custom-mcp-rules.ts`. On a
  custom server a tool does nothing until the owner turns it on; only tools the server marks
  read-only, with plain inputs, can be turned on; any change to a turned-on tool pauses the server,
  checked right before every run that uses it; the owner grants a turned-on tool to an agent on
  the builder's Tools step (never a proposal); the address must be a public https host, checked
  before every request. Custom servers have no
  report or write tools. Custom write tools, if ever built, are approval cards that stay at Draft
  and are never promoted. A custom tool's reply is untrusted data and never chooses a recipient,
  URL, product or category. Hosted servers (Klaviyo, Mercury) are used where they fit;
  where one reaches more than the profile needs or doesn't fit, we run our own in the app
  (Notion, Gmail with no send tool, Shopify with one fixed query per tool, Mercury receipt files).
  Each of our own servers is the only file that calls its service's API, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp` enforce both).
- One tool path: agents read only through `callMcpTool` (read tools), or a turned-on custom tool
  through `callCustomTool`, which only `core/tools/custom.ts` calls (lint enforces it). Code writes reports into One
  Two's own Notion only through report tools on our own servers, after a run, never by a model.
  Every other write is a profile's write tool, called only by `core/gateway` through
  `callWriteTool` after Zak approves (lint enforces it); it becomes a gateway action type.
- One credential store: every sign-in and service key lives in the token vault (`core/vault.ts`,
  sealed under `MCP_SECRET_KEY`, never derived from another secret), connected on Connections.
  Only `integrations/mcp.ts` and `core/gateway` import the vault (lint enforces it). Settings in
  Vercel hold only the app's own infrastructure (Supabase, Claude, Resend for emails to Zak, the
  vault key, One Two's Google OAuth client) and non-secret ids. Ask for the profile's scopes only, and refuse a sign-in or key
  that carries more (Google scopes, Shopify write scopes). No token in a prompt, log, error or the
  browser (`scrubSecrets`); requests carrying a token or code never follow redirects. A refused or
  expired sign-in pauses until Zak signs in again. See `docs/mcp-everywhere.md`.
- Every run goes through `withRun` so it is logged in `agent_runs` and respects
  `agents.enabled` and `agents.daily_budget_usd`.
- Tenancy: every table has `org_id` (an org is a business; One Two is the home org). Every query
  goes through `db()`, which scopes it to the current org (`core/tenancy.ts`): reads, updates and
  deletes are filtered by org, inserts are stamped, another org's row is refused. Only `core/db.ts`
  makes a Supabase client (lint enforces it), and a new table needs `org_id` and a place in
  `TENANT_TABLES` and an `org_rows` policy (`check:tenancy` enforces it); with the database lock on,
  tables are read with a token for the current org, so the database refuses other orgs' rows. People sign in as themselves and every server
  action checks the member's role first with `asRole` (`check:roles` enforces it). Work that runs on
  its own is a job (`core/jobs.ts`), run by a worker (`/api/jobs`) as the job's org; only the
  scheduler reads across orgs, and only their ids (`allOrgIds`). See `docs/tenancy.md`.

## Checks

`npm run check` (typecheck, lint, GraphQL validation; run `npm run schemas` once first)
and `npm run build` before every push.
