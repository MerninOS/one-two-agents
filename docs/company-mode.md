# Company mode: run the crew like a company

Zak, Nov 15: the Control Room still felt like configuring software. Teaching agents, adding agents
and mapping the org were clunky. He wants to run a fully agentic organization with himself on top:
he sets goals, reacts to work and decides on proposals; heads think and plan, specialists do one
narrow job. Approved design (every board, desktop and phone):
https://claude.ai/artifact/UtmdGkLKTTezQNGmg5oWHu. Status lives on the Build Board, cards Order 80-86.

**Rule for every slice: it deletes what it replaces in the same PR.**

## Decisions (Zak, 2026-11-15, "yes to all")

1. Heads (not leads) give their specialists a weekly focus: a note that expires in 7 days, never
   authority. Leads still only watch. This changes the Nov 13 rule for heads only.
2. Every goal needs a measure counted in code, picked from a list. A goal without one shows
   "No measure yet" and the missing read goes on the build list.
3. Zak's reactions save straight away as rules in his words, with Undo. Avery may suggest wording
   or scope; only his tap applies it. Lessons a lead or head proposes still wait for his Keep.
4. Avery becomes the front door: a chat in the app that reads the company's data and can only file
   proposals and save the rules Zak dictates. The /one-two-new-agent skill retires once she can hire.
5. Heads move to Sonnet, medium effort, $0.75 cap a run. Specialists stay on Haiku unless the job
   needs judgment.
6. MCP connections: our runner calls MCP servers itself (never the model provider's server-side
   connector), read tools only, picked one by one; writes only as gateway action types. Klaviyo first.
7. The Desk replaces Today. Editing the org chart by hand stays.

Unchanged: heads never get action tools; new agents start off duty with no actions; every send,
payment or post is a gateway action that starts at Draft; only Zak's taps approve or count toward
promotion; agents stay off until he says launched.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | Teach by reacting | The Memory tab's Teach form; Reject's "proposed lesson" from Zak's own reason |
| 2 | Goals and measures | Today's stat chips |
| 3 | Proposals: hire, grant a tool, new tool, retire | The new-agent skill's direct database writes; New agent opens a blank proposal |
| 4 | Heads plan, review and set focus | Hand-written focus in department rules |
| 5 | Avery, the front door, and the Desk | The Today page; the /one-two-new-agent skill |
| 6 | MCP connections, Klaviyo first | (new kind of connection) |

## Slice 1: Teach by reacting

**What Zak sees.**

- **Run replay: "Was this right?"** (`#react`, so links can jump there). **Good** saves at once.
  **Not this…** opens a box: his words ("Say it like you'd say it to Rowan"), **who should follow
  it** (the agent, all of its department, everyone), **for how long** (always, 30 days, next run;
  only the agent's own rule can be short-lived), and **replace a rule it already has?** (its kept
  rules in that scope, or keep them all). Saving with no words just marks it not this.
- **Each lead a run found** gets its own Good / Not this under the run's.
- **Approvals: Reject** opens the same picker. Words are optional; with words the rule is saved in
  his words straight away (no Keep), for whoever he picked.
- **The morning brief:** "Not right? Tell Avery" under the focus and the watch list (and in the
  plain-text copy) opens Good / Not this on the run that wrote that brief.
- **Agent Overview:** "From you, last 30 days: 4 good · 2 not this" under How it works, and the
  Journal lists each reaction ("You said not this to Summit Coffee Co.") with a link back.
- **Memory tab:** the Teach form is gone. Its card says how to teach (react on runs and approval
  cards) with **React to its latest run** and **Rules it always follows** (builder step 1, which
  still adds standing orders with a Notion page). The tab stays the record: every rule shows where
  it came from ("Your reaction to a run", "Your reason for a Reject"), with Edit and Forget.
- **Heads read it:** "Your team" (`team_report`) now carries each teammate's `fromZak`: Good and
  Not this counts for the period, and his latest words, plus `aN_zak_good` / `aN_zak_not` numbers.

**What gets saved** (`core/reaction-rules.ts`, pure, `npm run check:reactions`; `core/reactions.ts`).

- One `reactions` row per thing reacted to (a run, a lead in a run, an approval); reacting again
  changes it. It holds the verdict, his words when they became a rule, and the rule's id.
- Not this with words: agent + always is a standing order, agent + 30 days or next run is a note,
  department is a department rule, everyone is a crew line. `source = zak`,
  `source_tag = run:<id>` or `approval:<id>`. The new rule is saved first, then the one it replaces
  is forgotten (so a failed save never loses the old rule). A replaced rule must be kept and in the
  same scope, checked in code.
- The run and lead are looked up on the server: the run must be the agent's, the lead must be from
  that run. Nothing the page sends picks a target.
- Rules are notes like every memory line: they never raise a cap, add a recipient or grant access.

**Data.** Migration `20261120090000_reactions.sql` (the `reactions` table). Until it's applied,
Good and a plain Not this answer that the table isn't there; Not this with words and Reject with
words still save the rule (the toast says it won't show on the scorecard); the scorecard, journal
entries and `fromZak` are empty.

**What it replaces.** `TeachForm` and the `teach` action (the Memory tab's form and the Overview
Journal's compact copy); `RejectButton`'s "propose a lesson" path in `reject` (Zak's reason is now a
reaction). `proposeLesson` stays for a lead's or head's send-back.

**Checks.** `npm run check`, `npm run check:reactions`, `npm run build`.
