# Usage, traces and the audit log

Build Board: Order 126 (Open core 6). Design: OPERATOR architecture
https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj, phase 6. With many orgs and queued work,
`agent_runs` alone can't say who spent what or who did what.

## Slices

1. **Usage ledger** (this one): `usage_ledger`, one row per thing that cost money, and budgets
   read from it.
2. **Audit log**: an append-only row for each person's action (approvals, Connections changes, the
   org switch, promotions, people and roles), shown in Settings.
3. **Traces**: OpenTelemetry spans per job and run step (org, run, agent, tool), exportable to any
   OTel backend or a Vercel drain, scrubbed like every log.
4. **Status and alerts**: dead jobs, paused custom servers, expired sign-ins, cap breaches and
   queue depth on one page, with alert emails to the owner through `integrations/email.ts`.

## The usage ledger (`supabase/migrations/20261207090000_usage_ledger.sql`, `core/usage.ts`)

- A row has the org, kind (`run` today; `model_call` and `tool_call` come with traces), when it
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
