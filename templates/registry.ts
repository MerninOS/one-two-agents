// The pure parts of each installed template pack (docs/templates.md): its fixed Shopify reads and
// its goal measures' definitions. Pure, so core's pure rules (core/shopify-queries.ts,
// core/goal-rules.ts) can list them; the rest of a pack registers in templates/index.ts. Adding a pack
// is a pull request.
import type { ShopifyQuery } from "@/core/shopify-rules";
import type { MeasureDef } from "@/core/goal-rules";

/** Every pack's Shopify read tools, each one fixed read query. */
export const PACK_SHOPIFY: readonly ShopifyQuery[] = [];
/** Every pack's goal measures (the reader is the pack's `measures` in templates/index.ts). */
export const PACK_MEASURE_DEFS: readonly MeasureDef[] = [];
