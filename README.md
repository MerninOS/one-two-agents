# One Two Coffee Lab agents

Narrow agents that run One Two Coffee Lab's finance, sales and ops, each logging every
run to Supabase. Moved out of the storefront repo (`MerninOS/blended`) in November 2026
so agent deploys and finance secrets stay apart from the storefront. The plan for all
ten agents is the "One Two Coffee Lab Agent System" tech spec.

## Agents

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/agents/cfo` | daily 11:30 (5:30 AM CST) | Yesterday's revenue, orders, AOV, repeat rate, green cost and margin from Shopify, cash from Mercury → `kpi_snapshots`. Plain code, no model |
| `/api/agents/chief_of_staff` | weekdays 12:45 (6:45 AM CST) | Morning brief → a Notion page. Numbers come from code; Claude writes only the Watch list and today's focus, with a rules fallback when the API can't be reached |
| `/api/agents/wholesale_hunter` | manual only | Claude searches the web for a few new wholesale/private label prospects in Austin, Lakeway and Bee Cave, scores fit, writes a first-touch email → `wholesale_leads`, Gmail drafts (if `GMAIL_*` is set) and a Notion page. Never sends. About $1 a run |

The old paths `/api/agents/brief` and `/api/agents/hunter` still work.

- Every call needs `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it).
- Add `?trigger=manual` when running one by hand, so `agent_runs` records it as manual.
- Add `?dryRun=1` to read real data without writing anything or calling a model: no
  `agent_runs` row, no Supabase, Notion or Gmail writes. Good for checking a deploy.
- `agents.enabled = false` pauses an agent: crons still fire and are logged as skipped at $0.
  The CFO snapshot and brief are paused until launch.
- `agents.daily_budget_usd` caps model spend per agent per UTC day.
- The Hunter is scheduled for Feb 29 only so Vercel lists it with a Run button
  (Settings → Cron Jobs); the route skips that leap-day firing.
- Vercel Cron runs in UTC, so local times shift an hour later during daylight saving.
- `GET /api/health` (same bearer) shows which settings are present and whether Supabase answers.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://one-two-agents.vercel.app/api/agents/cfo?trigger=manual"
curl -H "Authorization: Bearer $CRON_SECRET" "https://one-two-agents.vercel.app/api/agents/chief_of_staff?dryRun=1"
```

## Layout

```
app/api/agents/[agent]/   one route for every agent: auth, trigger, run log
app/api/health/           settings present + Supabase reachable
agents/                   one folder per agent, plus registry.ts (see agents/README.md)
core/                     env, Supabase client, withRun (log, enabled flag, budget), time helpers, gateway (reserved)
integrations/             Shopify (read-only), Mercury (read-only), Notion, Gmail (drafts only), Anthropic
domain/                   coffee constants and green math, copied from the storefront
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
