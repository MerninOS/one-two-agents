# Builder flow

Zak, Nov 13: the agent builder was confusing (Preview vs Compare, code vs runner, one giant page, picking access). The fix is a guided flow, one step per screen, with sources and actions grouped by integration, and a cleanup of the parts of the Control Room it replaces. Approved mockup: https://claude.ai/artifact/7CMrevM88XBcFDtkVWzfeX (the flow, every screen in order, and a Cleanup map board). Status lives on the Build Board, epic "Builder flow" (cards Order 50-56).

**Rule for every slice: it deletes what it replaces in the same PR.** No second way to do the same thing is left behind.

## The flow

1. The job: what the agent does and what a good result looks like (templates to start from).
2. Connections: pick an integration, then tick what it can read there; anything it can do there is an approval card, and only where code allows.
3. What it hands you: reports (email to Zak, Notion, saved for other agents, always on).
4. Brain and budget: Quick / Balanced / Deep, a cost cap per run, step limit under Advanced. Save shows the agent map.
5. Try it: runs the draft on today's data, plays on the map, sends and saves nothing, shows the result next to today's version.
6. Go live: only after a try where every step worked. Approve the routine once; versions with Go back.

Flow feel: a card per step that slides in, a 6-segment progress bar that fills as you answer, a "so far" rail that grows into the map on save, Enter to continue, Esc to leave, reduce-motion respected.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | Connections page + Switch fix | Access page, Integrations page, agent Access tab, the hand-written `ACCESS` map |
| 2 | The flow, steps 1-4 | Builder page's eight sections, the Setup tab and its four editors |
| 3 | The agent map | RunCanvas (AgentCanvas and `dashboard/canvas.ts` went with the Setup tab in slice 2) |
| 4 | Try it and Go live | Preview, Compare, Deliver checkbox, Switch, EnginePanel, /lab |
| 5 | Menu and tabs | Run log + replay become Runs; crew canvas becomes Crew > Schedule; Memory and Shift leave the menu and tabs |
| 6 | Retire the old agents | Each agent's own run path and menu, the setup store, `on_runner` (after Zak takes all four live) |

## Slice 1: Connections

**Why.** Who can reach what lived in three places (Access matrix, Integrations page, each agent's Access tab), all drawn from a hand-written map that no longer matched what an agent can really use: since the runner, that is the list of tools in its active saved setup (`agent_defs.spec.tools`).

**What it is.**

- `dashboard/connections.ts` is the one place that knows the integrations. Each connection has a name, what it is and its limits in plain words, and the settings checks behind it (`dashboard/data.ts` `health`). Six are outside services (Shopify, Mercury, Gmail, Notion, Email to you, the web) and three are built in (Your other agents, Control Room data, Math done in code). Claude API and Supabase are listed under Behind the scenes.
- Every tool in `core/tools/catalog.ts` belongs to one connection through its `group`, and to one of three kinds: **Can read** (read and calculate tools), **Can do** (action tools: always an approval card, and only for the agents the gateway allows), **Hands you** (report tools, delivered by code after a finished run).
- Who has what comes from the active saved setups, loaded once in `getFloor` (`grants`, plus `setupNames` for agents built in the app). `reachOf(agentId, grants)` gives one agent's connections with the strongest kind it has there; `usersOf` and `usersOfCheck` give the agents behind a connection or one of its settings.
- `/connections`: a tile per connection (set up or not, how many agents use it). Opening one shows what it is, which settings are missing and how to set them, then Can read, Can do and Hands you, each tool with its description, an Untrusted tag when what it returns comes from outside One Two, the gateway's agent rule for actions, and the agents that have it. The hard rules sit below as "Always on, for every agent".
- Nothing is granted on this page. Granting is step 2 of the builder (slice 2), and code decides what can be granted at all.

**What it replaces.** `/access` and `/integrations` redirect to `/connections`. The agent Access tab is gone (the profile's Toolbelt now reads from the saved setup and links each connection). `ACCESS`, `INTEGRATIONS` and `Level` are deleted from `dashboard/crew.ts`; Needs you, the Live floor canvas, the run replay canvas, the Setup canvas and the Memory tab's "Facts it may claim" all read from `connections.ts`. The menu has one Connections item under Trust.

**Note.** Morgan, Avery, Rowan and Quinn still run their own code until Zak takes each live (slice 4). Their saved setups were written to match that code, so what Connections shows for them is what they reach either way. Planned agents have no saved setup yet, so they show nothing until they are built.

**Fold-in fix: Switch with failed steps.** `dryRunPlaybook` returned status ok even when playbook steps failed, and Switch only checked the status, so an agent could be switched to the runner with broken steps. It now also returns how many steps failed and how many there were, and Switch refuses unless there is at least one step and none failed, naming the failed ones. Slice 4 replaces Switch with Go live, which keeps the same rule.

**Checks.** `npm run check`, `npm run build`. No migration.

## Slice 2: The flow, steps 1-4

**Why.** The builder was one long page of eight sections, and the four older agents had a second editor (the Setup tab: a canvas with Reads, Thinking, Writes and Guardrails editors) over a different store. Two ways to change an agent, neither one guided.

**What it is.**

- `/build/new` and `/build/[id]?edit` open the flow (`dashboard/components/Flow.tsx`). One card per step slides in (back slides the other way), a 6-segment bar fills as you answer (steps 5 and 6 are counted and come in slice 4), and a "so far" rail grows a line and a few chips per answer; tap a step to go back. Enter continues (Ctrl or Cmd+Enter inside a text box), Esc leaves, and "reduce motion" turns the slides into fades.
- The steps come from `STEPS` in `dashboard/flowSteps.ts` (pure helpers shared with the page: summaries, presets, cost estimate, problems, what a save loosens). A step can be added later without reworking the shell, which is how departments arrive (a Team step: department and who it reports to).
  1. **The job:** name, its job in your words, what a good result looks like, one line for the agent list. A new agent can start from any built agent's answers (actions stay behind: the gateway names its agents). Standing orders sit under "Rules it always follows" and save straight away, as before.
  2. **Connections:** a tile per connection that has something to read or do. Opening one shows Can read (tick to grant) and Can do (always an approval card; a tool the gateway doesn't allow for this agent is shown locked with the reason). Notion pages and which agents it reads from are picked in their connection. "See what it finds today" is the free tool check on the draft.
  3. **Hands you:** each report tool as a card (email to Zak, Notion page with its page picker, Briefs row when that report exists), plus "Save it for your other agents", always on, with the output name. This saved output is what a head will read once departments exist.
  4. **Brain and budget:** Quick, Balanced, Deep (the cheapest, middle and priciest Claude model with low, medium, high effort), each with its estimate; the cost cap per run; the daily budget (saved straight away); step limit, exact model and effort under Advanced. Budgets stay per agent so they can later sit under a department budget.
- Save is the last step. An existing agent saves the next version (the note is optional: it defaults to the steps that changed), with the same confirm and Controls rule as before when it loosens anything. A new agent is created off duty as v1 (`createBuilt` in `dashboard/actions.ts`, checked by `readSpec` like any save).
- The draft is kept on this device (localStorage) until it is saved or discarded; coming back offers "Pick it up" or "Discard it". Nothing reaches the agent until Save.
- `/build/[id]` without `?edit` shows the agent so far (the same rail, each step links into the flow; the agent map since slice 3), its latest result, then what slice 4 replaces: Try it for now (tool check, Preview, Deliver), Compare and Switch, the playbook, versions and latest runs.

**What it replaces.** The builder page's eight sections and New agent form (`Builder`, `NewAgentForm`, `createAgent`). The agent profile's Setup tab and everything only it used: `AgentCanvas.tsx`, `dashboard/canvas.ts`, `setupEditor.tsx`, `ThinkingEditor.tsx`, `ReadsWritesEditor.tsx`, `GuardrailsEditor.tsx`, the setup editor actions (`previewSetup`, `saveSetupVersion`, `rollBackSetup`, `findNotionTargets`), `getSetup`, `getSetupEditor`, `runSetupVersion`, `getMemoryMeter`, `dashboard/diff.ts`, the setup store's edit functions in `core/setup.ts` and Avery's Setup preview (`previewBrief`). The profile gets "Edit in the builder" instead. The money and email caps, which were only editable in the Guardrails box, are now edited on Settings (`CapForm`, same rules: lower any time, raise with a confirm and Controls on, never past the limit in code). Dead CSS went with them.

**Note.** Morgan, Avery, Rowan and Quinn keep running their own code with their last saved setup (`agent_setup`) until each goes live on the runner; their runner spec is what the flow edits. The setup store itself is retired in slice 6.

**Checks.** `npm run check`, `npm run build`. No migration.

## Slice 3: The agent map

**Why.** What an agent is was shown three different ways: the "so far" rail on its builder page, the Live floor canvas on Today and the canvas on each run replay (RunCanvas). RunCanvas was drawn by hand, the same six boxes for every agent with special cases by agent id, so it couldn't show what a built agent really reads or hands you.

**What it is.**

- One map, drawn from the saved spec (`dashboard/agentMap.ts` builds it, `dashboard/components/AgentMap.tsx` draws it): When (schedule and chain, or the run's trigger), Reads (memory, then each read and calculate tool by its connection, and each agent it reads from), Thinks (model, effort, the job, the cost estimate and cap), Hands you (each report, each action marked "asks you first", and the saved output by name) and Used by (agents whose spec reads this one's result; a dashed "Nobody yet" box when none). Nothing is drawn per agent by hand.
- The columns are a list (`MAP_COLS`), so the departments epic adds "Reports to" (and a head's team outputs under Reads) without reworking it. Used by is already drawn from data, which is how a head reading its team will show.
- On `/build/[id]` it replaces the "so far" rail: every box links to the step that changes it. Right after a save (`?saved`) the page says "Saved. Here's ..." and the map builds itself box by box, then lines; "reduce motion" shows it at once.
- On Today (Live floor) and on run replay it replaces RunCanvas, with the run laid over it: runs on the runner light each tool by its calls in `run_steps` (worked, failed, not used, time taken); runs of an agent's own code log no steps, so only the brain shows how the run went (tokens, cost, working or failed). Today keeps the run's summary, time, cost and Rowan's new leads under the map.
- Laid out on a 1220-wide grid and stretched to the space there is, with a minimum width (it scrolls inside its box below that). Phones get the columns stacked, without lines.

**What it replaces.** `RunCanvas.tsx`, the read-only builder rail with edit links (`SoFar` is now private to the flow), and their CSS (`.canvas-inner`, `.node`, `.node-line`, `.node.out`, `.progress`, `acrPulse`, `.bf-rail.still`).

**Checks.** `npm run check`, `npm run build`. No migration.

## Slice 4: Try it and Go live

**Why.** Testing and switching were five overlapping things: Preview (with a Deliver checkbox that could really send), Compare (two dry runs side by side), Switch (code vs runner), the engine panel and the playbook panel, and every save went straight to what runs. The known Switch-with-failed-steps gap was fixed in slice 1; this slice removes the second way to do it.

**What it is.**

- **A save is a draft.** Saving in the flow adds the next version without making it active (`saveSpecVersion` in `core/agent-spec.ts`; `draftOf` finds the draft: the newest version when it is newer than the live one). Today's version keeps running. The flow edits the draft when there is one. Nothing about a save needs Controls or a confirm any more: that moved to Go live, where it changes what runs.
- **Step 5, Try it** (`tryBuilt`): one real run of the draft (else the live version) on today's data, logged as trigger `preview` with `metrics.spec_version`. It sends nothing, queues nothing and saves no output for other agents (`runExplore`'s `trying` option). Its steps are saved as they happen, and the page polls `/build/[id]/try` so the map plays the run: each read gets a tick or a cross with its time, the brain glows while it works, and the boxes for reports, actions and the saved output say "not sent / not queued / not saved in a try". Afterwards the result sits next to what today's version last handed you (the latest finished run that wasn't a try), with a verdict: "Every step worked. Go live is unlocked." or "Go live is locked: the latest try …". "Try fresh" lets the model pick its own steps instead of following the routine. Needs Controls on, counts against the daily budget, may run off duty (as Preview did).
- **Step 6, Go live** (`goLive`): makes the version the one that runs, only when its latest try ran to the end with every tool step working and without leaving its routine (checked in code from the run log and `run_steps`, `lastTry` in `dashboard/builder.ts`). It approves the routine that try drafted (Zak can untick steps), refuses when there is no routine at all, and for Morgan, Avery, Rowan and Quinn turns `on_runner` on. Controls on, and a confirm naming anything that lets it do or spend more. On or off duty, schedules and chains never change here.
- **Go back:** an older version is one tap (`goBack`, the same confirm when it loosens anything). A version newer than the live one needs a try and Go live. Morgan, Avery, Rowan and Quinn also get "Go back to its own code" once live (`backToOwnCode`).
- The run replay calls a try a try.

**What it replaces.** `previewBuilt` and its Deliver checkbox, `compareEngines`, `switchEngine`, `approveBuiltPlaybook`, `rejectBuiltPlaybook` (and `rejectPlaybook`), `activateSpec`, `OWN_JOBS` in `agents/registry.ts`, `looserThan` in the flow, `dashboard/components/Builder.tsx` (TryPanel, SpecVersions, EnginePanel, PlaybookPanel) and the `/lab` redirect. `dryRunPlaybook` stays: it is what a Dry run of a live runner agent does.

**Checks.** `npm run check`, `npm run check:runner`, `npm run build`. No migration.

## Slice 5: Menu and tabs

**Why.** The menu had grown to ten items in three groups, with two ways into the same thing (Run replay and Run log, Crew profiles and Memory, Crew canvas and each agent's Shift tab), and each agent had five tabs plus an "Edit in the builder" button.

**What it is.**

- **The menu is six places:** Today, Approvals, Crew, Runs, Connections, and Settings at the bottom (`app/(room)/layout.tsx`). Crew stays lit on an agent's pages and the builder; Runs stays lit on a replay. `SideLink` takes a list of paths to match instead of a tab.
- **Crew** (`/crew`) lists every agent as a card (state, job, schedule, live version, last run), agents built in the app that aren't one of the crew in code, and the planned crew, with **New agent** (the flow). Its **Schedule** view (`/crew?view=schedule`) is the old Crew canvas, the one place a schedule or chain is turned on.
- **Each agent has four tabs** (`AgentTabs` in `dashboard/components/ui.tsx`): **Overview** (was Profile: on/off switch, last run, live version, Toolbelt, Journal), **Edit** (the builder page `/build/<id>`: map, Try it, Go live; shown once the agent has a saved setup), **Memory**, **Runs** (each with its replay). The agent chips in the top bar keep you on Edit when you switch agents there.
- **Runs** (`/runs`) is the run log; a row opens its replay.

**What it replaces.** The Floor / Crew / Trust menu groups, the Run replay item and `/runs/latest`, the Run log and Crew canvas names, the Memory and Crew profiles items, the Agent builder item and its list page (`/build` now redirects to Crew), the agent Shift tab (the schedule shows on Overview and in Go live, and is edited in Crew > Schedule), the agent Settings tab and `setBudget` (the daily budget is in step 4, `setBuiltBudget`; the read-only facts are on Overview), and the "Edit in the builder" button. The budget alert in Needs you opens step 4.

**Note.** Agents built in the app (not in `dashboard/crew.ts`) open straight on their builder page, which keeps its own latest runs list until slice 6 gives every agent the same profile and replay.

**Checks.** `npm run check`, `npm run build`. No migration.

