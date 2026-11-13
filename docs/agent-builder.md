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

## Slices

1. Tool list and runner (built).
2. Builder screen: New agent, the eight sections, Preview, versions (built).
3. Outputs as sources: every run saves one named output; numbers must trace to a tool result (built).
4. Playbooks: explore, approve, follow, fall back, auto-update, drop back, Re-explore.
5. Report and Action tools, actions only through `core/gateway`.
6. Morgan (with the burn rate step) and Avery on the runner.
7. Rowan and Quinn on the runner; retire the old agent code, menus and Setup tab.
