# One Two's template pack (`templates/one-two`)

The first template pack (docs/templates.md). It has no tables, tools or Shopify reads of its own
since card 133.5. The books
(receipts, mileage, home office, tax packets) moved to core on card 131: `core/books`, docs/books.md.

| Path | What |
| --- | --- |
| `crew.json`, `crew.ts` | The starting crew: 5 departments, 28 seats, 10 agents with specs, 9 playbooks, 2 chains, 3 goals |

Tool ids, inputs and behaviour are unchanged, so every saved agent keeps its tools.

## Product facts (card 132)

Rowan's offer is core's Product facts now (docs/product-facts.md). One Two's private label terms
live in Settings > What agents may say about your products > Offer terms; the lots and coffees to
offer are a Shopify collection there, with `blended.wholesale_price` among the product fields. The
old markup formula (green price / 0.84 x 1.85) is gone: every product offered needs its
`blended.wholesale_price` filled in.

## Coffee tools on One Two's own server (card 133)

Green lots, green use, days of cover and reorder amounts are tools on One Two's own server now: the
storefront's `/api/agents-mcp` route in MerninOS/blended, signed in with `AGENTS_MCP_KEY`, added on
Connections as a custom server like any customer's. The "Lowest days of green cover" goal is a goal
number from its `green_cover` tool (`numbers.lowest_days_of_cover`). Marlow and Avery get the tools on
the builder's Tools step.

## Daily numbers and the brief in core (card 133.5)

`kpi_snapshots`, the daily numbers (`core/daily-numbers.ts`, docs/daily-numbers.md) and the morning
brief (`core/brief`, docs/morning-brief.md) are core's now, with the same tool ids. One Two's coffee
lines come from its own server:

- Cost of goods: Settings › Daily numbers › "A number from your own tool", the `green_cost` tool's
  `numbers.green_cost_usd` (a goal number in dollars).
- In the brief: goal numbers marked "Show in the morning brief": orders to roast (`orders_by_stage`
  `numbers.paid`), lowest days of cover (`green_cover`) and orders never deducted (`green_use`).
- The open orders line is Shopify's own fulfillment status; the roasting stages are on the server.

`domain/`, `agents/`, `shopify/` and `tools.ts` are gone, and so is `SHOPIFY_STOCK_COLLECTION`.
