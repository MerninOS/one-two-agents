# Agent builder

Plan (approved by Zak 2026-11-13): https://claude.ai/artifact/VNbJQM4SMTWDbKH9CfjHMh.
Mockup: https://claude.ai/artifact/FwFFc3nmJK7QuRvag7LAW2.
Epic on the Build Board: "EPIC: Agent builder (build agents from scratch in the app)", slices Order 41-47.

The goal: build an agent from scratch in the Control Room. An agent stops being a program and
becomes a saved spec with eight parts (Trigger, Sources, Standards, Directive, Thinking, Actions,
Guardrails, Output). One shared runner runs every spec the same way: the model picks its own steps
from the tools the spec grants, code runs them, hard limits stop it.

## Decisions (Zak, 2026-11-13)

- Explore runs by hand only: a built agent can't run on a schedule until its first playbook is approved.
- Per-run limits start at 12 tool calls and $0.50; ceilings in code are 30 and $2 (`RUN_LIMITS` in
  `core/agent-spec.ts`). Rowan's spec will start at $1.25.
- Tools are narrow ("Shopify: open orders"), grouped by integration on the builder screen.
- Morgan stays model-free except one judgment step on burn rate. Burn rate and runway are worked
  out in code (`calc_burn_rate`); the judgment step only reads those numbers.
- Earlier: the first playbook needs Zak's approval, later versions apply automatically with a diff,
  and drop back to approval after a failed run or a rejected action. Claude models only. Avery,
  Rowan, Quinn and Morgan are rebuilt on the runner.

## Slice 1: the tool list and the runner (built)

- **Tool list** (`core/tools/catalog.ts`, types in `core/tools/types.ts`): 14 Read and Calculate
  tools built from code the agents already use. Every tool is read-only, takes only checked inputs
  (a whole number in a range or a choice from a fixed list, never a URL, address or free text),
  says whether what it returns is trusted, which settings it needs, and returns the numbers it
  computed in `numbers`. Untrusted: Mercury charges (merchant names), other agents' runs, Rowan's
  leads. `notion_read_page` opens only pages the spec lists, picked by id.
- **Spec** (`core/agent-spec.ts`, table `agent_defs`, versioned like `agent_setup`, one active per
  agent): name, mandate, directive, what a good result looks like, Claude model and effort, tools,
  Notion pages, limits. `readSpec` checks it against code: an unknown tool, a non-Claude model or a
  tool kind not available yet is left out and named; a limit above the ceiling is refused, never
  clamped. Slice 1 grants Read and Calculate tools only.
- **Runner** (`core/runner.ts`, `runExplore`): the Claude tool-use loop. The locked safety block
  (`SAFETY`) goes first, then the directive, then memory. Only granted tools are offered and only
  granted tools run. Each result goes back inside `<tool_data trusted="yes|no">`, cut to 12,000
  characters. Before every model call the runner works out the worst that turn could cost and stops
  if it would pass the cost limit; after the step limit the model gets one turn to finish. A run that
  hits a limit ends `ok` with a summary saying where it stopped and `metrics.finished = 0` (the cost
  is still recorded against the budget). Every model turn and tool call is saved in `run_steps`.
- **Scratch agent**: migration `20261113120000_agent_builder_runner.sql` adds `agent_defs`,
  `run_steps` and an agent `scratch` (off duty, $1 a day) with spec v1, a green cover check on
  Claude Haiku 5.5.
- **Runner test page** (`/lab`, System, Runner test): the scratch agent's spec and tools (Connected
  or Missing key), a free tool check (each tool once with default inputs, no model, nothing
  written), Preview (a real explore run, needs `DASHBOARD_CONTROLS=on`, logged as trigger
  `preview`, counts against the daily budget) and the latest runs step by step. Replaced by the
  builder screen in slice 2 (`/lab` now redirects to `/build`).
- Lint: `core/gateway` and `integrations/` may not import `core/agent-spec` or `core/runner`.
- `npm run check:runner` tests limits and refusals with a stand-in model (no network, no cost).
- "Pause all agents" now takes every agent off duty, including ones built in the app.

## Slice 2: the builder screen (built)

- **Agent builder** (`/build`, Crew menu): every agent built in the app, and **New agent** (a name,
  one line on its job, and Blank or a copy of another built agent). A new agent gets an id
  `b_<name>`, is off duty with no schedule and $1 a day, and its spec is saved as v1. No migration:
  it uses the slice 1 tables.
- **Builder screen** (`/build/<id>`, `app/(room)/build/[id]`, `dashboard/components/Builder.tsx`):
  the eight parts as one draft.
  1. Trigger: By hand only. After another agent and On a schedule are shown but locked until the
     first playbook is approved (slice 4).
  2. Sources: the Read and Calculate tools grouped by integration, with Untrusted and Missing key
     labels; Notion pages that `notion_read_page` may open, added by link (stored by id).
  3. Standards: the agent's standing orders and the crew rules from the memory store. Adding or
     forgetting a standing order saves straight away (same store and rules as the Memory tab).
  4. Directive: directive, what a good result looks like, the locked safety block.
  5. Thinking: Claude models only, effort.
  6. Actions: none grantable yet (slice 5); says so.
  7. Guardrails: tool calls and cost per run (ceilings 30 and $2), daily budget (ceiling $50, saved
     straight away), the locked crew hard rules.
  8. Output: the output name other agents will see (`outputName` in the spec, used in slice 3).
- Side panel: an explore-run estimate from model prices and ticked tools (capped at the cost limit),
  a free **Tool check** of the draft, **Preview** of the draft (a real explore run, needs
  `DASHBOARD_CONTROLS=on`, logged as `preview`), and **Save as vN** with a note.
- **Versions**: saving adds the next version and makes it active (`saveSpecVersion`); any earlier
  version can be made active again (`activateSpecVersion`). A version that raises the cost or step
  limit (`specLooser`) needs a confirm and `DASHBOARD_CONTROLS=on`; lowering never does. The
  agents row's name and model follow the active version.
- Latest runs step by step, as on the old test page (`dashboard/components/RunSteps.tsx`).

## Slice 3: outputs as sources (built)

- **One output per run**: migration `20261113150000_agent_outputs.sql` adds `agent_outputs` (one row
  per run: the spec's output name, the model's summary, traced numbers, finished or not). The runner
  saves it after the run, next to its steps; a failure to save only notes itself in the summary.
- **Numbers trace to a tool result**: every tool result the model sees ends with the numbers code
  computed and the step they came from. `finish` takes `numbers: [{ label, step, key }]`; code
  (`traceNumbers` in `core/runner.ts`) copies each value from that step's `numbers`. A number that
  doesn't point at a successful tool step in the same run is left out, and the summary says how
  many were. The model never types a value.
- **Reading another agent's output**: Read tool `agent_output` (group "Other agents' outputs",
  untrusted). It reads the latest *finished* output of an agent listed in the spec's `readsFrom`
  (picked on the builder screen, never chosen by the model), returns the words as another agent's
  and the numbers under keys `n1`, `n2`… in the tool's own `numbers`, so the reading agent can cite
  them in turn. "Numbers are computed in code" holds down a chain of agents.
- Builder screen: Sources shows the agents it may read from when the tool is ticked; Output shows
  the latest output with each number and the tool it came from.

## Slice 4: playbooks (built)

- **Tables** (migration `20261113170000_agent_playbooks.sql`): `agent_playbooks` (versioned per
  agent: steps `[{ tool, input }]`, status proposed / approved / rejected / replaced, the run it came
  from, what changed, whether it applied on its own; one approved at a time) and
  `agent_playbook_holds` (an agent whose next playbook must wait for Zak, and why).
- **Drafting** (`core/playbook.ts`, no model): after an explore run that finished, code takes the
  tool calls that worked, in order and without repeats (`draftSteps`). The first one is proposed for
  Zak's approval; he can drop steps before approving.
- **Following** (`runExplore` with `playbook`): code makes the playbook's tool calls (each checked
  against the spec and its inputs again, counted against the step limit), then the model is offered
  only `finish` and writes the result from the data, citing numbers by step as in slice 3. If a step
  fails or is no longer granted, the run **falls back** to exploring with the agent's tools, and the
  summary says so.
- **Updates** (Zak, Nov 13): with an approved playbook and no hold, a playbook drafted from a
  **Re-explore** applies on its own (`auto`), with what changed (`stepChanges`). A run that falls back
  or doesn't finish puts the agent **on hold**: the next draft waits for approval, and approving
  clears the hold. Rejected actions will do the same from slice 5.
- **Builder screen**: Preview follows the approved playbook (or explores when there is none);
  Re-explore forces an explore run. A Playbook card shows the hold, a draft waiting for approval
  (tick the steps to keep, Approve or Reject), the approved steps, and the history. Latest runs say
  whether a run explored, followed the playbook or fell back.
- Running on a trigger stays locked: it arrives when the four agents move to the runner (slices 6-7).
- Lint: `core/gateway` and `integrations/` may not import `core/playbook` either.
- Clicking Re-explore after a change is still by hand; marking the playbook stale on a directive
  change is left for later.

## Slice 5: reports and actions (built)

- **Report tools** (kind `report`): `report_email_zak` (through `integrations/email.ts`, which has
  no recipient argument, so only `BRIEF_TO`) and `report_notion_page` (a new page under the page
  picked on the builder screen, `reportPage` in the spec, stored by id). The model is never offered
  a report tool. After a run that **finishes**, code delivers the result and its traced numbers to
  every ticked report; a run that stops early sends nothing. Each delivery is a step in Replay.
- **Action tools** (kind `action`): `mercury_propose_annotation` (a category and/or memo on a
  Mercury charge, gateway tool `mercury.annotate_transaction`, Draft). The model calls it during
  the run; code only **stages** a proposal (`stage`, which runs the gateway's own
  `refuseProposal`). After a run that finishes, the runner queues each one with `propose` in
  `core/gateway`, which checks it again and puts an approval card in Approvals. Up to
  `MAX_ACTIONS` (10) a run. Applying an approved one is unchanged (`applyApproved`, live re-check).
- **Picks, so untrusted text can't choose**: an action names a charge or a category only as a row a
  tool returned in the same run, by `{ step, pick }` (new param type `pick`). Tools that return such
  rows give each a code-made pick (`c1`… in Charges, `k1`… in the new read tool `mercury_categories`)
  and the real id stays in code. A pick that isn't in that step, or is the wrong kind, is refused.
  The only free text an action takes is a param of type `text`: short, trimmed, no links, no
  control characters. A merchant name or a web page can't pick a recipient, URL, product or
  category.
- **Who may act**: the gateway's allow-list stays the authority (hard rule: Mercury writes only for
  `cfo` and `bookkeeper`). An action tool carries those agents (`agents`); the runner offers it only
  to them, `readSpec(raw, agentId)` names it as a problem for anyone else, and a copied agent
  leaves action tools behind. So a `b_…` agent can't propose yet; Morgan and Quinn get it when they
  move to the runner (slices 6-7).
- **Preview** has a **Deliver** switch (shown when the draft has a report or action): off, nothing
  is sent or queued and the summary says what would have gone out; on, a finished preview sends its
  reports and queues its proposals.
- **Saving** a version that adds a report or action, or points a Notion report at another page,
  counts as reaching further (`specLooser`): it needs a confirm and `DASHBOARD_CONTROLS=on`.
- **Rejected actions**: rejecting a card from an agent with an approved playbook puts it on hold
  (`holdAfterRejection`), so its next playbook waits for Zak.
- Proposals and reports are never playbook steps (`draftSteps` keeps read and calculate calls). A
  playbook run offers the agent's action tools plus `finish`, so the model still decides what to
  propose from the data the playbook gathered.
- Not in this slice: a Gmail draft action and saving to the leads list. Both depend on Rowan's leads
  and the Gmail compose token, so they arrive with Rowan in slice 7.
- No migration.

## Slices

1. Tool list and runner (built).
2. Builder screen: New agent, the eight sections, Preview, versions (built).
3. Outputs as sources: every run saves one named output; numbers must trace to a tool result (built).
4. Playbooks: explore, approve, follow, fall back, auto-update, drop back, Re-explore (built).
5. Report and Action tools, actions only through `core/gateway` (built; Gmail draft and leads list move to slice 7).
6. Morgan (with the burn rate step) and Avery on the runner.
7. Rowan and Quinn on the runner (with the Gmail draft action and the leads list report); retire
   the old agent code, menus and Setup tab.
