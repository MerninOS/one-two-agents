# Template packs

Design: OPERATOR architecture https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj, phase 5. Build
Board: Order 125. Core is what every business runs; a template pack is what one kind of business
adds on top. One Two Coffee Lab is the first pack (`templates/one-two`), and an example another
business can learn from.

## What a pack is (`templates/types.ts`)

- **Tools**: added to the tool list after core's. Held to every rule core tools are (Read and
  Calculate write nothing, numbers are worked out in code, reports reach only the owner or our own
  stores after a finished run, actions only through `core/gateway`). An id never clashes with
  core's; `core/tools/catalog.ts` refuses to load if it does.
- **Goal measures**: readers for `core/goal-rules.ts` keys the pack counts (One Two: lowest days of
  green cover).
- **Tables**: tables only the pack's code reads and writes (One Two: `kpi_snapshots`, `trips`,
  `home_office`, `tax_packets`). Each is still a tenant table with `org_id`, a place in
  `TENANT_TABLES` and an `org_rows` policy, and its migration stays in `supabase/migrations/` (one
  database). `check:packs` refuses core code that reads one.
- **Crew**: a starting crew as data (`PackCrew`): departments, the org chart, agents with their
  specs and playbooks, the chains and starting goals. `core/install.ts` installs it into a new,
  empty org (see "The installer" below).
- **Planned seats**: agents on the pack's plan that aren't built yet. The Control Room shows them
  (Crew, the rail, the org chart) only in an org that has the pack's agents (`plannedSeats`).

## The installer (`core/install.ts`)

An owner whose org has no departments and no agents sees "Start your crew" on the Desk: each pack
with a crew, and an empty start. Picking one runs `installTemplate` (owner only, audited).

`npm run org:new -- --slug acme --name "Acme" --owner owner@acme.example [--pack one-two]` makes a
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
(`domain/`, `agents/cfo` and the rest, `core/green.ts`, the old Shopify reads) are gone.

## One Two's pack (`templates/one-two`)

| Path | What |
| --- | --- |
| `domain/` | Coffee constants and green math (copied from the storefront), bookkeeping rules |
| `agents/` | The code One Two's tools call: Morgan's daily numbers (`cfo`), Avery's brief (`chief-of-staff`), Quinn's books sync (`bookkeeper`), Rowan's wholesale offer (`wholesale-hunter`) |
| `shopify/` | Our Shopify reads for One Two's storefront fields: green lots, our coffees, roast loss, the green ledger and roasting board; `README.md` is the field contract with the storefront |
| `green.ts` | Green use and days of cover |
| `tools.ts` | Green lots, open orders, green use, cover and reorder, the daily snapshot, the wholesale offer, Morgan's saved numbers, and the reports that save the snapshot, send the brief and sync the books |
| `measures.ts` | Lowest days of green cover |
| `crew.json`, `crew.ts` | The starting crew: 5 departments, 28 seats, 10 agents with specs, 9 playbooks, 2 chains, 3 goals |

Tool ids, inputs and behaviour are unchanged, so every saved agent keeps its tools.

## Slices

1. **Pack mechanism** (done): the pack folder, registration of tools and measures, the check.
   No behaviour change.
2. **Words** (done): the hard rules in CLAUDE.md say "the owner" and "the business", not Zak
   and One Two, with the same meaning; Zak approves the wording before it merges. The cap start
   values stay in core (`CAPS`), because each is also the most any org may set: a pack can't
   loosen a hard rule. Text that models or people read in the app (prompts, Control Room copy)
   is not changed here, since changing a prompt changes behaviour.
3. **Shopify reads and tables** (done): the Shopify reads for One Two's storefront fields move
   into `templates/one-two/shopify/`; a day's orders (`integrations/shopify/orders.ts`, what core's
   goal measures count) stays in core. The pack declares its tables. No behaviour change, no
   migration. The fixed queries and the Shopify server's profile stay in core, because profiles
   are hard rules (`core/mcp-rules.ts`).
4. **Installer** (this one): One Two's crew, playbooks and goals are a snapshot in the pack
   (`crew.json`, matching the live specs and playbooks on 2026-11-17), installed into a new org by
   `core/install.ts`. No migration, and One Two's own org is untouched. Still to come with signing
   in to other orgs: `BRIEF_TO` becomes the org's owner email, and app copy and the other docs say
   "the owner".
