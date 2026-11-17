import "server-only";
// A day's orders, read-only, for any business on Shopify: what core's goal measures count
// (core/measures.ts). Read through our Shopify MCP server (integrations/shopify-server.ts): each
// read is one fixed query there. One Two's green ledger and roasting board are its pack's
// (templates/one-two/shopify/orders.ts).
import { callMcpTool } from "@/integrations/mcp";

/** An order's lines as the fixed queries read them. */
export type OrderLines = { nodes: { quantity: number; sku: string | null; variant: { id: string } | null; customAttributes: { key: string; value: string | null }[] }[] };

// ---------- a day's orders (Morgan) ----------
type Money = { shopMoney: { amount: string } };
export type DayOrder = {
  id: string; name: string; tags: string[]; cancelledAt: string | null;
  totalPriceSet: Money; subtotalPriceSet: Money | null;
  customer: { numberOfOrders: string } | null;
  usage: { value: string } | null;
  lineItems: OrderLines;
};

/** Orders created from one Chicago day up to (not including) another, cancelled ones left out. */
export async function ordersBetween(start: string, endExclusive: string): Promise<DayOrder[]> {
  const out: DayOrder[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: DayOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_orders_between", { start, end: endExclusive, after })) as R;
    out.push(...r.orders.nodes);
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 20);
  return out.filter((o) => !o.cancelledAt);
}
