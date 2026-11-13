# Agent Control Room: implementation spec

Source design: Claude Design project "Agent Control Room Prototype", file `Agent Control Room.dc.html` (+ `Run Canvas.dc.html`, imported by it). Target: repo `MerninOS/one-two-agents`, Vercel project `one-two-agents`, Supabase project `one-two-agents`. Written 2026-11-09.

## 1. What the design is

A "mission control" for the agents, light and dark themes, Plus Jakarta Sans, white rounded cards on a grey page, orange accent (#F2884B), mint / sunflower / pink / peach supporting colors, a dark output card.

- **Top bar:** "12" logo, crew rail (one round avatar per agent; 3 built, a divider, 8 planned with dashed rings), theme toggle, bell, date pill, Zak's avatar.
- **Sidebar:** Floor (Mission control, Run replay, Run log), Crew (Crew profiles, Memory), Trust (Approvals, Connections), Settings at the bottom. (Builder flow slice 5 trims this to Today, Approvals, Crew, Runs, Connections, Settings.)
- **Screens:** Mission control (greeting, stat chips, "Live floor" workflow canvas, Needs you, Shift board, Spend by agent, Memory per agent, Joining the crew), Agent profile with tabs (Profile, Setup, Memory, Runs and replays, Shift, Settings), Run replay (dark header with scrubber, money breakdown, step timeline, gateway inspector), Run log (filters, search, totals), Connections (one page per integration: status, what agents can read, do and hand you there, and who has it), Approvals, Settings. A confirm modal and a toast are shared.
- Agents are personas: Avery (Chief of Staff), Morgan (CFO), Rowan (Wholesale Hunter), Quinn (Bookkeeper, built 2026-11-09, off until launch); planned: Sage, Blair, Sol, Remy, Jules, Ellis (Conversion Optimizer), Kit.

## 2. What exists in the backend today, and what doesn't

| Design element | Backend today | Phase 1 (this PR) |
| --- | --- | --- |
| Crew, status, model, budget | `agents` table (enabled, daily_budget_usd, model, schedule) | Real |
| Run log, cost, tokens, summaries, errors | `agent_runs` | Real |
| Spend today vs budget | `agent_runs.cost_usd` since UTC midnight (same rule `withRun` uses) | Real |
| Schedules (Shift) | `vercel.json` Vercel Schedules; on/off lives in Vercel, not the DB | Read only, from a mirror of `vercel.json` |
| Dry run | `?dryRun=1` path in every agent job | Real, button on the profile |
| Real run | `withRun` | Behind a switch (see 4) |
| On the crew (enabled) | `agents.enabled` | Turning off: always. Turning on: behind the switch |
| Daily budget edit | `agents.daily_budget_usd` | Behind the switch |
| Rowan's pipeline | `wholesale_leads.stage` | Real |
| Integrations health | env presence (`/api/health` logic) | Real, never shows a value |
| Who can reach what | Each agent's active saved setup (`agent_defs`), grouped by connection in `dashboard/connections.ts` | Database |
| Hard rules, mandates | Tech spec + CLAUDE.md | Static config in code |
| Memory (orders, facts, lessons, notes, working, don't repeat) | `agent_memory`, `memory_events` (docs/agent-memory.md) | Live: Teach, Edit, Forget, lessons, linked Notion pages, context meter, timeline |
| Run steps, gateway decisions, quarantine | Nothing (needs run transcripts) | Replay shows the design's "Steps need run transcripts" state |
| Approvals queue | `approvals` + `agent_actions` (gateway) | Pending cards with Approve / Reject / Approve all, approved-not-applied with Apply now and Retry, decided list, gateway log |
| Journal / Teach | `agent_memory` | Live |

No sample data ships. Where the design used sample numbers, the build shows the real number or an honest empty state.

## 3. Architecture

- Next.js 16 App Router pages next to the existing API routes. Server components read Supabase with the existing service-role client (`core/db.ts`); nothing reaches the browser except rendered data. No new tables in phase 1.
- `dashboard/` holds the code: `crew.ts` (personas, mandates, hard rules; Zak renames agents here), `connections.ts` (integrations, their tools as Can read / Can do / Hands you, who has what), `data.ts` (server-only queries), `auth.ts` (session), `format.ts` (Central Time, money), `actions.ts` (server actions), `components/`.
- Styling: one `app/globals.css` with the design's CSS variables and a handful of classes, light and dark (`data-theme` on `<html>`, remembered in a cookie). Icons from `lucide-react`. Font via `next/font` (Plus Jakarta Sans).
- Routes: `/` mission control, `/agents/[id]?tab=…`, `/runs` (filters in the query string), `/runs/[id]` replay, `/connections` (`/access` and `/integrations` redirect there), `/approvals`, `/settings`, `/login`.

### Phones

At 860px and narrower (`app/globals.css`, last block): one sticky top bar with the bell and a menu button (`MobileMenu` in `dashboard/components/client.tsx`) that opens the full navigation as a sheet; the crew rail turns into labeled agent chips that stay visible on every screen (switching agent keeps the current tab, on desktop too); outer frames drop away; the run log stacks each run; the Live floor stacks its nodes; two-column sections become one; Connections stacks its tiles and the opened connection. Desktop is unchanged. Phone screenshots: project files `agents-repo/control-room-screens/mobile/`.

## 4. Safety rules for the UI

- **Login required.** `DASHBOARD_PASSWORD` env var. Login sets an HMAC-signed, httpOnly cookie (30 days). If the variable is unset, the dashboard refuses everyone. `proxy.ts` guards pages, and every data function and server action checks the session again. `/api/*` keeps its bearer check and is not affected.
- **The dashboard never starts anything by itself.** No polling that triggers runs, no auto-run on load, nothing scheduled.
- **Anything that can spend money or wake an agent is off by default.** Real runs, putting an agent back on the crew, and raising a budget only work when `DASHBOARD_CONTROLS=on`. Until then the buttons show but are disabled with the reason. Taking an agent off duty and "Pause all agents" always work, since they only stop things.
- Dry runs are allowed: they read real data, write nothing and call no model (existing `dryRun` path). They are not logged, as today.
- Every control goes through a confirm modal that states what will happen and what it costs.
- Real runs from the UI go through `withRun` with trigger `manual`, so they respect `agents.enabled` and the daily budget.
- Schedules and chains are edited on the Crew canvas (`/crew`, `docs/agent-setup.md` slice 5). The only Vercel Schedule is `dispatch`, which starts chains that are on.

## 5. Phase 2 (needs backend, not in this PR)

1. `agent_memory` table (agent_id, group, text, source_tag, keep, expires_after, state proposed/kept) → Memory tab, Teach, Journal, lessons Keep/Edit/Discard.
2. Run transcripts in Supabase Storage keyed by run id (tech spec, Observability) → replay steps, scrubber, money breakdown per step, Run Canvas nodes per run.
3. Gateway decision log → gateway inspector, refused counts, Quarantine.
4. `approvals` table + Notion sync → Approvals screen and "Needs you" items.
5. Vercel API token (read only) → show whether each Vercel schedule is enabled.
