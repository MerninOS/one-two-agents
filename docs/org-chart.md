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
| 2 | Department budgets and rules | |
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
