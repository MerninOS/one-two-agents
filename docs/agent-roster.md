# Every agent from data (Build Board card 57)

The owner, Nov 14: an agent built in the app should behave exactly like the four that started in code, and
nothing about an agent should be hard-coded. New integrations get added over time as shared tools
any agent can use (`core/tools/catalog.ts`), never as code for one agent.

**Rule: it deletes what it replaces.**

## What it is

- **One source.** An agent is a row in `agents` plus an active saved version in `agent_defs`. That
  is all. Avery, Morgan, Rowan and Quinn are rows like Reese, Marlow and Sloane.
- **Who it is** lives on the row (migration `20261119090000_agent_roster.sql`): `role`, `icon`, `hue`,
  `manual_only`, `created_at`. A blank role shows the agent's seat on the org chart ("Head of sales"),
  then "Built in the app". No icon shows a plain one; no colour picks one from the id.
- **What it does** comes from its live version: name, job line, tier (Draft when it has an approval
  card action, else Report), what a real run hands you (its report tools).
- **What a run costs** is the average of its last 10 finished runs, or its cap per run before it has any.
- **When it runs** is Crew > Schedule: the first chain with a schedule that has it as a step (one that
  is on first). No schedule is written in code.
- `dashboard/roster.ts` builds the crew from those parts (pure, tested by `npm run check:roster`);
  `getFloor` (`dashboard/data.ts`) loads them once per request as `crew`, `built`, `planned`, `byId`
  and `palette`. `dashboard/crew.ts` keeps only the planned roster (seats with no agent yet), the
  hard rules and the types.

## Running

- `agents/registry.ts` `loadCrew()`: every agent with a row and an active version can run, from
  `/api/agents/<id>`, the dispatcher and chains, on the shared engine (`runBuilt`). The `AGENTS` map is gone.
- **Runs only by hand** (`agents.manual_only`): only the Run button, or a chain started with Run
  chain. New agents start this way (column default). It follows the Scheduled / By hand toggle on
  Crew > Schedule (docs/org-schedule.md): By hand takes the agent out of every chain that starts on
  its own and always works; Scheduled sets a time (its own one-step chain, or its step in a chain) and
  needs Controls and a confirm. It runs on that time only while the org is on.
- Before the migration is applied there is no `manual_only` column: every agent then counts as by
  hand only, so nothing runs on a schedule by mistake (the morning chain is dropped as invalid until then).
- Every agent on the engine can read a hand-off from the step before (`TAKES_HANDOFF` is gone).

## In the Control Room

- `/agents/<id>` works for every agent: Overview, Edit (the builder page), Memory, Runs. Crew's org
  chart links every agent there. The builder page always has the tabs; its own "Latest runs" list
  is gone (Runs and replay cover it).
- Crew > Schedule's palette, Runs, replay, Today, Approvals, Connections and the sidebar list every
  agent from the roster.
- Cards that belong to a tool, not an agent: the Pipeline card and leads on a run go with
  `report_leads`, the Receipts card with `report_books_sync`, the web search split on a replay with
  `web_search`.

## Memory

Every agent run loads memory: its own lines, crew lines and its department's rules (`MEMORY_AGENTS`
is gone). Engine runs don't leave working memory; anything an agent should keep, the owner teaches it as a
note or a standing order. Working memory a run does leave is stored as data, never notes
(`KEEPS_WORKING` and `READS_OUTSIDE` are gone).

## What it replaces

`AGENTS` and `manualOnly` in `agents/registry.ts`; `BUTTON_ONLY` and `TAKES_HANDOFF` in
`core/flow-rules.ts`; `MEMORY_AGENTS`, `KEEPS_WORKING`, `READS_OUTSIDE` in `core/memory.ts`; the four
built entries, `CREW`, `BY_ID` and `BUILT` in `dashboard/crew.ts` (and the persona copy `works`, the
hand-written cost labels and schedules); the "own" card path for app-built agents on the org chart
(`listBuilt` there); the builder page's Latest runs list and `RunSteps`; `Floor.setupNames`.

## Checks

`npm run check`, `npm run check:roster`, `npm run check:org`, `npm run check:runner`, `npm run build`.
Apply `20261119090000_agent_roster.sql` right after merging.
