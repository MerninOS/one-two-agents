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
- Later (the installer): the pack's crew (agents, departments, heads), playbooks, goals, standing
  orders and its own tables, installed into an org, so a new org can start empty or from a pack.

## The rule: core never reaches into a pack

`templates/index.ts` lists the installed packs. It is the only way in: `core/tools/catalog.ts`
adds pack tools and `core/measures.ts` reads pack measures, both through it. A pack may use core's
public pieces (`db()`, time, the tool types) but never the vault or the gateway's write path.
`npm run check:packs` enforces this, checks pack tool ids, and checks that the old folders
(`domain/`, `agents/cfo` and the rest, `core/green.ts`) are gone.

## One Two's pack (`templates/one-two`)

| Path | What |
| --- | --- |
| `domain/` | Coffee constants and green math (copied from the storefront), bookkeeping rules |
| `agents/` | The code One Two's tools call: Morgan's daily numbers (`cfo`), Avery's brief (`chief-of-staff`), Quinn's books sync (`bookkeeper`), Rowan's wholesale offer (`wholesale-hunter`) |
| `green.ts` | Green use and days of cover |
| `tools.ts` | Green lots, open orders, green use, cover and reorder, the daily snapshot, the wholesale offer, Morgan's saved numbers, and the reports that save the snapshot, send the brief and sync the books |
| `measures.ts` | Lowest days of green cover |

Tool ids, inputs and behaviour are unchanged, so every saved agent keeps its tools.

## Slices

1. **Pack mechanism** (done): the pack folder, registration of tools and measures, the check.
   No behaviour change.
2. **Words** (this one): the hard rules in CLAUDE.md say "the owner" and "the business", not Zak
   and One Two, with the same meaning; Zak approves the wording before it merges. The cap start
   values stay in core (`CAPS`), because each is also the most any org may set: a pack can't
   loosen a hard rule. Text that models or people read in the app (prompts, Control Room copy)
   is not changed here, since changing a prompt changes behaviour.
3. **Installer**: our own Shopify reads (`integrations/shopify/*`, still importing the pack's
   coffee types and listed as not yet moved in `check:packs`), One Two's tables (`kpi_snapshots`,
   `trips`, `home_office`, `tax_packets`) and its crew, playbooks and goals move into the pack,
   installed into an org; a new org starts empty or from a pack. `BRIEF_TO` becomes the org's
   owner email, and app copy and the other docs say "the owner" as each piece moves.
