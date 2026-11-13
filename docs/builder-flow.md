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
| 3 | The agent map | AgentCanvas, RunCanvas, `dashboard/canvas.ts` |
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
