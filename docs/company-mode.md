# Company mode: run the crew like a company

The owner, Nov 15: the Control Room still felt like configuring software. Teaching agents, adding agents
and mapping the org were clunky. He wants to run a fully agentic organization with himself on top:
he sets goals, reacts to work and decides on proposals; heads think and plan, specialists do one
narrow job. Approved design (every board, desktop and phone):
https://claude.ai/artifact/UtmdGkLKTTezQNGmg5oWHu. Status lives on the Build Board, cards Order 80-86.

**Rule for every slice: it deletes what it replaces in the same PR.**

## Decisions (the owner, 2026-11-15, "yes to all")

1. Heads (not leads) give their specialists a weekly focus: a note that expires in 7 days, never
   authority. Leads still only watch. This changes the Nov 13 rule for heads only.
2. Every goal needs a measure counted in code, picked from a list. A goal without one shows
   "No measure yet" and the missing read goes to Find a tool.
3. The owner's reactions save straight away as rules in their words, with Undo. Avery may suggest wording
   or scope; only his tap applies it. Lessons a lead or head proposes still wait for his Keep.
4. Avery becomes the front door: a chat in the app that reads the company's data and can only file
   proposals and save the rules the owner dictates. The outside new-agent skill retires once she can hire.
5. Heads move to Sonnet, medium effort, $0.75 cap a run. Specialists stay on Haiku unless the job
   needs judgment.
6. MCP connections: our runner calls MCP servers itself (never the model provider's server-side
   connector), read tools only, picked one by one; writes only as gateway action types. Klaviyo first.
7. The Desk replaces Today. Editing the org chart by hand stays.

Unchanged: heads never get action tools; new agents start off duty with no actions; every send,
payment or post is a gateway action that starts at Draft; only the owner's taps approve or count toward
promotion; agents stay off until he says launched.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | Teach by reacting | The Memory tab's Teach form; Reject's "proposed lesson" from the owner's own reason |
| 2 | Goals and measures | Today's stat chips |
| 3 | Proposals: hire, grant a tool, new tool, retire | The new-agent skill's direct database writes (New agent stays the builder, see slice 3) |
| 4 | Heads plan, review and set focus | Hand-written focus in department rules |
| 5 | Avery, the front door, and the Desk | The Today page; the outside new-agent skill |
| 6 | MCP connections, Klaviyo first | (new kind of connection) |

## Slice 1: Teach by reacting

**What the owner sees.**

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
- **Heads read it:** "Your team" (`team_report`) now carries each teammate's `fromOwner`: Good and
  Not this counts for the period, and his latest words, plus `aN_zak_good` / `aN_zak_not` numbers.

**What gets saved** (`core/reaction-rules.ts`, pure, `npm run check:reactions`; `core/reactions.ts`).

- One `reactions` row per thing reacted to (a run, a lead in a run, an approval); reacting again
  changes it. It holds the verdict, his words when they became a rule, and the rule's id.
- Not this with words: agent + always is a standing order, agent + 30 days or next run is a note,
  department is a department rule, everyone is a crew line. `source = owner`,
  `source_tag = run:<id>` or `approval:<id>`. The new rule is saved first, then the one it replaces
  is forgotten (so a failed save never loses the old rule). A replaced rule must be kept and in the
  same scope, checked in code.
- The run and lead are looked up on the server: the run must be the agent's, the lead must be from
  that run. Nothing the page sends picks a target.
- Rules are notes like every memory line: they never raise a cap, add a recipient or grant access.

**Data.** Migration `20261120090000_reactions.sql` (the `reactions` table). Until it's applied,
Good and a plain Not this answer that the table isn't there; Not this with words and Reject with
words still save the rule (the toast says it won't show on the scorecard); the scorecard, journal
entries and `fromOwner` are empty.

**What it replaces.** `TeachForm` and the `teach` action (the Memory tab's form and the Overview
Journal's compact copy); `RejectButton`'s "propose a lesson" path in `reject` (the owner's reason is now a
reaction). `proposeLesson` stays for a lead's or head's send-back.

**Checks.** `npm run check`, `npm run check:reactions`, `npm run build`.

## Slice 2: Goals and measures

**What the owner sees.**

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
| Months of runway | floor | Mercury cash ÷ net burn per 30 days over 90 days (`core/money.ts`) |
| Email list size | total, by a date | profiles on the list picked on Connections › Klaviyo, read over Klaviyo's MCP server (slice 6) |
| Your own goal numbers | total or floor | one field of a turned-on custom tool's reply, marked as a goal number on Connections (docs/custom-servers.md, "Goal numbers") |

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
goals need the login only (no Controls), like the org chart. Goal words are the owner's (trusted); the
numbers are code's. Changing a goal's measure starts its pace again from that day (`paced_from`).

**Data.** Migration `20261121090000_goals.sql` (the `goals` table: department, title, measure key,
target, `start_value`, `due_on`, state active / paused / done / dropped, `paced_from`). Removing a
department removes its goals. Until it's applied, Crew and Today say so and Set a goal refuses.

**Code.** `core/goal-rules.ts` (pure: the list, `planGoal`, `progress`), `core/measures.ts`,
`core/goals.ts` (store, `goalProgress` for the tool), `core/money.ts` (moved out of the tool list so
the tools and the measures share one copy), `integrations/shopify/orders.ts` `ordersBetween`,
`dashboard/goals.ts`, `dashboard/goalActions.ts`, `dashboard/components/goals.tsx`,
`dashboard/components/GoalForm.tsx`, `app/(room)/goals/`.

**What it replaces.** Today's stat chips (and their CSS).

**Checks.** `npm run check`, `npm run check:goals`, `npm run build`.

## Slice 3: Proposals

**What the owner sees.**

- **Needs you** says "2 proposals from your heads" and opens **Proposals** (`/proposals`). The
  Approvals item in the sidebar counts proposals too, and the Approvals page leads with a card for
  them when any wait.
- **Proposals** (`/proposals`): Waiting on you, a link to the tools asked for on **Find a tool**,
  and Decided lately with what each yes or no did. (The Build list and Mark built were replaced by
  Find a tool in custom servers slice 3, `docs/custom-servers.md`.)
- **A proposal's page** (`/proposals/[id]`, the Hire artboard): from whom, the department and when;
  **Why** in the head's words; the job (for a hire: seat, job, each run, good result, brain, reads,
  hands you) or what it asks; **What your yes does**; for a hire, the cost cap per run and what the
  department has spent on AI this month; **Checked in code** (name free, seat still open, every tool
  on the list and none an action, starts off duty); and three buttons:
  - **Hire Tate, off duty** (or **Give Rowan "Goal progress"**, **Find a tool for it**,
    **Retire Rowan**, **Close the Follow-ups seat**), with a confirm. Off while a check fails.
  - **Change it first** (hires): the builder with everything filled in and the seat picked. Creating
    the agent there says yes to the proposal (and makes the new seat, if it asked for one).
  - **Not now…** asks why. Words become a 30-day note for the head that asked ("The owner said not now to
    …"), so it doesn't ask again for the same reason next run.
- **Crew > Org chart:** a seat with a proposal waiting shows "Proposal · Hire Tate for Follow-ups"
  (on the open seat, or on the head's seat when the hire asks for a new seat under it). An open
  seat with a waiting hire opens the proposal instead of the builder.

**How a head proposes.** A new report tool, **Propose to the owner** (`propose`, Agents group in builder
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
| new_tool | what to read and from where | opens Find a tool (`/connections/find?for=<id>`): use a connection, add a server by address, or ask for a built-in connector (counted, one Build Board card per service) |
| retire | teammate, or an empty seat | takes the agent off duty and opens its seat; or removes the empty seat |

**After a yes on a new tool.** Nothing is granted and no card is made by the yes itself: it opens
**Find a tool** with the proposal's words filled into the ask. An ask for a connector is counted on
that service's request, which has one Build Board card (see `docs/custom-servers.md`, slice 3).

Brains are Claude only: **quick** (Haiku, low effort, $0.10 cap a run) unless the job needs
judgment, **thinking** (Sonnet, medium, $0.25). A hire gets 12 steps.

**What it never does.** A proposal is words and choices from lists in code; it does nothing by
itself. It can never hand out an action (refused when filed, and again at the tap: actions are
granted in code only). A head can't propose tools for itself or its own retirement, can't close a
head seat, and reaches only its own department. Every check runs again at the owner's tap against the
chart and tool list as they are then. Nothing here runs, sends or spends, so it needs the login
only (no Controls).

**Data.** Migration `20261122090000_proposals.sql` (the `proposals` table: kind, title, source agent
/ claude / owner, from_agent, department, run, the checked plan as `payload`, why, state pending /
accepted / declined / built / failed, outcome, result_ref, decided_at). Until it's applied, the
Proposals page says so and the tool refuses to save.

**Code.** `core/proposal-rules.ts` (pure: kinds, brains, `planProposal`, `proposalTitle`,
`hireSpec`), `core/proposals.ts` (store, resolve against the chart, `acceptProposal`,
`declineProposal`, `markBuilt`, `proposalChecks`, `proposalsBySeat`), the `propose` tool in
`core/tools/catalog.ts`, `headBlock` and the `head` seat scope in `core/org-rules.ts`,
`dashboard/proposalActions.ts`, `dashboard/components/proposals.tsx`, `app/(room)/proposals/`,
`/build/new?proposal=`.

**What it replaces.** The outside new-agent skill's direct inserts into `agents`, `agent_defs` and
`seats`: it now files a pending proposal (source `claude`) that the owner decides here. New agent on Crew
stays the builder: it is already the blank form, and the owner's own tap needs no proposal to approve.

**Checks.** `npm run check`, `npm run check:proposals`, `npm run check:org`, `npm run build`.

## Slice 4: Heads plan, review and set focus

**What the owner sees.**

- **A goal's page** now has the head's week under the number:
  - **"Rico's plan, week of Nov 16"**: when it was written (and the run, to react to), the head's
    words, and its lines. A line is a teammate's **focus for 7 days** ("a note, never authority"),
    a seat **nobody holds yet** (with **Hire proposal waiting** when the head proposed one), or a
    **job for you** ("Rico only suggests") with **Mark done** / undo.
  - **"Rico's review"**: the head's latest words on how the team did, with a link to the run for
    Good / Not this.
  - **"How Rico works"**: model, effort and cap a run, what it reads and hands you, and "Can't send,
    pay or post", all from its live version.
- **Needs you** lists each job for you from this week's plans that isn't done, linking to the goal.
- **An agent's Memory tab**: "Notes and focus" shows its head's focus ("Focus from Rico, until Nov
  23: …", gone after 7 days) above your notes.
- **Avery's brief**: each Departments line is the department's goals with their status, counted in
  code ("Sales: Land 5 wholesale accounts: 1 of 5 won, behind. 3 runs, all OK, $0.12, in the last
  24 hours."), instead of a sentence Avery wrote from the head's report.

**How a head plans.** Two new tools, heads only (`seat: "head"`; the company seat is refused, it
plans no department):

- **This week** (`week_plan`, read): this week's plan for its department if any, its team (live
  agents under its seat), its open seats, and whether this run **plans** (no plan this week yet)
  or **reviews** (the plan exists).
- **Plan and review** (`plan_week`, report): the model hands one line per job (title, who, words),
  at most 8, each checked in code (no links, addresses or phone numbers). Saved after a run that
  finishes: with lines, the run's result is the plan and each line is matched to the chart (a
  teammate under the head, an open seat in its department, or the owner; anyone else is left out and
  the run summary says why). A teammate's line becomes a `focus` memory note for 7 days, replacing
  its earlier focus. Planning again the same week replaces the plan. With no lines and a plan this
  week, the result is saved as the review; with no plan yet, as the plan's words.

Weeks are Chicago weeks starting Monday. Scheduling stays as it is: heads are off duty until
launch, and the first run of a week plans whenever it happens. When heads go on duty, give each a
Monday morning schedule and chain it after its team to get the review.

**Heads to Sonnet (decision 5).** After the migration, each head (Rico, Marlow, Sloane, Morgan) gets
a new **draft** version: Sonnet, medium effort, $0.75 cap a run, with Goal progress, This week,
Plan and review and Propose to the owner added and a paragraph in its job on planning and reviewing. Avery
gets a draft without the "one line per department" paragraph. Nothing changes until an approver taps Try
it and Go live on each.

**What it never does.** A plan grants nothing. A focus is a memory note: it never overrides a rule,
adds a recipient, raises a cap or grants access, and it can't hold a link, an address or a phone
number. A head can't give a focus to anyone outside its team, and a job for the owner is a suggestion they
mark done. Heads still have no action tools. Nothing here runs, sends or spends.

**Data.** Migration `20261123090000_plans.sql`: the `plans` table (department, head, week, words,
lines as `items`, review, the runs that wrote them; one per department per week) and two values on
`agent_memory`: group `focus` and keep `days_7`. Until it's applied the goal page says so, and Plan
and review refuses to save.

**Code.** `core/plan-rules.ts` (pure: weeks, `checkLine`, `resolveWho`, `planItems`, `focusText`),
`core/plans.ts` (`savePlan`, `saveReview`, `setJobDone`, `weekView`, `openJobsThisWeek`),
`setFocus` in `core/memory.ts`, `core/pointer.ts` (the no-address rule, shared with working
memory), the two tools in `core/tools/catalog.ts`, the goal page, `planJobDone`, Needs you, and
Avery's `departmentRuns` / `deptLine`.

**What it replaces.** Avery's free-written department sentence and `departmentLines`, which matched
it to the chart (deleted with their tests); her line is goal status from code. There was no
hand-written focus in department rules to remove (none in the data on Nov 15); a head's focus now
has its own place.

**Checks.** `npm run check`, `npm run check:plans`, `npm run check:runner`, `npm run check:org`,
`npm run build`.

## Slice 5: Avery, the front door, and the Desk

**What the owner sees.**

- **The Desk** is home (`/`, "Desk" in the sidebar). A greeting and one line counted in code ("Two
  goals on track, one behind, one can't be measured yet. Three proposals need you."), the goal
  tiles, each with its head's latest word (the first sentence of the head's own report), then
  **Needs you**: proposals first as cards with Review, then everything else, grouped by department.
- **Avery's chat on every screen.** On a wide screen it's a dark panel beside the page: open by
  default on the Desk, a tab to open it elsewhere (the browser remembers open or closed). On a phone
  it's a bar at the bottom ("Ask Avery, or tell her something") that opens a full sheet. Starters:
  What needs me today?, How are the goals?, Hire someone, What are the heads planning this week?
- **What she can do.** Answer from the company's data. **Save a rule** The owner dictates, for an agent,
  a department or everyone, always in his own words. **File a proposal** (hire, grant a read tool,
  new tool, retire), which waits on Proposals like a head's. Under her reply, code says what it
  actually saved ("Saved for Rowan in your words: “Skip chains.” Undo on the Memory tab.", "Filed for
  you to decide: Hire Tate for Follow-ups. It waits on Proposals."). Each reply links to its run.
- **What she can't do.** Run, start, stop or change an agent; send, buy or post. If the owner asks, she
  says where in the Control Room to do it.

**How it holds.**

- Each message is one run of the agent in the company seat (whoever the chart puts there, not a
  hardcoded id) through `withRun` with trigger `chat`: logged in `agent_runs`, refused when she is
  off duty or over her daily budget or her department's. It needs `DASHBOARD_CONTROLS=on`, like a try.
- The run uses the shared runner with her active spec's model and cost cap (low effort, at most 8
  steps), her read and calculate tools, Goal progress, and three chat-only tools that exist nowhere
  in the builder's tool list: **The crew now** (seats, who's on duty, each agent's last run, this
  week's plans, proposals waiting), **Save a rule** and **File a proposal**.
- A rule's words are checked in code against the owner's message (`inOwnWords`: case, quotes, spacing and
  the closing full stop don't matter; other words are refused). Who it's for is matched against
  the chart (`resolveRuleWho`). It's saved with the same `saveRule` reactions use, so it's a memory
  line (a note, never authority) with Undo on the Memory tab.
- A proposal goes through `fileProposal` with the company seat's reach (any department), checked
  again at the owner's tap. At most 3 rules and 3 proposals from one message, saved only after a run that
  finishes.
- Her memory (her standing orders) is loaded read-only, like a try, so chat doesn't count down
  next-run notes. A chat reply isn't saved as her output, so no agent reads it as a report, and chat
  runs are left out of run counts (Department reports, Your team, the brief's run lines).

**Data.** Migration `20261124090000_avery_chat.sql`: the `avery_chat` table (who said it, the
words, the run that answered, code's notes about what it saved). Until it's applied she still
answers but the conversation isn't kept, and the panel says so.

**Code.** `core/chat-rules.ts` (pure: `cleanMessage`, `inOwnWords`, `resolveRuleWho`, `deptNamed`,
`chatPrompt`, `savedLines`), `core/avery-chat.ts` (`askAvery`, the chat tools, `chatHistory`,
`askedIn` for the replay), `saveRule` in `core/reactions.ts`, the runner's `chat` and `prompt`
options, `dashboard/chatActions.ts`, `dashboard/components/avery.tsx`, `dashboard/desk.ts` (the
greeting and summary line), the Desk page and the layout.

**What it replaces.** The Today page: its live floor map, shift board, spend by agent, memory per
agent and joining the crew are gone with `getMemoryMeters`, `leadsForRun`, `weekFrom` and their
styles (each agent's page still has its map, schedule, spend and memory). The outside new-agent
skill retires: hiring is a proposal from Avery (or a head), and New agent on Crew stays the builder.
The skill lives in the owner's Claude account, so they delete it there.

**Checks.** `npm run check`, `npm run check:chat`, `npm run check:runner`, `npm run build`.

## Slice 6: MCP connections, Klaviyo first

**What it does.** The runner can now call an MCP server itself, through the same gate as every
other tool. Klaviyo is the first. An approver taps **Connect Klaviyo** on Connections, says yes on
Klaviyo's own sign-in page, and four read tools become available in the builder: **Email lists**,
**Email list size**, **Campaign results** and **Flow results**. The **Email list size** goal measure
turns on: the owner picks the list it counts on the Klaviyo panel.

**Why our runner calls the server, not the model provider.** Calls made from our code pass the gate:
the agent's saved tools, the run log, the budget and the untrusted label. A provider-side connector
would call the server where our gate can't see each call, and only for one model.

**The rules.**
- Read tools only, named one by one in `core/mcp-rules.ts` (`MCP_SERVERS.klaviyo.readTools`:
  `get_lists`, `get_list`, `get_metrics`, `get_campaign_report`, `get_flow_report`). `callMcpTool`
  refuses anything else before a request is made. A tool the server adds later does nothing until
  it is named there in a pull request.
- The server's own switches are on too: `read-only=true` (no tool that can change the account) and
  `disable-tools-with-user-generated-content=true`.
- A server's write tools are never called. A write would become a gateway action type that starts
  at Draft, like every action.
- Replies are untrusted data. Each catalog tool turns the reply into rows and adds counts and rates
  up in code (`reportRows`, `reportTotals`, `listSize`), so the model never supplies a number.
- Shopify stays on our read-only app.

**Signing in.** Klaviyo's remote server signs in with OAuth only (dynamic client registration), so
there is no key to paste. Connect follows MCP's auth spec: it finds the sign-in details
(`/.well-known/oauth-protected-resource`, then the authorization server's metadata), registers the
Control Room as a public client, and sends the owner to the server's page with PKCE (S256), a random
state and the `resource` the token is for. The state and verifier wait in a sealed, httpOnly cookie
for 10 minutes. Back on `/connections/klaviyo/callback`, code checks the state, trades the code for
tokens and keeps them in `mcp_connections`, encrypted with AES-256-GCM under a key made from the
service role key (rotating that key just means tapping Connect again). Tokens are refreshed a minute
before they run out and are never sent to the browser. Disconnect forgets them. Both routes check
the login themselves as well as through the proxy. Klaviyo needs an Owner, Admin or Manager to sign
in.

**The client.** `integrations/mcp.ts`: Streamable HTTP, JSON-RPC. Each call is `initialize`,
`notifications/initialized`, then one `tools/call` (a short session per call suits serverless). A
reply can be JSON or an event stream (`parseRpc`); a tool result is read from `structuredContent`
or its JSON text (`toolPayload`).

**Code.** `core/mcp-rules.ts` (pure: the server list, `mayCall`, reply readers, sign-in helpers),
`integrations/mcp.ts` (client, sign-in, encrypted store), `integrations/klaviyo.ts` (lists, list
size, campaign and flow results), the four `klaviyo_*` tools in `core/tools/catalog.ts`, the Email
list size measure in `core/measures.ts`, the Klaviyo connection and panel on Connections
(`dashboard/connections.ts`, `dashboard/connectionActions.ts`, the two routes under
`app/(room)/connections/[id]/`), and `supabase/migrations/20261125090000_mcp_connections.sql`.

**Rule from here on.** A new integration uses MCP when a server exists and fits these rules.
Hand-built tools are for math, reports and gateway actions.

**Checks.** `npm run check`, `npm run check:mcp`, `npm run check:goals`, `npm run build`.
