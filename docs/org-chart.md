# Departments and the org chart

Zak, Nov 13: agents organised like a company, with departments, heads, leads and specialists, each agent doing one job (his reference: a marketing chart with a head, 4 leads and 12 specialists). Concept canvas: https://claude.ai/artifact/6u8XWvzfmYKsa1NWDWAxE2. Status lives on the Build Board, epic "Departments and org chart" (cards Order 60-64).

**Rule for every slice: it deletes what it replaces in the same PR.**

## Decisions (Zak, 2026-11-13)

- Heads take the outputs of the agents under them and report up the chain. Avery reads the heads' reports instead of every agent.
- A lead watches what the agents under it are doing and reports up. It doesn't hand out work: direction comes from Zak's standing orders. Specialists get built over time, one seat at a time.
- Leads can check drafts before they reach Zak (a note, or send back once). Only Zak's tap approves, and only his taps count toward promotion.
- A budget per department, and each agent keeps its own budget inside it.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | The org chart: departments and seats on Crew | The Crew Agents card grid |
| 2 | Department budgets and rules (monthly AI budget checked in `withRun`, email cap under the company cap, department rules in memory) | |
| 3 | Leads watch, heads report up (Team connection, team and department reports, Avery reads heads, "Reports to" on the agent map) | Avery reading every agent's runs one by one |
| 4 | Lead checks drafts, approvals by department | |

## Slice 1: The org chart

**What it is.**

- **Seats.** Migration `20261115090000_org_chart.sql` adds `departments` and `seats`. A seat is one box on the chart: it sits in a department under a parent seat (the head has none), and is held by an agent, by Zak (a job that stays with a person, like Content), or nobody yet (open). One company seat (Avery's) sits above every head. An agent sits in one seat at most (unique index), a department has one head, the chart goes 4 levels deep under a head, 12 departments and 80 seats at most. Seeded with the chart from the concept: Avery on top; Finance (Morgan head, Quinn); Sales (Rowan head, an open Follow-ups seat); Coffee (open head, Blair, Sol and Remy planned); Marketing (open head, four open leads, twelve specialists with Sage, Kit, Jules and Ellis planned and Content held by Zak).
- **Where an agent sits gives it nothing.** What it can read or do is still its saved setup, checked in code. Placing an agent or editing the chart needs the login only, never Controls: nothing here runs, sends or spends.
- **Code.** `core/org-rules.ts` (pure: tree, depth, who a seat reports to, a seat's path in words, problems, limits; tested by `npm run check:org`), `core/org.ts` (load and the writes, each re-checking the rules), `dashboard/org.ts` (the view: each seat with its agent's state and last run, agents not on the chart, the picker lists), `dashboard/orgActions.ts` (the actions), `dashboard/components/OrgChart.tsx`.
- **Crew > Org chart** (`/crew`, the default view): you, then Avery, then a card per department with its head and the seats under it. A department whose leads have their own teams spreads the leads side by side. A seat links to its agent (Overview, or the builder page for agents built in the app); an open seat links to New agent with that seat picked and its name in the job line. Agents in no seat are listed under "Not on the chart yet". **Edit chart** turns each seat and department into a button: rename it, pick who sits there (an agent that sits elsewhere moves, its old seat opens), add a seat under it, remove an open seat with nothing under it, add or remove a department (only when every seat in it is open).
- **Builder step 1:** "Where it sits on the org chart" lists the open seats (and its own). For an existing agent it saves straight away, not as part of a version; a new agent takes the seat when it is created (`createBuilt`), unless someone filled it meanwhile.
- **Overview tab:** an "Org chart" row with the seat's path and who it reports to (an agent, an open seat, or you).

**What it replaces.** The Crew "Agents" card grid (its cards live on as the seats, and as "Not on the chart yet").

**Not in this slice.** Department budgets and rules (slice 2), a "Reports to" box on the agent map and the Team connection (slice 3).

**Checks.** `npm run check`, `npm run check:org`, `npm run build`. Migration `20261115090000_org_chart.sql`: apply once merged. Until then Crew shows a note that it isn't applied, and step 1 and Overview leave the org chart out.

## Slice 2: Department budgets and rules

**What Zak sees.** Each department card on Crew > Org chart shows what its agents spent on AI this Chicago month, against its monthly budget when it has one ("$6.42 of $15.00 this month", a bar that turns yellow at 80% and red with RUNS PAUSED at the budget), and how many department rules it has (tap to read them). Edit chart, then Edit on a department, sets:

- **Monthly AI budget.** Shared by every agent seated in the department, on top of each agent's own daily budget. Blank means no department budget. Up to $500 (`DEPT_BUDGET_CEILING` in `core/org-rules.ts`, held by the migration too).
- **Emails a day.** For the department's agents together, never above the company cap (`policies.max_emails_per_day`). Blank means the company cap. No agent can send email yet; this is the fence the email action type will pass.
- **Department rules.** Lines every agent seated in the department loads from its next run, next to its standing orders. Add, edit, forget.

Lowering or setting a limit applies straight away. Raising or removing one needs `DASHBOARD_CONTROLS=on` and a confirm, like the company caps.

**How it's checked.**

- `withRun` (`core/runs.ts`): after on duty and the daily budget, the department budget. Spend is this month's `agent_runs.cost_usd` for the agents seated in the department now, added up in cents in code. At or over the budget the run is skipped at $0 with the reason in its summary. The first skip of the month emails Zak once (`departments.budget_alerted` holds the month; a new budget clears it). Spend that can't be read skips the run. An agent off the chart, or in the company seat, has no department budget.
- `checkEmail` (`core/gateway/policy.ts`) takes the department's sent-today count and cap; the department cap is never above the company cap (`deptEmailCap`).
- Department rules are `agent_memory` rows with `grp = 'department'` and a `department_id` (no agent). `loadMemory` loads the agent's own lines, crew lines and its department's rules; department rules are never trimmed for size, like crew memory and standing orders. They are notes like every memory line: they can add a do or don't, never raise a cap, add a recipient or grant access. Removing a department marks its rules forgotten (nothing in `agent_memory` is deleted).
- An agent's Memory tab shows its department's rules (read-only there), its timeline shows their changes, and builder step 1's "Rules it always follows" lists them.

**Data.** Migration `20261116090000_department_budgets.sql`: `departments.monthly_budget_usd`, `max_emails_per_day`, `budget_alerted`; `agent_memory.department_id` and the `department` group (the owner check now says crew rows have no agent or department, department rows a department and no agent, the rest an agent); `memory_events.department_id`.

**Not in this slice.** Memory is still loaded only for agents in `MEMORY_AGENTS` (Avery, Rowan, Quinn), so a department rule reaches the other agents' runs once Build Board Order 57 gives app-built agents memory. Leads and heads reporting up is slice 3.

**Checks.** `npm run check`, `npm run check:org`, `npm run check:policy`, `npm run build`. Apply the migration once merged. Until then the Crew page can't read the new columns and shows the "not applied" note, and runs skip the department check (no department is found).
