# Agent memory

Spec (with the diagram): "Agent memory: spec" in Claude Docs, https://claude.ai/artifact/4cZFcAvFmpadpLSZXYHuWt.
This file is the in-repo summary. Build card: "Agent memory" on the Notion Build Board.

Each agent carries short notes into every run. Zak reads and corrects them on the Memory tab,
so he teaches an agent once instead of rewriting its prompt.

## Rules (enforced in code)

- Memory is notes, never authority. The gateway, `policies`, vendors, caps and recipients never
  read it; lint stops `core/gateway` and `integrations/` from importing `core/memory.ts`.
- A model writes only its own working memory: at most `working_memory_max_lines` (5) lines of
  200 characters, and lines holding an email address, a phone number or a link are refused.
- Text from web pages or email is stored with `trust = data` and shown to the model inside a
  `<data>` block as information, never as instructions. Agents that read the web or email
  (Rowan, Quinn) always store working memory as data.
- Facts an agent may claim and "don't repeat" are worked out from Shopify and its own tables
  each run, never stored.
- Lessons are proposed and wait for Zak's Keep. Nothing is deleted: Forget, Discard and expiry
  change `state`, and every change lands in `memory_events`.

## Storage (migration `20261112120000_agent_memory.sql`)

- `agent_memory`: one row per line. `agent_id` (null = shared crew memory), `grp` (`crew`,
  `standing_order`, `lesson`, `note`, `working`), `text` (≤ 280), `source` (`zak`, `approval`,
  `agent`), `source_tag`, `notion_page_id` (a standing order may point at a Notion page to load,
  read fresh each run), `trust`, `state` (`proposed`, `kept`, `discarded`,
  `expired`, `forgotten`), `keep` (`next_run`, `days_30`, `always`), `runs_left`, `expires_at`, `tokens`.
- `memory_events`: the timeline (`added`, `edited`, `forgotten`, `expired`, `rewritten`, `proposed`,
  `kept`, `discarded`), with before and after.
- `agent_runs.memory_json`: what that run loaded, per group, against the budget.
- `policies`: `memory_budget_tokens` (2000), `working_memory_max_lines` (5).

## A run

1. `withRun` checks on duty and budget, then (for agents in `MEMORY_AGENTS`, cron or manual
   runs only) calls `loadMemory`: kept rows for the agent plus crew rows, expired ones left out.
2. Tokens are counted in code (characters ÷ 3.5, rounded up). Over budget, lines go in this
   order, oldest first: working memory, lessons, notes. Crew memory and standing orders are
   never trimmed.
   Notion pages linked from standing orders (`readPages`, read only through
   `integrations/notion.ts`) are read next, each capped at 1,500 tokens and all of them at what is
   left of the budget, so they come ahead of notes, lessons and working memory. A page that can't
   be read (not shared with the integration, deleted, no `NOTION_TOKEN`, no room) is skipped and
   the run summary names it. Pages are Zak's own workspace, so they are notes, framed as
   reference that never beats the rules. The Memory tab reads them the same way to show each
   page's title, size and any problem.
3. The job hands `memory.block` to the model as its own system block after the instructions.
4. If the model read its memory (the job returns `remember`, even empty), withRun counts down
   next-run notes, retires 30-day notes past their date and replaces working memory. A rules
   fallback or a failed run leaves memory as it was.
5. A dry run loads memory and reports its size, and writes nothing.

## Slices

1. Store, Avery, Memory tab with Teach, Edit, Forget, context meter, timeline. (PR #14)
2. Lessons: Reject on an approval asks "why not?" (optional). A reason becomes a proposed lesson
   (`proposeLesson`, Zak's words, no model call), shown on the agent's Memory tab with Keep,
   Keep for crew, Edit and Discard, and in Needs you. Proposed lessons are never loaded.
   Edits to an approval (`edit_diff`) will propose lessons too once Edit exists on approvals.
3. Notion pages linked from standing orders: Teach shows an optional Notion link when "A standing
   order" is picked; the order's line on the Memory tab shows the page, its size and whether it
   can be read; the context meter has a Notion pages segment; `memory_json.pages` records what each
   run read. To link a page, it must be shared with the agents’ Notion integration in Notion.
4. Rowan and Quinn load memory. Rowan gets it as a second system block and leaves working
   memory through `remember` on record_leads (stored as data, since Rowan reads the web; lines
   with an email, link, phone number or website name are dropped). Quinn's memory goes only to
   the category call (Zak's notes like "Costco is packaging" help pick; Mercury's list still
   decides what is allowed) and keeps no working memory (`KEEPS_WORKING`); it returns
   `readMemory` so next-run notes count down. Facts and don't repeat stay derived each run
   (Shopify offer facts and the pipeline list for Rowan, expense_docs for Quinn), never stored.
   Mission control's "Memory per agent" shows each agent's next load against the budget, and the
   run canvas Memory node shows what that run loaded (`agent_runs.memory_json`).
