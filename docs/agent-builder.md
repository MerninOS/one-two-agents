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
  `preview`, counts against the daily budget) and the latest runs step by step. The builder screen
  replaces it in slice 2.
- Lint: `core/gateway` and `integrations/` may not import `core/agent-spec` or `core/runner`.
- `npm run check:runner` tests limits and refusals with a stand-in model (no network, no cost).
- "Pause all agents" now takes every agent off duty, including ones built in the app.

## Slices

1. Tool list and runner (built).
2. Builder screen: New agent, the eight sections, Preview, versions.
3. Outputs as sources: every run saves one named output; numbers must trace to a tool result.
4. Playbooks: explore, approve, follow, fall back, auto-update, drop back, Re-explore.
5. Report and Action tools, actions only through `core/gateway`.
6. Morgan (with the burn rate step) and Avery on the runner.
7. Rowan and Quinn on the runner; retire the old agent code, menus and Setup tab.
