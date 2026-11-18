# Usage, traces and the audit log

Build Board: Order 126 (Open core 6). Design: OPERATOR architecture
https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj, phase 6. With many orgs and queued work,
`agent_runs` alone can't say who spent what or who did what.

## Slices

1. **Usage ledger** (done): `usage_ledger`, one row per thing that cost money, and budgets
   read from it.
2. **Audit log** (done): an append-only row for each person's action (approvals, Connections changes, the
   org switch, promotions, people and roles), shown in Settings.
3. **Traces** (done): OpenTelemetry spans per job and run step (org, run, agent, tool), exportable to any
   OTel backend or a Vercel drain, scrubbed like every log.
4. **Status and alerts** (this one): dead jobs, paused custom servers, expired sign-ins, cap breaches and
   queue depth on one page, with alert emails to the owner through `integrations/email.ts`.

## The usage ledger (`supabase/migrations/20261207090000_usage_ledger.sql`, `core/usage.ts`)

- A row has the org, kind (`run` today; `model_call` and `tool_call` rows wait for metered billing, card 128: each call's cost is already on its trace span), when it
  counts (the run's start, as budgets always counted), the run and agent, the source (the run's
  trigger), tokens and cost.
- **The database writes it.** A trigger on `agent_runs` adds or updates the run's row whenever its
  cost or tokens are set, so no code path can run without its cost landing in the ledger. The app
  can only read it: insert, update and delete are revoked from every app role, and `org_rows`
  keeps each org to its own rows.
- The migration copies every run that already cost something, so budgets read the same totals
  the day it lands.
- **Budgets read it**: an agent's daily budget (`core/runs.ts`) and a department's monthly budget
  (`core/org.ts` `monthSpendByAgent`). The amounts and rounding are unchanged; a ledger that can't
  be read now stops the run instead of counting as $0.
- `agent_runs.cost_usd` stays, for showing a run's cost on its page.

## The audit log (`supabase/migrations/20261208090000_audit_log.sql`, `core/audit.ts`)

- A row has the org, when, the actor (the signed-in member's email), the action's name in code
  (`approve`, `set_cap`, `connect` ...), what it was done to (an approval, agent, connection, cap
  key or email) and a few plain facts. Values are clipped and scrubbed (`scrubSecrets`): never a
  secret.
- **Append-only.** The app can add a row and read its own org's rows; update, delete and truncate
  are revoked from every app role, and `org_rows` keeps each org to its own rows.
- **Which actions.** Every server action that changes what agents may do, spend or reach adds a
  row once it has worked: approvals, the org switch, duty, schedules, real runs and tries, caps,
  vendors, suppressions, the builder and going live, the flow, Connections (including a finished
  sign-in), people and roles, department budgets and email caps, seats and drafts routing, and
  proposals. `npm run check:audit` holds every action to one of two lists, so a new action fails
  the check until someone decides; the other list says why each isn't audited (dry runs, labels on
  the chart, memory and goals, which keep their own history).
- A row that can't be written never undoes the action: the failure is logged, scrubbed.
- Settings shows the latest 100 rows.

## Traces (`instrumentation.ts`, `instrumentation.node.ts`, `core/trace.ts`, `core/trace-rules.ts`)

- An OpenTelemetry span around each **job** (worker), **run** (`withRun`), **model call** (the
  runner) and **tool call** (`callMcpTool`, `callWriteTool`, `callCustomTool`), nested as they
  happen, each tagged with the org. A run's span has the agent, trigger, chain, run id, status,
  tokens and cost; a model call's has the model that served it, tokens and cost; a tool call's has
  the server, tool and kind (read, write, custom).
- **Only ids, names and numbers.** `spanAttrs` drops any key not on its list and any value that
  isn't a plain id, name or finite number, so an input, output, prompt, reply or token never lands
  on our spans. Errors are scrubbed and cut to 200 characters.
- **Every span is cleaned before it leaves**, Next.js's own and fetch's included: URLs lose their
  query string (a sign-in callback carries a code there) and every string is scrubbed
  (`cleanExported`, run by a span processor ahead of the exporter).
- **Where they go**: `@vercel/otel` sends them wherever the environment says: a Vercel trace drain
  (Vercel, Project, Settings, Drains, Traces), or any OTel backend through the standard
  `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` settings. With neither, nothing is
  sent and spans cost nothing.
- Tracing never changes or stops the work: a span that can't be made or tagged is skipped.
- `npm run check:traces` tests the filtering and cleaning, and that the four kinds of work are wrapped.

## Status and alerts (`core/status.ts`, `core/status-rules.ts`, `/status`, `supabase/migrations/20261209090000_status_alerts.sql`)

- **One page, Status** (sidebar, above Settings), for everyone who can sign in. It lists what needs
  a look, worst first, each with a link to where it's fixed, and tiles for the counts.
- **Alerts** (red): jobs that failed in the last day; jobs still waiting more than 45 minutes past
  their time (the scheduler runs every 15 minutes, up to 15 late, so this means it isn't running);
  each paused connection (a sign-in that stopped working, or a custom server that changed a tool).
- **Warnings** (grey, page only): runs that failed in the last day, gateway proposals refused in
  the last day (over a cap, an unknown payee, a suppressed address), and facts that couldn't be
  read (a migration not applied).
- **Alert emails.** The scheduler (`/api/dispatch`), after each round's work, emails the owner the
  alerts that are new, in one email, through `integrations/email.ts` (no recipient argument: the
  business's owner email on Settings). Each problem goes out once, then at most every 24 hours while it lasts:
  `status_alerts` holds when each was last sent, marked before the send so two rounds can't both
  send. An alert that can't be sent never stops the scheduler.
- **Every org.** Each business's alerts go to its own owner email (Settings > Where things go,
  docs/tenancy.md slice 8.1b). An org with no owner email sees its problems on its Status page only.
- Cap breaches show as refused proposals; circuit breakers aren't built yet (core/gateway/README.md).
- `npm run check:status` tests which facts are problems, the alert timing and the email.
