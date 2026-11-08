import "server-only";
// Orders, read-only: what each order took out of green (the green ledger), and the
// open orders on the roasting board. The storefront writes the data read here:
// blended.green_usage on the order, green:* and stage:* tags, the _blend line property.
import type { GreenLot, StockCoffee } from "@/domain/types";
import { BLEND_PROP } from "@/domain/coffee";
import { orderGreenUsage, type GreenLine, type RoastLoss } from "@/domain/green";
import { admin, gql } from "./client";

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
const RECENT = gql`
  query AgentGreenRecentOrders($query: String!) {
    orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        id name createdAt tags cancelledAt
        usage: metafield(namespace: "blended", key: "green_usage") { value }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
    }
  }
`;
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
  const r = await admin<{ orders: { nodes: RecentOrder[] } }>(RECENT, { query: `created_at:>=${since}` });
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
// Only what the brief counts: no customer names, emails or addresses.
const BOARD = gql`
  query AgentBoardOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes { id name tags cancelledAt displayFulfillmentStatus }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
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
    const r: R = await admin<R>(BOARD, { query: `tag:blended created_at:>=${since}`, after });
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
