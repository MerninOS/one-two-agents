# Agent setup

Design (approved by Zak 2026-11-12): https://claude.ai/artifact/WvLXFtHnHbd2J94j6vQhmb.
Epic on the Build Board: "EPIC: Customizable agents (Agent Setup + canvas editor)".

The goal: every phase of an agent's loop (Trigger, Reads, Memory, Thinking, Guardrails, Writes)
is visible and, slice by slice, editable in the Control Room, instead of being spread over code
constants, prompt files, `vercel.json`, env vars and `policies`.

## Three homes for every setting

| Home | What lives there | How it changes |
| --- | --- | --- |
| App | A choice among things already built: model, tuning numbers, instructions (later: fact sources, outputs, schedule) | The Control Room, saved as a versioned setup |
| Code | The hard rules, ceilings, and anything that gives an agent a new ability (an integration, a fact source, an output, a gateway action type) | A reviewed pull request |
| Vercel | Keys and tokens | Vercel settings. The app shows Connected or Missing key, never a value |

A fourth label, Database, marks a value that is a row in Supabase but has no screen yet
(for example `policies.memory_budget_tokens`).

## Menu and setup

- **Menu** (`agents/<folder>/menu.ts`, listed in `agents/menus.ts`): what the agent is able to do.
  Its thinking step and the models that step may use, its fact sources, its outputs, every tuning
  number with a default, lowest and highest value, and the built-in instructions.
- **Setup** (table `agent_setup`): what Zak picked from the menu. One row per version, one active
  per agent, with a note. `agent_runs.setup_version` records which version a run used
  (null = the menu's built-in defaults).

`core/setup.ts` lays the active row over the menu's defaults (`resolveSetup`, pure code):

- A value the menu doesn't offer (a model not on the step's list, a number outside its range, a
  key the agent doesn't have) is ignored, the default is used, and the run summary and the canvas
  say so. Nothing is clamped into a value Zak didn't pick.
- A setup that can't be read (table missing, Supabase down) never stops a run: the agent runs on
  the menu's defaults and the summary says so.
- `withRun` loads the setup for real runs, next to memory, and passes it to the job. A dry run
  loads its own and reports it in its summary.

## Rules

- A setup can only pick from the menu. It can't add an integration, a fact source, an output or a
  gateway action type.
- A setup is choices, never authority. `core/gateway` and `integrations/` may not import
  `core/setup` (lint enforces it), the same way they may not import memory.
- Only models with a price in `integrations/anthropic.ts` may be listed in a menu, so cost is
  always computed in code. An agent refuses to run on a model without a price before it reads or
  sends anything.
- The Guardrails box lists only what code enforces. Instructions and standing orders are guidance
  the model reads, so they sit in Thinking and Memory.
- Trust levels (Draft, Act with undo, Act) are not a setting. They move only through the
  promotion card.

## The agent canvas

`/agents/<id>?tab=setup`. Built on React Flow (`@xyflow/react`), in
`dashboard/components/AgentCanvas.tsx`; `dashboard/canvas.ts` builds its data on the server.

- **Replay** shows what the latest real run did, like the Live floor.
- **Edit** shows the setup box by box. Clicking a box lists every value behind it, its home
  (App, Code, Vercel, Database), where to change it, and Connected or Missing key for anything
  that needs a key. Edit is read-only in slice 1.
- On a phone the boxes stack, like the Live floor.
- An agent without a menu yet (Morgan, Rowan, Quinn) still gets the canvas; its values all read
  Code until its menu is written (slice 7).

Mission control's Live floor and the run replay page still use `RunCanvas.tsx`. They move to the
new canvas when Edit mode is real (slice 2).

## Slices

1. Setup store and the read-only canvas (this document). Avery reads its model, effort,
   instructions and low-green warning from its setup; version 1 holds the values it already had.
2. Edit mode: Thinking for Avery (model, effort, instructions with a locked safety block,
   preview, versions, roll back).
3. Model choice across providers.
4. Reads and Writes editable for Avery.
5. Crew canvas: triggers and chains.
6. Guardrails box and caps.
7. Menus for Rowan, Quinn and Morgan.
