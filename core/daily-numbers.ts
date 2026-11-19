import "server-only";
// One day's numbers for any business (docs/daily-numbers.md), in plain code with no model: orders from
// Shopify (core's fixed read), cash from Mercury's read-only API, and cost of goods from the source the
// owner picked on Settings: none, Shopify's unit cost, or a number in dollars from the business's own
// tool (read after the same tool check agents get). The tools calc_daily_snapshot and
// report_kpi_snapshot call it (core/tools/catalog.ts); the morning brief reads the saved rows.
import { db } from "@/core/db";
import { settings } from "@/core/settings";
import { chicagoDate, nextDay } from "@/core/time";
import { ownNumberSources, readOwnNumber } from "@/core/tools/custom";
import { mercuryCash } from "@/integrations/mercury";
import { orderCostsBetween, ordersBetween } from "@/integrations/shopify/orders";
import { channelOf, daySnapshot, shopifyCost, type DayCost, type DayRow } from "./daily-numbers-rules";

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Cost of goods for one day, from the source on Settings. Never throws: a failed read is a note on the row. */
async function costOn(date: string): Promise<DayCost> {
  const s = await settings();
  if (s.costSource === "shopify") {
    try {
      const orders = await orderCostsBetween(date, nextDay(date));
      const lines = orders.flatMap((o) => o.lineItems.nodes.map((l) => ({ quantity: l.quantity, unitCost: l.variant?.inventoryItem?.unitCost ? Number(l.variant.inventoryItem.unitCost.amount) : null })));
      const c = shopifyCost(lines);
      return { source: "shopify", usd: c.usd, ...(c.uncosted ? { note: `${c.uncosted} item(s) had no unit cost in Shopify, so cost of goods is low` } : {}) };
    } catch (e) { return { source: "shopify", usd: null, note: `Shopify's unit costs couldn't be read: ${why(e)}` }; }
  }
  if (s.costSource === "own" && s.costNumber) {
    // the own number gives yesterday's cost: it can't answer for another day
    if (date !== chicagoDate(1)) return { source: "own", usd: null, note: "your own number gives yesterday's cost only" };
    const src = (await ownNumberSources()).find((n) => n.key === s.costNumber);
    if (!src || src.number.unit !== "usd") return { source: "own", usd: null, note: "the number picked on Settings › Daily numbers isn't on Connections any more" };
    const r = await readOwnNumber(src).catch((e: unknown) => ({ error: why(e) }));
    return "value" in r ? { source: "own", usd: r.value } : { source: "own", usd: null, note: `${src.number.label} couldn't be read: ${r.error}` };
  }
  return { source: "none", usd: null };
}

export async function snapshot(date = chicagoDate(1), opts: { dryRun?: boolean } = {}): Promise<DayRow> {
  const failed: string[] = [];
  const [orders, cost, cash] = await Promise.all([
    ordersBetween(date, nextDay(date)),
    costOn(date),
    mercuryCash().catch((e: unknown) => { failed.push(`mercury: ${why(e)}`); return null; }),
  ]);
  const row = daySnapshot(date, orders.map((o) => {
    const total = Number(o.totalPriceSet.shopMoney.amount);
    // numberOfOrders is the customer's count today, so a customer who ordered again since counts as repeat
    return { total, goods: Number(o.subtotalPriceSet?.shopMoney.amount ?? total), repeat: Number(o.customer?.numberOfOrders ?? 0) > 1, channel: channelOf(o.sourceName) };
  }), cost, cash, failed);
  if (!opts.dryRun) {
    const { error } = await db().from("kpi_snapshots").upsert(row);
    if (error) throw new Error(`Could not save snapshot: ${error.message}`);
  }
  return row;
}
