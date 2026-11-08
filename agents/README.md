# Agents

One folder per agent. Each exports a job that returns a `RunResult`, and is listed in
`registry.ts` under its id in the `agents` table. The route `/api/agents/[id]` handles
auth, the run log, the enabled flag and the daily budget for all of them.

| Agent | id | Folder | Status |
| --- | --- | --- | --- |
| CFO | `cfo` | `cfo/` | Live, off until launch (schedule disabled, paused in DB). Daily 5:30 AM CT |
| Chief of Staff | `chief_of_staff` | `chief-of-staff/` | Live, off until launch (schedule disabled, paused in DB). Weekdays 6:45 AM CT |
| Wholesale Hunter | `wholesale_hunter` | `wholesale-hunter/` | Live, manual runs only (~$1 a run) |
| Bookkeeper | `bookkeeper` | `bookkeeper/` | Planned (phase 2) |
| Blend Coach | `blend_coach` | `blend-coach/` | Planned (phase 3) |
| Roast Planner | `roast_planner` | `roast-planner/` | Planned (phase 3) |
| Green Buyer | `green_buyer` | `green-buyer/` | Planned (phase 3, after launch) |
| Merchandiser | `merchandiser` | `merchandiser/` | Planned (phase 4) |
| Concierge | `concierge` | `concierge/` | Planned (phase 4) |
| Content Scout | `content_scout` | `content-scout/` | Planned (phase 4, after launch) |

Adding one:

1. `agents/<folder>/index.ts` exporting the job, `prompt.ts` for its instructions.
2. A migration in `supabase/migrations/` inserting its `agents` row and any tables it owns.
3. An entry in `registry.ts`.
4. A named entry under `schedules` in `vercel.json` (with `"requestMethod": "GET"` and
   `"timezone": "America/Chicago"`) if it runs on a schedule, then
   `vercel schedules disable <name>` until it should go live.
5. New external systems go in `integrations/`, read-only unless the tech spec gives the
   agent a write, and then only through `core/gateway/` once it exists.
