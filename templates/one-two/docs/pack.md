# One Two's template pack (`templates/one-two`)

The first template pack (docs/templates.md). Its table: `kpi_snapshots`. The books
(receipts, mileage, home office, tax packets) moved to core on card 131: `core/books`, docs/books.md.

| Path | What |
| --- | --- |
| `domain/` | Coffee constants and green math (copied from the storefront) |
| `agents/` | The code One Two's tools call: Morgan's daily numbers (`cfo`), Avery's brief (`chief-of-staff`), Rowan's wholesale offer (`wholesale-hunter`) |
| `shopify/` | Our Shopify reads for One Two's storefront fields: green lots, our coffees, roast loss, the green ledger and roasting board; `README.md` is the field contract with the storefront |
| `green.ts` | Green use and days of cover |
| `tools.ts` | Green lots, open orders, green use, cover and reorder, the daily snapshot, the wholesale offer, Morgan's saved numbers, and the reports that save the snapshot and send the brief |
| `measures.ts` | Lowest days of green cover |
| `crew.json`, `crew.ts` | The starting crew: 5 departments, 28 seats, 10 agents with specs, 9 playbooks, 2 chains, 3 goals |

Tool ids, inputs and behaviour are unchanged, so every saved agent keeps its tools.
