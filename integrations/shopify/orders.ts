import "server-only";
// A day's orders, read-only, for any business on Shopify: what core's goal measures count
// (core/measures.ts). Read through our Shopify MCP server (integrations/shopify-server.ts): each
// read is one fixed query there. Business-specific reads (a roaster's green ledger, say) live in
// that business's template pack.
import { callMcpTool } from "@/integrations/mcp";

/** An order's lines as the fixed queries read them. */
export type OrderLines = { nodes: { quantity: number; sku: string | null; variant: { id: string } | null; customAttributes: { key: string; value: string | null }[] }[] };

// ---------- a day's orders ----------
type Money = { shopMoney: { amount: string } };
export type DayOrder = {
  id: string; name: string; tags: string[]; cancelledAt: string | null;
  /** Shopify's own sales channel for the order ("web", "pos", "shopify_draft_order", an app's id). */
  sourceName?: string | null;
  totalPriceSet: Money; subtotalPriceSet: Money | null;
  customer: { numberOfOrders: string } | null;
  lineItems: OrderLines;
};

/** Orders created from one day up to (not including) another, cancelled ones left out. A pack may
 * read the same days with its own fields through `tool` (one of its fixed queries). */
export async function ordersBetween<T extends DayOrder = DayOrder>(start: string, endExclusive: string, tool = "shopify_orders_between"): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", tool, { start, end: endExclusive, after })) as R;
    out.push(...r.orders.nodes);
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 20);
  return out.filter((o) => !o.cancelledAt);
}

// ---------- unit costs (cost of goods from Shopify, docs/daily-numbers.md) ----------
export type CostOrder = { cancelledAt: string | null; lineItems: { nodes: { quantity: number; variant: { inventoryItem: { unitCost: { amount: string } | null } | null } | null }[] } };

/** The same days' orders with each line's quantity and its product's unit cost in Shopify today. Cancelled ones left out. */
export async function orderCostsBetween(start: string, endExclusive: string): Promise<CostOrder[]> {
  const out: CostOrder[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: CostOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_order_costs", { start, end: endExclusive, after })) as R;
    out.push(...r.orders.nodes);
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 20);
  return out.filter((o) => !o.cancelledAt);
}

// ---------- open orders (the morning brief) ----------
export type OpenOrder = { name: string; cancelledAt: string | null; displayFulfillmentStatus: string };

/** Open orders placed since a day that aren't fully shipped: number and Shopify's fulfillment status. */
export async function openOrders(since: string): Promise<OpenOrder[]> {
  const out: OpenOrder[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: OpenOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_open_orders", { since, after })) as R;
    out.push(...r.orders.nodes);
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 10);
  return out.filter((o) => !o.cancelledAt);
}
