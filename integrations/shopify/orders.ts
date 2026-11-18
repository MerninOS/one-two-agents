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
