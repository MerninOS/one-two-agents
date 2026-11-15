# Company mode: run the crew like a company

Zak, Nov 15: the Control Room still felt like configuring software. Teaching agents, adding agents
and mapping the org were clunky. He wants to run a fully agentic organization with himself on top:
he sets goals, reacts to work and decides on proposals; heads think and plan, specialists do one
narrow job. Approved design (every board, desktop and phone):
https://claude.ai/artifact/UtmdGkLKTTezQNGmg5oWHu. Status lives on the Build Board, cards Order 80-86.

**Rule for every slice: it deletes what it replaces in the same PR.**

## Decisions (Zak, 2026-11-15, "yes to all")

1. Heads (not leads) give their specialists a weekly focus: a note that expires in 7 days, never
   authority. Leads still only watch. This changes the Nov 13 rule for heads only.
2. Every goal needs a measure counted in code, picked from a list. A goal without one shows
   "No measure yet" and the missing read goes on the build list.
3. Zak's reactions save straight away as rules in his words, with Undo. Avery may suggest wording
   or scope; only his tap applies it. Lessons a lead or head proposes still wait for his Keep.
4. Avery becomes the front door: a chat in the app that reads the company's data and can only file
   proposals and save the rules Zak dictates. The /one-two-new-agent skill retires once she can hire.
5. Heads move to Sonnet, medium effort, $0.75 cap a run. Specialists stay on Haiku unless the job
   needs judgment.
6. MCP connections: our runner calls MCP servers itself (never the model provider's server-side
   connector), read tools only, picked one by one; writes only as gateway action types. Klaviyo first.
7. The Desk replaces Today. Editing the org chart by hand stays.

Unchanged: heads never get action tools; new agents start off duty with no actions; every send,
payment or post is a gateway action that starts at Draft; only Zak's taps approve or count toward
promotion; agents stay off until he says launched.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | Teach by reacting | The Memory tab's Teach form; Reject's "proposed lesson" from Zak's own reason |
| 2 | Goals and measures | Today's stat chips |
| 3 | Proposals: hire, grant a tool, new tool, retire | The new-agent skill's direct database writes (New agent stays the builder, see slice 3) |
| 4 | Heads plan, review and set focus | Hand-written focus in department rules |
| 5 | Avery, the front door, and the Desk | The Today page; the /one-two-new-agent skill |
| 6 | MCP connections, Klaviyo first | (new kind of connection) |

## Slice 1: Teach by reacting

**What Zak sees.**

- **Run replay: "Was this right?"** (`#react`, so links can jump there). **Good** saves at once.
  **Not this…** opens a box: his words ("Say it like you'd say it to Rowan"), **who should follow
  it** (the agent, all of its department, everyone), **for how long** (always, 30 days, next run;
  only the agent's own rule can be short-lived), and **replace a rule it already has?** (its kept
  rules in that scope, or keep them all). Saving with no words just marks it not this.
- **Each lead a run found** gets its own Good / Not this under the run's.
- **Approvals: Reject** opens the same picker. Words are optional; with words the rule is saved in
  his words straight away (no Keep), for whoever he picked.
- **The morning brief:** "Not right? Tell Avery" under the focus and the watch list (and in the
  plain-text copy) opens Good / Not this on the run that wrote that brief.
- **Agent Overview:** "From you, last 30 days: 4 good · 2 not this" under How it works, and the
  Journal lists each reaction ("You said not this to Summit Coffee Co.") with a link back.
- **Memory tab:** the Teach form is gone. Its card says how to teach (react on runs and approval
  cards) with **React to its latest run** and **Rules it always follows** (builder step 1, which
  still adds standing orders with a Notion page). The tab stays the record: every rule shows where
  it came from ("Your reaction to a run", "Your reason for a Reject"), with Edit and Forget.
- **Heads read it:** "Your team" (`team_report`) now carries each teammate's `fromZak`: Good and
  Not this counts for the period, and his latest words, plus `aN_zak_good` / `aN_zak_not` numbers.

**What gets saved** (`core/reaction-rules.ts`, pure, `npm run check:reactions`; `core/reactions.ts`).

- One `reactions` row per thing reacted to (a run, a lead in a run, an approval); reacting again
  changes it. It holds the verdict, his words when they became a rule, and the rule's id.
- Not this with words: agent + always is a standing order, agent + 30 days or next run is a note,
  department is a department rule, everyone is a crew line. `source = zak`,
  `source_tag = run:<id>` or `approval:<id>`. The new rule is saved first, then the one it replaces
  is forgotten (so a failed save never loses the old rule). A replaced rule must be kept and in the
  same scope, checked in code.
- The run and lead are looked up on the server: the run must be the agent's, the lead must be from
  that run. Nothing the page sends picks a target.
- Rules are notes like every memory line: they never raise a cap, add a recipient or grant access.

**Data.** Migration `20261120090000_reactions.sql` (the `reactions` table). Until it's applied,
Good and a plain Not this answer that the table isn't there; Not this with words and Reject with
words still save the rule (the toast says it won't show on the scorecard); the scorecard, journal
entries and `fromZak` are empty.

**What it replaces.** `TeachForm` and the `teach` action (the Memory tab's form and the Overview
Journal's compact copy); `RejectButton`'s "propose a lesson" path in `reject` (Zak's reason is now a
reaction). `proposeLesson` stays for a lead's or head's send-back.

**Checks.** `npm run check`, `npm run check:reactions`, `npm run build`.

## Slice 2: Goals and measures

**What Zak sees.**

- **Crew > Org chart:** each department card leads with its goals (up to 3), above its budget and
  seats, and stays visible when a department is folded on a phone. A tile shows the goal in his
  words, a status (On track, Behind, Reached, Missed, No measure yet, Couldn't read, Paused), what
  code counted ("1 of 5 won", "$1,240 of $3,000 this month", "48 days, at least 45 days") and a
  bar. **Set a goal for Sales** (or **Add a goal**) opens Set a goal with the department picked.
- **Today:** the stat chips (Spend today, Runs today, Pipeline, Connections) are gone; a **Goals**
  card with a tile per goal, across departments, takes their place, with **Set a goal**. Spend
  stays in Spend by agent, runs on Runs, connections on Connections.
- **Set a goal** (`/goals/new`): department, the goal in his words, **How code measures it**
  (picked from the list; the ones code can't count yet are listed separately and say what read is
  missing), a target and a date. The form says how each measure is counted.
- **Goal page** (`/goals/[id]`): Crew › Sales › Goal, status, "Set by you Nov 15 · owned by Rico,
  Head of sales · due Mar 31", the goal, "Measured in code: …", the number, the bar and the pace
  ("One more every 34 days to get there. At the current rate, about 3 by Mar 31."). For accounts
  won, the leads funnel by stage; for days of cover, each lot. What the department costs AI this
  month, per agent. **Change the goal**, **Pause it** / **Turn it back on**, **Mark done** /
  **Reopen**, **Remove** (with a confirm). The head's plan and review come with slice 4.
- **Heads read it:** a new **Goal progress** tool (`goal_progress`, Agents group in builder step 2)
  gives the goals of the agent's own department (every department for the company seat), each with
  its status, progress line, pace and the numbers `gN_value`, `gN_target` (plus `gN_<stage>` for
  the funnel) and `goals_behind`. The department comes from the chart on every call; an agent not
  on the chart is refused. It isn't added to any live spec here: tick it in step 2, or slice 4 adds
  it to the heads' planning runs.

**The measures** (`core/goal-rules.ts` MEASURES, a list in code; counted in `core/measures.ts`).

| Measure | Shape | Counted from |
|---|---|---|
| Wholesale accounts won | total, by a date | `wholesale_leads` at stage Won |
| Revenue this month | month | Shopify orders this Chicago month, cancelled left out |
| Orders this month | month | the same orders, counted |
| Lowest days of green cover | floor | each listed lot: on hand ÷ use per day over 30 days (`core/green.ts`) |
| Months of runway | floor | Mercury cash ÷ net burn per 30 days over 90 days (`core/money.ts`) |
| Email list size | (can't count yet) | needs a Klaviyo read, slice 6 |

- **total:** pace counts from where the measure stood when the goal was set (`start_value`, read in
  code on save) to the target by the date. On track when the count is at or above that line,
  Reached at the target, Missed after the date.
- **month:** starts again on the 1st. On track when it's at or above the target times the share of
  the month gone. No date.
- **floor:** On track at or above the line. Runway with no net burn has no limit, so it's on track.
- A goal whose measure can't be counted yet saves with no target and shows "No measure yet" with
  the missing read. A read that fails or takes over 20 seconds shows "Couldn't read" with why.
- Each measure is read once per page, however many goals use it, when the page opens (Crew,
  Today, the goal page). Nothing is cached or stored: the number is always today's.
- Status and pace are plain arithmetic in `progress()`, tested by `npm run check:goals`.

**What it never does.** A goal grants nothing: no agent can do anything new because of one, and
goals need the login only (no Controls), like the org chart. Goal words are Zak's (trusted); the
numbers are code's. Changing a goal's measure starts its pace again from that day (`paced_from`).

**Data.** Migration `20261121090000_goals.sql` (the `goals` table: department, title, measure key,
target, `start_value`, `due_on`, state active / paused / done / dropped, `paced_from`). Removing a
department removes its goals. Until it's applied, Crew and Today say so and Set a goal refuses.

**Code.** `core/goal-rules.ts` (pure: the list, `planGoal`, `progress`), `core/measures.ts`,
`core/goals.ts` (store, `goalProgress` for the tool), `core/green.ts` and `core/money.ts` (moved
out of the tool list so the tools and the measures share one copy), `agents/cfo` `ordersBetween`,
`dashboard/goals.ts`, `dashboard/goalActions.ts`, `dashboard/components/goals.tsx`,
`dashboard/components/GoalForm.tsx`, `app/(room)/goals/`.

**What it replaces.** Today's stat chips (and their CSS).

**Checks.** `npm run check`, `npm run check:goals`, `npm run build`.

## Slice 3: Proposals

**What Zak sees.**

- **Needs you** says "2 proposals from your heads" and opens **Proposals** (`/proposals`). The
  Approvals item in the sidebar counts proposals too, and the Approvals page leads with a card for
  them when any wait.
- **Proposals** (`/proposals`): Waiting on you, the **Build list** (new tools he said yes to, each
  with **Mark built**), and Decided lately with what each yes or no did.
- **A proposal's page** (`/proposals/[id]`, the Hire artboard): from whom, the department and when;
  **Why** in the head's words; the job (for a hire: seat, job, each run, good result, brain, reads,
  hands you) or what it asks; **What your yes does**; for a hire, the cost cap per run and what the
  department has spent on AI this month; **Checked in code** (name free, seat still open, every tool
  on the list and none an action, starts off duty); and three buttons:
  - **Hire Tate, off duty** (or **Give Rowan "Goal progress"**, **Put it on the build list**,
    **Retire Rowan**, **Close the Follow-ups seat**), with a confirm. Off while a check fails.
  - **Change it first** (hires): the builder with everything filled in and the seat picked. Creating
    the agent there says yes to the proposal (and makes the new seat, if it asked for one).
  - **Not now…** asks why. Words become a 30-day note for the head that asked ("Zak said not now to
    …"), so it doesn't ask again for the same reason next run.
- **Crew > Org chart:** a seat with a proposal waiting shows "Proposal · Hire Tate for Follow-ups"
  (on the open seat, or on the head's seat when the hire asks for a new seat under it). An open
  seat with a waiting hire opens the proposal instead of the builder.

**How a head proposes.** A new report tool, **Propose to Zak** (`propose`, Agents group in builder
step 2), offered only to a department head or the company seat (`seat: "head"`, from the chart;
the tool checks the chart again when it saves). The model hands one proposal per call, at most 3 a
run; each is checked in code like any report row (`planProposal`) and saved only after a run that
finishes, where names are resolved against the chart within the head's own department. At most 6
wait per head, and the same title can't wait twice. It isn't added to any live spec here: tick it
in step 2, or slice 4 adds it to the heads' review runs.

| Kind | Holds | A yes does |
|---|---|---|
| hire | name, seat (open, or new under the head), job, each run, good result, read tools (up to 8), brain | creates the agent off duty as v1 (`createBuiltAgent`, like New agent), seats it |
| grant_tool | teammate, one read tool | saves a draft version with the tool added; it runs only after Try it and Go live |
| new_tool | what to read and from where | puts it on the build list (a tool is code: it comes as a PR) |
| retire | teammate, or an empty seat | takes the agent off duty and opens its seat; or removes the empty seat |

Brains are Claude only: **quick** (Haiku, low effort, $0.10 cap a run) unless the job needs
judgment, **thinking** (Sonnet, medium, $0.25). A hire gets 12 steps.

**What it never does.** A proposal is words and choices from lists in code; it does nothing by
itself. It can never hand out an action (refused when filed, and again at the tap: actions are
granted in code only). A head can't propose tools for itself or its own retirement, can't close a
head seat, and reaches only its own department. Every check runs again at Zak's tap against the
chart and tool list as they are then. Nothing here runs, sends or spends, so it needs the login
only (no Controls).

**Data.** Migration `20261122090000_proposals.sql` (the `proposals` table: kind, title, source agent
/ claude / zak, from_agent, department, run, the checked plan as `payload`, why, state pending /
accepted / declined / built / failed, outcome, result_ref, decided_at). Until it's applied, the
Proposals page says so and the tool refuses to save.

**Code.** `core/proposal-rules.ts` (pure: kinds, brains, `planProposal`, `proposalTitle`,
`hireSpec`), `core/proposals.ts` (store, resolve against the chart, `acceptProposal`,
`declineProposal`, `markBuilt`, `proposalChecks`, `proposalsBySeat`), the `propose` tool in
`core/tools/catalog.ts`, `headBlock` and the `head` seat scope in `core/org-rules.ts`,
`dashboard/proposalActions.ts`, `dashboard/components/proposals.tsx`, `app/(room)/proposals/`,
`/build/new?proposal=`.

**What it replaces.** The /one-two-new-agent skill's direct inserts into `agents`, `agent_defs` and
`seats`: it now files a pending proposal (source `claude`) that Zak decides here. New agent on Crew
stays the builder: it is already the blank form, and Zak's own tap needs no proposal to approve.

**Checks.** `npm run check`, `npm run check:proposals`, `npm run check:org`, `npm run build`.
