import "server-only";
// Morgan's math (CFO daily snapshot): one day's numbers in plain code, no model. The engine's
// tools calc_daily_snapshot and report_kpi_snapshot call it (core/tools/catalog.ts). Orders come
// from Shopify (all channels), green cost from what each order took out of green inventory
// (blended.green_usage, or worked out the same way when it was never deducted), cash from
// Mercury's read-only API.
import { G_PER_LB, round2 } from "@/domain/coffee";
import { db } from "@/core/db";
import { chicagoDate, nextDay, offsetOn } from "@/core/time";
import { mercuryCash } from "@/integrations/mercury";
import { admin, gql } from "@/integrations/shopify/client";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { linesOf, parseRecord, usageOf, type OrderLines } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";

const ORDERS = gql`
  query CfoOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, query: $query) {
      nodes {
        id name tags cancelledAt
        totalPriceSet { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        customer { numberOfOrders }
        usage: metafield(namespace: "blended", key: "green_usage") { value }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
type Money = { shopMoney: { amount: string } };
type OrderNode = {
  id: string; name: string; tags: string[]; cancelledAt: string | null;
  totalPriceSet: Money; subtotalPriceSet: Money | null;
  customer: { numberOfOrders: string } | null;
  usage: { value: string } | null;
  lineItems: OrderLines;
};

async function ordersOn(date: string) {
  const end = nextDay(date);
  const query = `created_at:>='${date}T00:00:00${offsetOn(date)}' created_at:<'${end}T00:00:00${offsetOn(end)}'`;
  const out: OrderNode[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r: R = await admin<R>(ORDERS, { query, after });
    out.push(...r.orders.nodes);
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 20);
  return out.filter((o) => !o.cancelledAt);
}

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
