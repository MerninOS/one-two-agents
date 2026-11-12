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
  `agent`), `source_tag`, `notion_page_id` (a standing order may point at a Notion page to load;
  read fresh each run, arrives in a later PR), `trust`, `state` (`proposed`, `kept`, `discarded`,
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
3. Notion pages linked from standing orders (read fresh, ≤ 1,500 tokens a page), crew memory polish.
4. Rowan and Quinn load memory; derived facts and don't repeat; mission control meters; the
   run canvas Memory node; last "coming later" tags removed.
