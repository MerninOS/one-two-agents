# Daily numbers

Each morning code works out yesterday's numbers for the business and saves them in `kpi_snapshots`,
for the morning brief (`docs/morning-brief.md`) and goals. No model touches them. Core since card
133.5: `core/daily-numbers.ts`, with the math in `core/daily-numbers-rules.ts`.

## What a day holds

| Number | From |
| --- | --- |
| Revenue | Order totals in Shopify for the day (the app's time zone), cancelled orders left out |
| Goods | Order subtotals: lines after discounts, before shipping and tax |
| Orders, average order | Count, and revenue over count |
| Repeat rate | Orders whose customer has more than one order in Shopify (counted today) |
| Orders and revenue by sales channel | Shopify's own sales channel on each order: online store, point of sale, draft orders, or the app's name |
| Cash | Mercury's read-only API, the accounts on Settings |
| Cost of goods, margin | The source picked on Settings › Daily numbers (below). Margin is (goods − cost) / goods |

## Where cost of goods comes from

Settings › Daily numbers, owners only:

1. **Nowhere** (where every business starts): cost of goods and margin are left out.
2. **Shopify's unit cost**: each line's quantity times its product's cost in Shopify. That is today's
   cost, not the cost on the day of the order. It uses a separate fixed read (`shopify_order_costs`),
   so a read-only app that can't read inventory only loses this number. Items with no cost on their
   product are counted and named in the row's note, never guessed.
3. **A number from your own tool**: a number in dollars from a tool you turned on on a custom server
   and marked "Use as a goal number" (`docs/custom-servers.md`). Code calls it with its pinned inputs
   only, after the tool check, each morning for yesterday. Its tool must answer for yesterday on its
   own (a day input left at its default of 1, or pinned to 1). It can't answer for another day, so a
   snapshot for an earlier day leaves cost out and says why.

Each row records its source in `cost_source`. A failed read leaves cost out and puts the reason in
`detail.costNote`; the rest of the day still saves.

## Tools

| Tool | What it does |
| --- | --- |
| `calc_daily_snapshot` | Works out one day's numbers without saving them |
| `kpi_snapshots` | Reads the latest saved days |
| `report_kpi_snapshot` | After a run, works out yesterday's numbers again in code and saves them |
| `shopify_open_orders` | Open orders by Shopify's fulfillment status (also in the brief) |

Tests: `npm run check:daily-numbers`.
