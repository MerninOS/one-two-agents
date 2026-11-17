// The coffee shapes agents work with, read from Shopify (see integrations/shopify/README.md).
// Copied in slimmed form from the storefront (MerninOS/blended web/src/lib/domain/types.ts):
// only the fields agents use.

/** A green coffee lot: a Shopify product tagged `blended-green`, stock in grams. */
export interface GreenLot {
  id: string;            // product handle, e.g. "cerrado"
  gid: string;           // Shopify product GID
  name: string;
  origin: string;        // "Brazil · Minas Gerais"
  lot: string;           // "LOT-2571"
  process: string;
  roast: number;         // preferred roast, 1–5
  price: number;         // green cost $/lb
  wholesale: number | null; // $/lb roasted; null = standard markup
  retail: number | null;    // $/lb roasted; null = standard markup
  avail: number;         // green lb available (rounded to 0.1)
  availG: number;        // the same in exact grams
  listed: boolean;       // product is ACTIVE: customers can put it in a blend
}

export type ShopSizeId = "8oz" | "1lb" | "2lb" | "5lb";

/** One of our coffees, roasted and sold as-is (a product in the "Our coffees" collection). */
export interface StockCoffee {
  id: string;            // product handle
  gid: string;
  name: string;
  sub: string;           // "House blend · Brazil + Mexico" (blended.subtitle)
  roast: number;
  price: number;         // wholesale $/lb (blended.wholesale_price)
  variants: Partial<Record<ShopSizeId, { id: string; price: number; available: boolean }>>;
  kind?: "single" | "blend";
  /** "70% Cerrado Norte, 30% Sierra Alta" or "cerrado:70, sierra:30" (blended.recipe). */
  recipe?: string;
  blurb: string;         // product description
}

/** A component of a blend: green lot handle and its share in percent. */
export interface SelItem { id: string; pct: number }
