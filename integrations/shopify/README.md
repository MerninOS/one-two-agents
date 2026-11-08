# Shopify: the data contract with the storefront

The storefront (`MerninOS/blended`) writes these fields; the agents only read them,
through the read-only app "One Two Agents (read)". If the storefront changes any of
them, that is a breaking change for the agents: update the queries here in the same
week.

| What | Where in Shopify | Read by |
| --- | --- | --- |
| Green lots | Products tagged `blended-green`, not archived; `status` ACTIVE = listed in the Coffee Lab | `lots.ts` |
| Green stock | The lot's single variant `inventoryQuantity`, in **grams** (total across locations) | `lots.ts` |
| Green cost and prices | Product metafields `blended.green_price`, `blended.wholesale_price`, `blended.retail_price` ($/lb), plus `blended.origin`, `lot_code`, `process`, `roast_level` | `lots.ts` |
| Our coffees | Products in the collection `SHOPIFY_STOCK_COLLECTION` (default `our-coffees`); bag size from the variant option ("8 oz", "1 lb", "2 lb", "5 lb") | `stock.ts` |
| Our coffees' fields | `blended.roast_level`, `blended.wholesale_price`, `blended.subtitle`, `blended.kind`, `blended.recipe` ("cerrado:70, sierra:30" or "70% Cerrado Norte, 30% Sierra Alta") | `stock.ts` |
| Roast loss | Shop metafield `blended.settings` (JSON), key `roastLoss`: five percentages for roast levels 1 to 5 | `settings.ts` |
| Custom blend recipe | Hidden line-item property `_blend`: JSON `{ v, name, roast, sizeId, sel: [{ id, pct, ... }] }` | `domain/green.ts` |
| Green used per order | Order metafield `blended.green_usage`: JSON `{ v: 1, at, lots: [{ id, name, g }], unlinked }`; tags `green:deducted`, `green:restocked` | `orders.ts` |
| Channel | Order tags `channel:retail`, `channel:wholesale`; storefront orders also carry `blended` | `orders.ts`, CFO |
| Board stage | Order tags `stage:roasting`, `stage:packing`, `qc-hold`; shipped = fulfilled | `orders.ts` |
| Wholesale lines | SKU `PL-<handle>`, quantity in lb | `domain/green.ts` |

The pure helpers in `domain/` (`coffee.ts`, `green.ts`) are slimmed copies of the
storefront's `web/src/lib/domain/`. Keep constants (pricing multipliers, roast loss
defaults, private label offer) in step with it.
