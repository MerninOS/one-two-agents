import "server-only";
// Orders, read-only: what each order took out of green (the green ledger), and the
// open orders on the roasting board. The storefront writes the data read here:
// blended.green_usage on the order, green:* and stage:* tags, the _blend line property. Read through
// our Shopify MCP server (integrations/shopify-server.ts): each read is one fixed query there.
import type { GreenLot, StockCoffee } from "@/domain/types";
import { BLEND_PROP } from "@/domain/coffee";
import { orderGreenUsage, type GreenLine, type RoastLoss } from "@/domain/green";
import { callMcpTool } from "@/integrations/mcp";

export const TAG_DEDUCTED = "green:deducted", TAG_RESTOCKED = "green:restocked";

/** What an order took, as the storefront stored it (metafield blended.green_usage). */
export interface GreenRecord { v: 1; at: string; lots: { id: string; name: string; g: number }[]; unlinked: string[] }

export type OrderLines = { nodes: { quantity: number; sku: string | null; variant: { id: string } | null; customAttributes: { key: string; value: string | null }[] }[] };

export const linesOf = (o: { lineItems: OrderLines }): GreenLine[] => o.lineItems.nodes.map((li) => ({
  quantity: li.quantity, sku: li.sku, variantGid: li.variant?.id ?? null,
  props: li.customAttributes.map((a) => ({ name: a.key, value: a.value ?? "" })),
}));
export const isWholesale = (tags: string[]) => tags.includes("channel:wholesale");

export interface GreenCtx { stock: StockCoffee[]; lots: GreenLot[]; loss: RoastLoss }

/** Green an order needs, per lot, with names for the record. */
export function usageOf(lines: GreenLine[], tags: string[], ctx: GreenCtx) {
  const { usage, unlinked } = orderGreenUsage(lines, { wholesale: isWholesale(tags), blendProp: BLEND_PROP }, ctx.stock, ctx.lots, ctx.loss);
  const names = new Map(ctx.lots.map((l) => [l.id, l.name]));
  return { usage, unlinked, lots: [...usage].map(([id, g]) => ({ id, name: names.get(id) ?? id, g: Math.round(g) })) };
}

export const parseRecord = (v: string | null | undefined): GreenRecord | null => {
  try { return v ? JSON.parse(v) as GreenRecord : null; } catch { return null; }
};

// ---------- green ledger ----------
type RecentOrder = { id: string; name: string; createdAt: string; tags: string[]; cancelledAt: string | null; usage: { value: string } | null; lineItems: OrderLines };

export interface LedgerRow {
  id: string; name: string; createdAt: string;
  state: "deducted" | "restocked" | "missing" | "unlinked";
  lots: { id: string; name: string; g: number }[];
  unlinked: string[];
}

/** Recent orders with coffee: what each took, and any that never had green deducted. */
export async function greenLedger(ctx: GreenCtx, days = 30): Promise<LedgerRow[]> {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const r = (await callMcpTool("shopify", "shopify_recent_orders", { since })) as { orders: { nodes: RecentOrder[] } };
  const rows: LedgerRow[] = [];
  for (const o of r.orders.nodes) {
    const rec = parseRecord(o.usage?.value);
    if (o.tags.includes(TAG_DEDUCTED)) {
      const lots = rec?.lots ?? usageOf(linesOf(o), o.tags, ctx).lots;
      rows.push({ id: o.id, name: o.name, createdAt: o.createdAt, state: o.tags.includes(TAG_RESTOCKED) ? "restocked" : "deducted", lots, unlinked: rec?.unlinked ?? [] });
      continue;
    }
    if (o.cancelledAt) continue;
    const u = usageOf(linesOf(o), o.tags, ctx);
    if (u.usage.size) rows.push({ id: o.id, name: o.name, createdAt: o.createdAt, state: "missing", lots: u.lots, unlinked: u.unlinked });
    else if (u.unlinked.length) rows.push({ id: o.id, name: o.name, createdAt: o.createdAt, state: "unlinked", lots: [], unlinked: u.unlinked });
  }
  return rows;
}

// ---------- roasting board ----------
type BoardNode = { id: string; name: string; tags: string[]; cancelledAt: string | null; displayFulfillmentStatus: string };

export type Stage = "paid" | "roasting" | "packing" | "shipped";
export interface BoardOrder { id: string; name: string; status: Stage; qcHold: boolean }

/** Storefront orders from the last 90 days (both channels, not cancelled), with their board stage. */
export async function getBoardOrders(): Promise<BoardOrder[]> {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const out: BoardOrder[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: BoardNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_board_orders", { since, after })) as R;
    for (const o of r.orders.nodes) {
      if (o.cancelledAt) continue;
      const shipped = o.displayFulfillmentStatus === "FULFILLED";
      const status: Stage = shipped ? "shipped" : o.tags.includes("stage:packing") ? "packing" : o.tags.includes("stage:roasting") ? "roasting" : "paid";
      out.push({ id: o.id, name: o.name, status, qcHold: o.tags.includes("qc-hold") && !shipped });
    }
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && ++pages < 2);
  return out;
}

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
