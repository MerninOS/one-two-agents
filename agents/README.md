# Agents

Every agent is a saved spec that runs on the shared engine (`core/runner.ts`, `core/built.ts`):
its active version and its approved routine. Building or changing one is the builder flow in the
Control Room (Crew, then New agent or an agent's Edit tab; `docs/builder-flow.md`). When it runs
is the crew flow (Crew > Schedule).

`registry.ts` lists the agents that can run on a schedule, in a chain or by hand through
`/api/agents/<id>`; the route handles auth, the run log, the on-duty switch and the daily budget.

The folders here hold only code the engine's tools call (`core/tools/catalog.ts`). Numbers are
worked out there in code, never by the model:

| Folder | Used by | What it is |
| --- | --- | --- |
| `cfo/` | `calc_daily_snapshot`, `report_kpi_snapshot` | Morgan's daily numbers: revenue, orders, AOV, repeat rate, green cost and margin, cash |
| `chief-of-staff/` | `report_morning_brief` | Avery's brief email and Briefs row; the focus and watch list come from the run's result |
| `wholesale-hunter/` | `wholesale_offer`, `report_leads` | What One Two offers a wholesale customer (the only facts an email may claim), and the lead dedupe key |
| `bookkeeper/` | `report_books_sync` | Quinn's books sync: one row per Mercury charge, receipts found in Gmail and matched in code, photo asks, receipt approvals, month close |

Adding an agent is done in the builder, not here. A new kind of read, calculation, report or
action is a new tool in `core/tools/catalog.ts` (actions only through `core/gateway`).
