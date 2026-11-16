# Turn on the org: Crew > Schedule

Build Board card 100. Design (approved by Zak 2026-11-16): https://claude.ai/artifact/4KoN9VrHvJ48hiQJqQhrxB

## Why

Getting one agent to run on its own used to take three switches in two places: On the crew and
Runs only by hand on its profile, then a chain on Crew > Schedule that is on. Pause all lived in
Settings. Nothing showed when the whole org works or what it costs a month. Zak wants it to feel
like "turn on the org": one switch, a view of the org's day, Avery's morning brief as the anchor,
and per-agent control over when each agent runs and what that costs.

## Decisions (Zak, 2026-11-16)

1. Both a one-tap org switch and per-agent controls.
2. Each agent's schedule is a chain under the hood (a one-step chain of its own, or its step in a
   multi-step chain such as Morning). One scheduling system; the dispatcher doesn't change shape.
3. Turning on the org is launch: the agents go on duty, their chains turn on, and the "until
   launch" labels go away (they now come from the org switch, not a constant).
4. Test agents (`agents.in_org = false`, Scratch) and agents without an approved playbook (no live
   version) are left out of the org.
5. It lives on Crew > Schedule.
6. Each agent shows its cost per run and per month, and toggles between Scheduled and By hand, so
   Zak controls what the org costs a month.

## The model

- **The org switch** is the `policies` row `org` (`{"on": true|false, "at", "by"}`), read by
  `core/org-switch.ts`. A missing or unreadable row is off. While the org is off, nothing starts
  on its own: the dispatcher (`app/api/dispatch`) starts no scheduled chain and no waiting step
  of one, and a decided approval starts no chain (`approvalDecided`). The Run button and Run
  chain still work for agents on duty, because Zak pressed them.
- **Turn on the org** (Controls on + a confirm that lists who wakes, each first run and the cost a
  month): every agent in the org goes on duty (`agents.enabled`), every chain whose agents are all
  in the org is saved on (one new `crew_flow` version), and then the flag turns on, last.
- **Turn off the org** (always allowed): the flag turns off first, then every agent goes off duty.
  Chains keep their on switch, so turning the org back on brings back the same day. This replaces
  Pause all in Settings.
- **An agent's schedule** is where it sits in a chain that starts on a schedule (`scheduleOf`):
  the chain's start time for its first step, or a later step's "not before" time. **By hand** means
  it is in no such chain (`agents.manual_only`, which slice 2 sets from the toggle).
- **Cost a month** is computed in code: the average of its last 10 real runs (or its cap per run
  before it has any) times its runs in 30 days: 30 daily, 22 weekdays, 4 Mondays, 0 by hand
  (`dashboard/orgPlan.ts`).

## Slices

1. **Org switch (this PR).** `policies.org`, `agents.in_org` (migration
   `20261128090000_org_switch.sql`), the dispatcher and approval gate, Turn on / Turn off with the
   confirm, the switch at the top of Crew > Schedule, status labels from the org instead of
   `PRE_LAUNCH`, Pause all removed from Settings. Pure planner `dashboard/orgPlan.ts` with
   `npm run check:org-switch`.
2. **The org's day and the cost table.** The Schedule tab opens on a timeline of every agent's
   runs by department (Avery's brief marked), a cost table with Scheduled / By hand per agent and
   the monthly total, and a panel per agent for days and time. Edits are flow edits through
   `saveCrewFlow`'s rules (a one-step chain `solo-<agent>`, or the step in its chain). The canvas
   moves behind "Edit chains". The profile's two switches become a line linking here (deleted).
3. **Mondays, phone and cleanup.** A Mondays start in `core/flow-rules.ts` (heads plan Mondays),
   the phone layout, and dead weight removed: the unused `agents.schedule` column, stale
   "mirrored from vercel.json" notes (`dashboard/schedule.ts`, `docs/control-room.md`).

## Rules

- Turning on, letting an agent run on a schedule and raising spend need `DASHBOARD_CONTROLS=on`
  and a confirm that says what runs and what it costs. Turning off always works.
- A chain still never turns an agent on, and every run still goes through `withRun` (on duty,
  daily budget, department budget).
- Nothing is turned on while building or testing this. The org stays off until Zak turns it on.
