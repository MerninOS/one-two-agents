# Agent Control Room: implementation spec

Source design: Claude Design project "Agent Control Room Prototype", file `Agent Control Room.dc.html` (+ `Run Canvas.dc.html`, imported by it). Written 2026-11-09.

## 1. What the design is

A "mission control" for the agents, light and dark themes, Plus Jakarta Sans, white rounded cards on a grey page, orange accent (#F2884B), mint / sunflower / pink / peach supporting colors, a dark output card.

- **Top bar:** "12" logo, crew rail (one round avatar per agent; 3 built, a divider, 8 planned with dashed rings), theme toggle, bell, date pill, the owner's avatar.
- **Sidebar:** Desk, Approvals, Crew, Runs, Connections, and Settings at the bottom (docs/builder-flow.md, slice 5).
- **Screens:** the Desk (home: greeting and a summary line counted in code, goal tiles with each head's latest word, Needs you with proposals first; docs/company-mode.md, slice 5), Avery's chat beside every screen (a panel on a wide screen, a bar and sheet on a phone; slice 5), Crew (the Org chart: departments, each led by its goals, seats and who sits in them, docs/org-chart.md; New agent; and a Schedule view with the chains), Agent profile with tabs (Overview, Edit (the builder page), Memory, Runs), Run replay (dark header with scrubber, money breakdown, the agent map with the run laid over it, step timeline, gateway inspector), Runs (the run log: filters, search, totals; each row opens its replay), Connections (one page per integration: status, what agents can read, do and hand you there, and who has it; an MCP server such as Klaviyo is signed in here with Connect, docs/company-mode.md slice 6), the agent builder (New agent on Crew, or an agent's Edit tab: the step-by-step flow in docs/builder-flow.md), Approvals, Settings (including the money and email caps), a Goal page (`/goals/[id]`), Set a goal (`/goals/new`), and Proposals (`/proposals`, `/proposals/[id]`: what heads hand the owner to decide, docs/company-mode.md slice 3). A confirm modal and a toast are shared.
- Agents are personas: Avery (Chief of Staff), Morgan (CFO), Rowan (Wholesale Hunter), Quinn (Bookkeeper, built 2026-11-09, off until launch); planned: Sage, Blair, Sol, Remy, Jules, Ellis (Conversion Optimizer), Kit.

## 2. What exists in the backend today, and what doesn't

| Design element | Backend today | Phase 1 (this PR) |
| --- | --- | --- |
| Crew, status, model, budget | `agents` table (enabled, daily_budget_usd, model, manual_only, in_org) | Real |
| Proposals | `proposals`; checked against the chart and the tool list (`core/proposals.ts`, docs/company-mode.md) | Real |
| Goals | `goals`; measures counted in code from `wholesale_leads`, Shopify, Mercury (`core/measures.ts`, docs/company-mode.md) | Real |
| Org chart | `departments` (with monthly budget and email cap), `seats`, department rules in `agent_memory` (docs/org-chart.md) | Real |
| Run log, cost, tokens, summaries, errors | `agent_runs` | Real |
| Spend today vs budget | `agent_runs.cost_usd` since UTC midnight (same rule `withRun` uses) | Real |
| Schedules | The crew flow (`crew_flow`), run by the one `dispatch` Vercel Schedule while the org is on (docs/org-schedule.md) | Crew > Schedule: the org's day, Scheduled / By hand, days and time per agent |
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
| Journal / Teach | `agent_memory`, `reactions` (Good / Not this on runs and approvals, docs/company-mode.md) | Live |

No sample data ships. Where the design used sample numbers, the build shows the real number or an honest empty state.

## 3. Architecture

- Next.js 16 App Router pages next to the existing API routes. Server components read Supabase with the existing service-role client (`core/db.ts`); nothing reaches the browser except rendered data. No new tables in phase 1.
- `dashboard/` holds the code: `crew.ts` (the planned seats and the hard rules; every agent that exists comes from the database through `roster.ts`), `connections.ts` (integrations, their tools as Can read / Can do / Hands you, who has what), `data.ts` (server-only queries), `auth.ts` (session), `format.ts` (Central Time, money), `actions.ts` (server actions), `components/`.
- Styling: one `app/globals.css` with the design's CSS variables and a handful of classes, light and dark (`data-theme` on `<html>`, remembered in a cookie). Icons from `lucide-react`. Font via `next/font` (Plus Jakarta Sans).
- Routes: `/` mission control, `/agents/[id]?tab=…`, `/runs` (filters in the query string), `/runs/[id]` replay, `/connections` (`/access` and `/integrations` redirect there), `/build`, `/build/new`, `/build/[id]` (`?edit` opens the flow), `/approvals`, `/settings`, `/login`.

### Phones

At 860px and narrower (`app/globals.css`, last block): one sticky top bar with the bell and a menu button (`MobileMenu` in `dashboard/components/client.tsx`) that opens the full navigation as a sheet; the crew rail turns into labeled agent chips that stay visible on every screen (switching agent keeps the current tab, on desktop too); outer frames drop away; the run log stacks each run; the agent map stacks its columns; two-column sections become one; Connections stacks its tiles and the opened connection. Desktop is unchanged. Phone screenshots: project files `agents-repo/control-room-screens/mobile/`.

## 4. Safety rules for the UI

- **Login required.** Each person signs in with an emailed link and has a role (viewer, approver, owner; see docs/tenancy.md, slice 2). Sign-in sets an HMAC-signed, httpOnly cookie (30 days, `SESSION_SECRET`). If the secret is unset, the dashboard refuses everyone. `proxy.ts` guards pages, and every data function and server action checks the session again. `/api/*` keeps its bearer check and is not affected.
- **The dashboard never starts anything by itself.** No polling that triggers runs, no auto-run on load, nothing scheduled.
- **Anything that can spend money or wake an agent is off by default.** Real runs, putting an agent back on the crew, and raising a budget only work when `DASHBOARD_CONTROLS=on`. Until then the buttons show but are disabled with the reason. Taking an agent off duty and turning off the org always work, since they only stop things.
- Dry runs are allowed: they read real data, write nothing and call no model (existing `dryRun` path). They are not logged, as today.
- Every control goes through a confirm modal that states what will happen and what it costs.
- Real runs from the UI go through `withRun` with trigger `manual`, so they respect `agents.enabled` and the daily budget.
- Schedules and chains are edited in Crew > Schedule (`/crew?view=schedule`, `docs/agent-setup.md` slice 5). The only Vercel Schedule is `dispatch`, which starts chains that are on, and only while the org is on (`docs/org-schedule.md`).
- **The org switch** sits at the top of Crew > Schedule. Turning it on (launch) needs `DASHBOARD_CONTROLS=on` and a confirm listing who wakes, first runs and the cost a month; turning it off always works. It replaced Pause all in Settings.

## 5. Phase 2 (needs backend, not in this PR)

1. `agent_memory` table (agent_id, group, text, source_tag, keep, expires_after, state proposed/kept) → Memory tab, Teach, Journal, lessons Keep/Edit/Discard.
2. Run transcripts in Supabase Storage keyed by run id (tech spec, Observability) → replay steps, scrubber, money breakdown per step (the agent map already lights each tool from `run_steps` for runs on the runner).
3. Gateway decision log → gateway inspector, refused counts, Quarantine.
4. `approvals` table + Notion sync → Approvals screen and "Needs you" items.
5. Vercel API token (read only) → show whether each Vercel schedule is enabled.
