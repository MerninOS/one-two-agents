// Coffee constants and pricing the agents need. Copied from the storefront
// (MerninOS/blended web/src/lib/domain/coffee.ts); keep the numbers in step with it.
// If a value here changes on the storefront, change it here too.
import type { GreenLot, ShopSizeId } from "./types";

export const G_PER_LB = 453.592;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const roastName = (r: number) =>
  ["LIGHT", "LIGHT", "MED-LIGHT", "MEDIUM", "MED-DARK", "DARK"][Math.max(0, Math.min(5, Math.round(r)))];

// ---- pricing ----
export const WHOLESALE_X = 1.85, ROAST_LOSS = 0.84;
const roastedCost = (greenPrice: number) => greenPrice / ROAST_LOSS;
const nickel = (n: number) => Math.round(n * 20) / 20;
/** Wholesale price per roasted lb (what private label accounts pay); the lot can override it. */
export const wholesaleOf = (lot: GreenLot | undefined) =>
  lot ? (lot.wholesale != null ? lot.wholesale : nickel(roastedCost(lot.price) * WHOLESALE_X)) : 0;

// ---- retail bag sizes ----
export const SHOP_SIZES: { id: ShopSizeId; label: string; lb: number }[] = [
  { id: "8oz", label: "8 oz", lb: 0.5 },
  { id: "1lb", label: "1 lb", lb: 1 },
  { id: "2lb", label: "2 lb", lb: 2 },
  { id: "5lb", label: "5 lb", lb: 5 },
];
export const sizeLb = (id: string) => SHOP_SIZES.find((s) => s.id === id)?.lb ?? 1;

/** Bag size from a variant option value ("8 oz", "1 lb", "16oz"…). */
export const sizeFromOption = (v: string): ShopSizeId | null => {
  const t = v.toLowerCase().replace(/\s+/g, "");
  if (/^8oz/.test(t) || t === "0.5lb" || t === "½lb") return "8oz";
  if (/^1lb/.test(t) || t === "16oz") return "1lb";
  if (/^2lb/.test(t)) return "2lb";
  if (/^5lb/.test(t)) return "5lb";
  return null;
};

// ---- private label (wholesale) offer, as the storefront's /wholesale page sells it ----
export const PL_MIN = 5; // lb per order
export const PL_BAGS = [
  { id: "12oz", label: "12 oz" },
  { id: "2lb", label: "2 lb" },
  { id: "5lb", label: "5 lb" },
];
export const PL_PACK = [
  { id: "stock", title: "Our stock bags", rate: "material + $0.55/bag fill" },
  { id: "label", title: "Your label, our bags", rate: "+ $0.42/bag label · $85 plate setup" },
  { id: "own", title: "You supply the bags", rate: "$0.35/bag handling, no material" },
];

/** Hidden line-item property the storefront's checkout puts a custom blend's recipe JSON in. */
export const BLEND_PROP = "_blend";
