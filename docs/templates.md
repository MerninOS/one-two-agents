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
- Later (the installer): the pack's crew (agents, departments, heads), playbooks, goals and
  standing orders, installed into an org, so a new org can start empty or from a pack.

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

Tool ids, inputs and behaviour are unchanged, so every saved agent keeps its tools.

## Slices

1. **Pack mechanism** (done): the pack folder, registration of tools and measures, the check.
   No behaviour change.
2. **Words** (done): the hard rules in CLAUDE.md say "the owner" and "the business", not Zak
   and One Two, with the same meaning; Zak approves the wording before it merges. The cap start
   values stay in core (`CAPS`), because each is also the most any org may set: a pack can't
   loosen a hard rule. Text that models or people read in the app (prompts, Control Room copy)
   is not changed here, since changing a prompt changes behaviour.
3. **Shopify reads and tables** (this one): the Shopify reads for One Two's storefront fields move
   into `templates/one-two/shopify/`; a day's orders (`integrations/shopify/orders.ts`, what core's
   goal measures count) stays in core. The pack declares its tables. No behaviour change, no
   migration. The fixed queries and the Shopify server's profile stay in core, because profiles
   are hard rules (`core/mcp-rules.ts`).
4. **Installer**: One Two's crew, playbooks and goals move into the pack and are installed into
   an org; a new org starts empty or from a pack. `BRIEF_TO` becomes the org's owner email, and
   app copy and the other docs say "the owner" as each piece moves.
