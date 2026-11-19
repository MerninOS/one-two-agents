// Coffee constants and pricing the agents need. Copied from the storefront
// (MerninOS/blended web/src/lib/domain/coffee.ts); keep the numbers in step with it.
// If a value here changes on the storefront, change it here too.
import type { ShopSizeId } from "./types";
import { round2 } from "@/core/num";

export const G_PER_LB = 453.592;
export { round2 };

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

/** Hidden line-item property the storefront's checkout puts a custom blend's recipe JSON in. */
export const BLEND_PROP = "_blend";
