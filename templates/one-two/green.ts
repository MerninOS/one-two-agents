import "server-only";
// Green coffee math in plain code: how much of each lot orders used, and how many days each listed
// lot lasts at that rate. Shared by the tool list (calc_green_use, calc_green_cover,
// calc_reorder_amount) and the goal measure "Lowest days of green cover" (core/measures.ts).
import { G_PER_LB } from "@/templates/one-two/domain/coffee";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { greenLedger } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";

export const lb = (g: number) => Math.round((g / G_PER_LB) * 10) / 10;

/** Green used per lot over a window, from orders that had green deducted (the same ledger Avery's brief uses). */
export async function greenUse(days: number) {
  const [lots, stock, loss] = await Promise.all([getInventoryLots(), fetchStockCoffees(), getRoastLoss()]);
  const ledger = await greenLedger({ stock, lots, loss }, days);
  const used = new Map<string, number>();
  for (const r of ledger) if (r.state === "deducted") for (const l of r.lots) used.set(l.id, (used.get(l.id) ?? 0) + l.g);
  return { lots, used, neverDeducted: ledger.filter((r) => r.state === "missing").length };
}

/** Days of cover for each listed lot: grams on hand divided by grams used per day over the window. */
export async function cover(days: number) {
  const { lots, used } = await greenUse(days);
  return lots.filter((l) => l.listed).map((l) => {
    const perDay = (used.get(l.id) ?? 0) / days;
    return { id: l.id, lot: l.name, onHandLb: lb(l.availG), usedPerWeekLb: lb(perDay * 7), daysOfCover: perDay > 0 ? Math.round(l.availG / perDay) : null, perDayG: perDay, onHandG: l.availG, priceUsdPerLb: l.price };
  });
}
