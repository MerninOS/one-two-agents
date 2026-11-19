# Template packs

Design: OPERATOR architecture https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj, phase 5. Build
Board: Order 125. Core is what every business runs; a template pack is what one kind of business
adds on top. A pack lives in `templates/<id>/` and is registered in `templates/index.ts`. OPERATOR
starts with no packs: an empty crew is always a choice.

## What a pack is (`templates/types.ts`)

- **Tools**: added to the tool list after core's. Held to every rule core tools are (Read and
  Calculate write nothing, numbers are worked out in code, reports reach only the owner or our own
  stores after a finished run, actions only through `core/gateway`). An id never clashes with
  core's; `core/tools/catalog.ts` refuses to load if it does.
- **Goal measures**: readers for `core/goal-rules.ts` keys the pack counts (a coffee roaster's pack might
  count the lowest days of green coffee left).
- **Tables**: tables only the pack's code reads and writes Each is still a tenant table with `org_id`, a
  place in `TENANT_TABLES` and an `org_rows` policy, and its migration is in `supabase/migrations/`
  (one database), but it stays out of the starting migration (docs/self-host.md). `check:packs`
  refuses core code that reads one.
- **Crew**: a starting crew as data (`PackCrew`): departments, the org chart, agents with their
  specs and playbooks, the chains and starting goals. `core/install.ts` installs it into a new,
  empty org (see "The installer" below).
- **Planned seats**: agents on the pack's plan that aren't built yet. The Control Room shows them
  (Crew, the rail, the org chart) only in an org that has the pack's agents (`plannedSeats`).

## The installer (`core/install.ts`)

An owner whose org has no departments and no agents sees "Start your crew" on the Desk: each pack
with a crew, and an empty start. Picking one runs `installTemplate` (owner only, audited).

`npm run org:new -- --slug acme --name "Acme" --owner owner@acme.example [--pack <id>]` makes a
new org with its first owner, empty or from a pack's crew. What it installs is always switched off:

- every agent off duty, every chain off, the org switch off (no row: off is the default);
- every playbook proposed, so the owner approves each first playbook (the rule for every agent);
- specs pass `readSpec` unchanged, so a pack only picks tools and limits that code offers;
- goals active with no due date, for the owner to set;
- no policies (every cap and setting starts at its default in code, `CAPS` at its start value), no
  memory, vendors, people beyond the owner, or connections: the new org signs in to its own
  accounts.

It installs only into an org with no agents, departments or seats, and `check:install` refuses a
crew with any problem (a tool that isn't in code, a playbook step outside the agent's tools, a seat
with no parent or a loop, a chain that wouldn't load, a goal with no department or measure, a value
the database would refuse). Signing in to an org other than the home org isn't built yet.

## The rule: core never reaches into a pack

`templates/index.ts` lists the installed packs. It is the only way in: `core/tools/catalog.ts`
adds pack tools and `core/measures.ts` reads pack measures, both through it. A pack may use core's
public pieces (`db()`, time, the tool types, reads through `callMcpTool`) and proposes actions only
through `core/gateway`'s front door (an approval card), never the vault, the gateway's insides, a write tool, a custom tool or one of our servers directly.
`npm run check:packs` enforces this, checks pack tool ids, and checks that the old folders
(`domain/`, `agents/cfo` and the rest, `core/green.ts`, the old Shopify reads) are gone. A pack
may have no tools, tables or Shopify reads at all: its `index.ts` alone is enough.
