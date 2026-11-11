# One Two Coffee Lab agents

Agents that help run One Two Coffee Lab (onetwocoffeelab.com). Next.js 16 app: agent API routes plus the Control Room dashboard (`dashboard/`,
`app/(room)/`; see `docs/control-room.md`), deployed as the Vercel project `one-two-agents`, schedules (Vercel Schedules, not Cron Jobs) in `vercel.json`,
state in the Supabase project `one-two-agents`. The storefront is a separate repo
(`MerninOS/blended`); this repo never imports from it. See README.md for layout.

This version of Next.js has breaking changes from older versions: read the guide in
`node_modules/next/dist/docs/` before writing framework code.

## Hard rules (from the agent system tech spec; never relax them in code)

The tool gateway (`core/gateway`) exists with one action type so far: receipt, category
and memo on an existing Mercury transaction (Bookkeeper and CFO, Draft). No send, payment
or publish action type is built, so no agent gets one of those integrations: drafts only.


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
  category and memo, by CFO and Bookkeeper. Each kind of write gets its own token, held
  only by the gateway: only `core/gateway` may import `integrations/mercury-write.ts`
  (lint enforces it).
- Shopify is read-only here. `scripts/validate-graphql.mjs` fails on any mutation. An
  agent that needs Shopify writes gets its own separately scoped app.
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
- Every run goes through `withRun` so it is logged in `agent_runs` and respects
  `agents.enabled` and `agents.daily_budget_usd`.

## Checks

`npm run check` (typecheck, lint, GraphQL validation; run `npm run schemas` once first)
and `npm run build` before every push.
