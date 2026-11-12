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
  always computed in code. An agent refuses to run on a model (or fallback model) without a price
  before it reads or sends anything.
- The safety block is locked. It lives in the agent's code (`agents/chief-of-staff/prompt.ts`,
  `SAFETY`), is sent first on every model call, and a setup can only replace the instructions
  after it. The canvas shows it so nothing is hidden.
- Loosening means a costlier model, a costlier fallback or more effort. Saving or rolling back to
  a costlier setup needs a confirm and `DASHBOARD_CONTROLS=on`; the server checks both
  (`loosening` in `core/setup.ts`). Cheaper changes and instruction edits need only the login.
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
  that needs a key. Boxes marked Edit open an editor; the rest are read-only for now.

## Editing Thinking (slice 2)

`dashboard/components/ThinkingEditor.tsx`, data from `getThinkingEditor` in `dashboard/data.ts`,
actions `previewSetup`, `saveSetupVersion` and `rollBackSetup` in `dashboard/actions.ts`.

- Model, effort and fallback model come from the menu's list; instructions are free text up to
  6,000 characters under the locked safety block.
- The fallback model is tried once when the main model can't be reached (an API error), before
  the fixed rules. A refusal is handled separately by the Claude API's own server-side fallback.
- Cost per run, now and with the draft: the price table times the average tokens of the last 10
  real runs that called a model.
- A change is a draft (kept in this browser) until it is saved as a new version with a note.
  Saving switches the old version off and the new one on. Roll back makes an older version
  active again; nothing is deleted.
- Preview runs the draft for real on today's facts and memory and shows the email, the Briefs
  row, the watch list, the focus and what it would remember. It writes nothing: no Notion, no
  email, no memory written or counted down. Its one model call is logged with trigger `preview`
  so the cost counts against the daily budget. Previews stay out of the floor, the run log,
  Replay and Avery's own "What ran". A preview may run while the agent is off duty (it acts on
  nothing) and needs `DASHBOARD_CONTROLS=on` because it spends money.
- On a phone the boxes stack, like the Live floor.
- An agent without a menu yet (Morgan, Rowan, Quinn) still gets the canvas; its values all read
  Code until its menu is written (slice 7).

Mission control's Live floor and the run replay page still use `RunCanvas.tsx`. They move to the
new canvas with the crew canvas (slice 5), so both views change once.

## Models across providers (slice 3)

`integrations/models.ts` is the one list of models: id, label, provider, route, price per
million tokens in and out, and abilities (`structured-output`, `anthropic-web-search`, `pdf`,
`reasoning`). Cost is always the token counts times this table, in code
(`costUsd` in `integrations/anthropic.ts`). A model that isn't in the list can't be picked, and a
stored id that falls off the list is ignored like any other invalid setup value.

- Each menu step says what it `requires`; its picker lists only models with those abilities
  (`modelsFor`). Avery's step requires `structured-output` because the answer must be the watch
  list, focus and memory shape.
- Claude models go straight to the Claude API (`ANTHROPIC_API_KEY`), so they keep effort, the
  server-side refusal fallback and Anthropic's own tools.
- OpenAI and Google models go through Vercel AI Gateway's Anthropic-compatible endpoint
  (`integrations/gateway.ts`). On Vercel the deployment signs in by itself (OIDC); elsewhere
  `AI_GATEWAY_API_KEY`. No key ever goes in the app or the database. Effort maps to a thinking
  budget of about 1K, 4K or 10K tokens.
- Every answer is checked in code. A reply in the wrong shape counts like an unreachable model:
  the fallback model is tried once, then the fixed rules.
- The run summary names the model that wrote the brief, and the run replay splits cost by the
  model whose price matches the logged cost.
- Privacy: picking a non-Claude model sends today's facts and Avery's memory to that provider
  through Vercel. The editor says so under the picker.
- Gateway prices in the list are list prices as of 2026-11-12. Changing a price or adding a
  model is a pull request.

## Reads and Writes (slice 4)

`dashboard/components/ReadsWritesEditor.tsx`; the shared draft, Preview, save and versions are in
`dashboard/components/setupEditor.tsx`. One draft covers every box: changes in Reads, Thinking
and Writes are saved together as one version.

- Reads: each fact source in the menu on or off, plus the reads tuning numbers within their range
  (Avery: low-green warning, green use window, snapshot history). A source that is off is not
  read at all; its values are empty and the model is told it was turned off, so it never treats
  it as zero.
- Writes: each output on or off (never all of them), the Notion target, and the sections of the
  brief, on or off and in order. The email and the Notion copy use the same sections. A section
  whose fact source is off is left out (Numbers needs Yesterday's numbers, What ran needs Other
  agents' runs). Today's focus is always on.
- Notion target: picked from pages and databases the Notion integration can see (`notionSearch`
  in `integrations/notion.ts`), so the app can't widen access. A database must have every column
  the Briefs row writes (`menu.notion.dbProps`); a page gets one new page per day under it. The
  server opens the target again on save. With no target picked, `NOTION_BRIEFS_DB_ID`, then
  `NOTION_BRIEF_PARENT_ID`, still work, so nothing changes until Zak picks one.
- The email recipient is never a choice: `integrations/email.ts` has no recipient argument and
  sends to `BRIEF_TO`.
- Gateway action types show read only in Writes, with their tier. Avery has none.
- Looser, so a confirm and `DASHBOARD_CONTROLS=on`: an output turned back on, or a different
  Notion target, as well as the slice 2 cost rules. Turning things off never needs either.
- Avery's default section order is now the email's (focus, waiting, numbers, watch, what ran)
  for the Notion copy too.

## Slices

1. Setup store and the read-only canvas. Avery reads its model, effort,
   instructions and low-green warning from its setup; version 1 holds the values it already had.
2. Edit mode: Thinking for Avery (model, effort, instructions with a locked safety block,
   preview, versions, roll back).
3. Model choice across providers (Claude direct, OpenAI and Google through Vercel AI Gateway).
4. Reads and Writes editable for Avery (sources, outputs, Notion target, sections).
5. Crew canvas: triggers and chains.
6. Guardrails box and caps.
7. Menus for Rowan, Quinn and Morgan.
