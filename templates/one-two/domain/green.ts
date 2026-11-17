// Green coffee math: every bag sold, from any channel, is roasted to order from green
// lots, so an order's coffee lines turn into green grams (roast loss included). Pure.
// Copied from the storefront (MerninOS/blended web/src/lib/domain/green.ts), keeping
// only the read side; the storefront is the one that deducts green from Shopify.
import type { GreenLot, SelItem, ShopSizeId, StockCoffee } from "./types";
import { G_PER_LB, sizeLb } from "./coffee";

// ---------- roast loss ----------
/** Weight lost in the roaster, in percent, for roast levels 1–5 (light → dark). */
export type RoastLoss = [number, number, number, number, number];
export const DEFAULT_ROAST_LOSS: RoastLoss = [13, 14.5, 16, 17.5, 19];

/** Valid loss table (each 0–40 %), else the defaults. */
export function cleanRoastLoss(v: unknown): RoastLoss {
  if (!Array.isArray(v) || v.length !== 5) return [...DEFAULT_ROAST_LOSS];
  const out = v.map(Number);
  return out.every((n) => Number.isFinite(n) && n >= 0 && n <= 40) ? (out as RoastLoss) : [...DEFAULT_ROAST_LOSS];
}
/** Roasted weight out per green weight in, for a roast level (fractional levels interpolate). */
export function roastYield(roast: number, loss: RoastLoss = DEFAULT_ROAST_LOSS) {
  const x = Math.max(1, Math.min(5, Number(roast) || 3)) - 1, i = Math.min(3, Math.floor(x)), f = x - i;
  const pct = loss[i] * (1 - f) + loss[i + 1] * f;
  return 1 - pct / 100;
}

/** Green grams each lot gives up for `roastedLb` of a recipe at `roast`, added into `into`. */
export function greenUsageG(sel: SelItem[], roastedLb: number, roast: number, loss: RoastLoss = DEFAULT_ROAST_LOSS, into = new Map<string, number>()) {
  const y = roastYield(roast, loss);
  for (const s of sel) into.set(s.id, (into.get(s.id) ?? 0) + (roastedLb * G_PER_LB * s.pct) / 100 / y);
  return into;
}

// ---------- recipes ----------
const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

interface ParsedRecipe { sel: SelItem[]; missing: string[] }
/**
 * Reads "cerrado:60, sierra:40" or "60% Cerrado Norte, 40% Sierra Alta" against the
 * green lots (handles or names). Null when the text isn't a recipe or the shares
 * don't add up to 100; `missing` lists parts that name no green lot.
 */
export function parseRecipe(text: string | undefined, lots: GreenLot[]): ParsedRecipe | null {
  if (!text?.trim()) return null;
  const byKey = new Map<string, GreenLot>();
  for (const l of lots) { byKey.set(norm(l.id), l); byKey.set(norm(l.name), l); }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const sel: SelItem[] = [], missing: string[] = [];
  let total = 0;
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*([^,+;\n]+)|([^,+;:\n]+?)\s*:\s*(\d{1,3}(?:\.\d+)?)/g)) {
    const pct = Number(m[1] ?? m[4]), raw = (m[2] ?? m[3] ?? "").trim(), what = norm(raw);
    if (!(pct > 0)) continue;
    total += pct;
    const key = byKey.has(what) ? what : keys.find((k) => what.startsWith(k + " "));
    const lot = key ? byKey.get(key) : undefined;
    const id = lot?.id ?? raw;
    if (!lot) missing.push(raw);
    const had = sel.find((s) => s.id === id);
    if (had) had.pct += pct; else sel.push({ id, pct });
  }
  return sel.length && Math.abs(total - 100) < .01 ? { sel, missing } : null;
}

/**
 * What a coffee is roasted from: its blended.recipe field, else the "70% Lot, 30% Lot"
 * line a sample blend's description opens with, else (single origins) the green lot of
 * the same name at 100%. Null = not linked to green.
 */
export function linkCoffee(c: Pick<StockCoffee, "name" | "kind" | "recipe" | "blurb">, lots: GreenLot[]): ParsedRecipe | null {
  const own = parseRecipe(c.recipe, lots);
  if (own) return own;
  const desc = parseRecipe(c.blurb?.match(/^\s*\d{1,3}\s*%[^.]*/)?.[0], lots);
  if (desc && !desc.missing.length) return desc;
  if (c.kind === "blend") return null;
  const name = norm(c.name).replace(/ coffee$/, "");
  const lot = lots.find((l) => norm(l.name) === name);
  return lot ? { sel: [{ id: lot.id, pct: 100 }], missing: [] } : null;
}

// ---------- orders ----------
/** One order line, normalised from the Admin API. */
export interface GreenLine {
  quantity: number;
  sku?: string | null;
  variantGid?: string | null;
  props: { name: string; value: string }[];
}
interface BlendRecipeLike { roast: number; sizeId: string; sel: SelItem[] }

/**
 * Green grams per lot an order needs: custom blends from the recipe they carry
 * (`_blend`), our coffees from their variant (retail) or `PL-<handle>` sku (wholesale,
 * quantity in lb). Lines that aren't coffee are ignored; coffees not linked to green
 * are listed in `unlinked`.
 */
export function orderGreenUsage(lines: GreenLine[], o: { wholesale: boolean; blendProp: string }, stock: StockCoffee[], allLots: GreenLot[], loss: RoastLoss) {
  const usage = new Map<string, number>(), unlinked: string[] = [];
  for (const li of lines) {
    const qty = Number(li.quantity) || 0;
    if (qty <= 0) continue;
    const raw = li.props.find((p) => p.name === o.blendProp)?.value;
    if (raw) {
      let r: BlendRecipeLike | null = null; try { r = JSON.parse(raw); } catch { /* not a recipe */ }
      if (r?.sel?.length) greenUsageG(r.sel, o.wholesale ? qty : sizeLb(r.sizeId) * qty, r.roast, loss, usage);
      continue;
    }
    let c: StockCoffee | undefined, lb = 0;
    const pl = o.wholesale && li.sku?.startsWith("PL-") ? li.sku.slice(3) : null;
    if (pl) { c = stock.find((s) => s.id === pl); lb = qty; }
    else if (li.variantGid) {
      c = stock.find((s) => Object.values(s.variants).some((v) => v?.id === li.variantGid));
      const size = c && (Object.entries(c.variants).find(([, v]) => v?.id === li.variantGid)?.[0] as ShopSizeId | undefined);
      lb = size ? sizeLb(size) * qty : 0;
    }
    if (!c || !lb) continue;
    const link = linkCoffee(c, allLots);
    if (!link || link.missing.length) { unlinked.push(c.name); continue; }
    greenUsageG(link.sel, lb, c.roast, loss, usage);
  }
  return { usage, unlinked };
}
