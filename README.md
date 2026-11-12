# One Two Coffee Lab agents

Narrow agents that run One Two Coffee Lab's finance, sales and ops, each logging every
run to Supabase. Moved out of the storefront repo (`MerninOS/blended`) in November 2026
so agent deploys and finance secrets stay apart from the storefront. The plan for all
ten agents is the "One Two Coffee Lab Agent System" tech spec.

## Agents

| Route | Schedule | What it does |
| --- | --- | --- |
| `/api/agents/cfo` | daily 5:30 AM Central | Yesterday's revenue, orders, AOV, repeat rate, green cost and margin from Shopify, cash from Mercury → `kpi_snapshots`. Plain code, no model |
| `/api/agents/chief_of_staff` | weekdays 6:45 AM Central | Morning brief → an email to Zak (when `RESEND_API_KEY`, `BRIEF_FROM` and `BRIEF_TO` are set; see `docs/avery-email.md`) and a Notion page. Numbers come from code; Claude writes only the Watch list and today's focus, with a rules fallback when the API can't be reached |
| `/api/agents/bookkeeper` | manual only until launch (planned daily 6:00 AM Central) | Business charges from Mercury → `expense_docs`, receipts found in Gmail (read-only token) saved to the private `receipts` bucket, category suggestions from Mercury's own list, charges that need a photo, month close on the 3rd → a Notion page. Haiku reads receipts; code decides every match. **Never writes to Mercury itself**: receipt, category and memo are proposals that the tool gateway applies after Zak approves them in the Control Room. A few cents a run. Ships off (`agents.enabled = false`) |
| `/api/agents/wholesale_hunter` | manual only | Claude searches the web for a few new wholesale/private label prospects in Austin, Lakeway and Bee Cave, scores fit, writes a first-touch email → `wholesale_leads`, Gmail drafts (if `GMAIL_*` is set) and a Notion page. Drafts only; nothing is sent. About $1 a run |

The old paths `/api/agents/brief` and `/api/agents/hunter` still work.

- Every call needs `Authorization: Bearer $CRON_SECRET` (Vercel Schedules send it).
- Add `?trigger=manual` when running one by hand, so `agent_runs` records it as manual.
- Add `?dryRun=1` to read real data without writing anything or calling a model: no
  `agent_runs` row, no Supabase, Notion or Gmail writes. Good for checking a deploy.
- Schedules are Vercel Schedules (`schedules` in `vercel.json`, the replacement for Cron
  Jobs), named `cfo` and `chief-of-staff`, in `America/Chicago` time so daylight saving
  doesn't shift them. **Both are disabled while the agents are in development.** A disabled
  schedule stays disabled across deploys:
  ```bash
  vercel schedules list
  vercel schedules disable cfo        # or enable; no redeploy needed
  vercel schedules invoke cfo         # run once now, even while disabled
  ```
- `agents.enabled = false` is a second off switch: a firing is logged as skipped at $0.
  The CFO snapshot and brief are also off there until launch.
- `agents.daily_budget_usd` caps model spend per agent per UTC day.
- The Hunter and the Bookkeeper have no schedule and skip any call without `?trigger=manual`.
- `GET /api/health` (same bearer) shows which settings are present and whether Supabase answers.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://one-two-agents.vercel.app/api/agents/cfo?trigger=manual"
curl -H "Authorization: Bearer $CRON_SECRET" "https://one-two-agents.vercel.app/api/agents/chief_of_staff?dryRun=1"
```

## Control Room

The dashboard at `/` ("mission control"): the crew, live floor, run log and replays, access
matrix and integrations, built from the Claude Design file "Agent Control Room". Spec:
`docs/control-room.md`.

- Sign in with `DASHBOARD_PASSWORD`. Unset means nobody gets in. `/api/*` is unaffected.
- It never starts anything on its own. Dry runs (free, write nothing) always work, and so do
  taking an agent off duty and "Pause all agents".
- Real runs, putting an agent back on the crew and raising a budget need
  `DASHBOARD_CONTROLS=on`. Real runs go through `withRun`, so they respect `enabled` and budgets.
- Agent names (Avery, Morgan, Rowan…) and mandates live in `dashboard/crew.ts`.
- Approvals (`/approvals`): Quinn's proposed Mercury changes, one card per charge, plus the gateway log.
  Approving writes to Mercury only when `MERCURY_WRITE_TOKEN` is set, `DASHBOARD_CONTROLS=on` and
  Quinn is on duty; otherwise the approval is kept and applied later. See `core/gateway/README.md`.
- Memory (`?tab=memory` on a profile): what each agent carries into its runs, with Teach, Edit and Forget. Only Avery loads memory so far. Spec: `docs/agent-memory.md`. Run steps still show as "coming later".

## Layout

```
app/(room)/                Control Room pages (login in app/login, guarded by proxy.ts)
app/api/agents/[agent]/   one route for every agent: auth, trigger, run log
app/api/health/           settings present + Supabase reachable
dashboard/                Control Room data, actions, session and components
agents/                   one folder per agent, plus registry.ts (see agents/README.md)
core/                     env, Supabase client, withRun (log, enabled flag, budget, memory), agent memory, time helpers, the tool gateway
integrations/             Shopify (read-only), Mercury (read-only; mercury-write.ts is gateway-only), Notion, Gmail (drafts only; receipts read-only), Anthropic
domain/                   coffee constants and green math (copied from the storefront), bookkeeping rules (books.ts)
supabase/migrations/      agent tables
```

`integrations/shopify/README.md` lists the Shopify fields the storefront writes and the
agents read. That is the contract between the two repos.

## Setup

1. `npm install`, `cp .env.example .env.local`, fill it in.
2. `npm run schemas` once (downloads Shopify's Admin schema for GraphQL validation).
3. `npm run dev`, then call a route with the bearer header.

Supabase migrations are applied with `supabase db push` or pasted into the SQL editor of
the `one-two-agents` project. The first two were applied by hand from the storefront repo.

## Checks

```bash
npm run check   # tsc + eslint + every GraphQL document validated (and read-only)
npm run build
```
