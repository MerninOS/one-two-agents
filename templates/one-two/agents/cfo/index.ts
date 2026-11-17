import "server-only";
// Morgan's math (CFO daily snapshot): one day's numbers in plain code, no model. The engine's
// tools calc_daily_snapshot and report_kpi_snapshot call it (core/tools/catalog.ts). Orders come
// from Shopify (all channels), green cost from what each order took out of green inventory
// (blended.green_usage, or worked out the same way when it was never deducted), cash from
// Mercury's read-only API.
import { G_PER_LB, round2 } from "@/templates/one-two/domain/coffee";
import { db } from "@/core/db";
import { chicagoDate, nextDay } from "@/core/time";
import { mercuryCash } from "@/integrations/mercury";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { linesOf, ordersBetween, parseRecord, usageOf } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";

export { ordersBetween };
const ordersOn = (date: string) => ordersBetween(date, nextDay(date));

export async function snapshot(date = chicagoDate(1), opts: { dryRun?: boolean } = {}) {
  const [orders, stock, lots, loss] = await Promise.all([ordersOn(date), fetchStockCoffees(), getInventoryLots(), getRoastLoss()]);
  const ctx = { stock, lots, loss };
  const costPerG = new Map(lots.map((l) => [l.id, l.price / G_PER_LB]));
  const failed: string[] = [];
  let cash: number | null = null;
  try { cash = await mercuryCash(); } catch (e) { failed.push(`mercury: ${e instanceof Error ? e.message : e}`); }

  let revenue = 0, goods = 0, greenCost = 0, repeat = 0;
  const unpriced = new Set<string>(), unlinked = new Set<string>();
  const byChannel: Record<string, { orders: number; revenue: number }> = {};
  for (const o of orders) {
    const total = Number(o.totalPriceSet.shopMoney.amount);
    revenue += total;
    goods += Number(o.subtotalPriceSet?.shopMoney.amount ?? total);
    // numberOfOrders is the customer's count today, so a customer who ordered again since counts as repeat
    if (Number(o.customer?.numberOfOrders ?? 0) > 1) repeat++;
    const ch = o.tags.includes("channel:wholesale") ? "wholesale" : o.tags.includes("channel:retail") ? "retail" : "other";
    byChannel[ch] ??= { orders: 0, revenue: 0 };
    byChannel[ch].orders++; byChannel[ch].revenue = round2(byChannel[ch].revenue + total);

    const rec = parseRecord(o.usage?.value);
    const worked = rec?.lots?.length ? null : usageOf(linesOf(o), o.tags, ctx);
    (rec?.unlinked ?? worked?.unlinked ?? []).forEach((n) => unlinked.add(n));
    for (const u of rec?.lots?.length ? rec.lots : worked?.lots ?? []) {
      const c = costPerG.get(u.id);
      if (c == null) unpriced.add(u.name); else greenCost += u.g * c;
    }
  }
  const row = {
    date,
    revenue: round2(revenue),
    goods: round2(goods),
    orders: orders.length,
    aov: orders.length ? round2(revenue / orders.length) : null,
    repeat_rate: orders.length ? Number((repeat / orders.length).toFixed(4)) : null,
    green_cost: round2(greenCost),
    green_margin: goods > 0 ? Number(((goods - greenCost) / goods).toFixed(4)) : null,
    cash_usd: cash,
    detail: { byChannel, unpricedLots: [...unpriced], unlinkedLines: [...unlinked], failed },
  };
  if (!opts.dryRun) {
    const { error } = await db().from("kpi_snapshots").upsert(row);
    if (error) throw new Error(`Could not save snapshot: ${error.message}`);
  }
  return row;
}
