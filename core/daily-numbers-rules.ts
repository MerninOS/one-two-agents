// One day's numbers for any business (docs/daily-numbers.md): revenue, goods, orders, average order,
// repeat rate, cash, orders by sales channel, and cost of goods and margin from the source the owner
// picked on Settings. Pure, so check:daily-numbers can test it; core/daily-numbers.ts reads the inputs.
import type { CostSource } from "./settings-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One order as the day's math needs it. */
export interface SnapOrder { total: number; goods: number; repeat: boolean; channel: string }

/** Shopify's sales channel for an order, in words: the online store, point of sale, draft orders, or the app's own name. */
export function channelOf(sourceName: string | null | undefined): string {
  const s = (sourceName ?? "").trim().toLowerCase();
  if (!s) return "other";
  if (s === "web") return "online store";
  if (s === "pos") return "point of sale";
  if (s === "shopify_draft_order") return "draft orders";
  return s.replace(/[^a-z0-9 _-]/g, "").slice(0, 40) || "other";
}

/** A line with its quantity and its product's unit cost in Shopify, as the order costs read returns it. */
export interface CostLine { quantity: number; unitCost: number | null }

/** Cost of goods from Shopify's unit cost: quantity × cost per line. Lines with no cost on their product are counted, not guessed. */
export function shopifyCost(lines: readonly CostLine[]): { usd: number; uncosted: number } {
  let usd = 0, uncosted = 0;
  for (const l of lines) {
    if (l.unitCost == null || !Number.isFinite(l.unitCost) || l.unitCost < 0) { uncosted += l.quantity; continue; }
    usd += l.quantity * l.unitCost;
  }
  return { usd: round2(usd), uncosted };
}

/** What the cost source gave for the day: a dollar amount, or none with the reason. */
export type DayCost = { source: CostSource; usd: number | null; note?: string };

export interface DayRow {
  date: string;
  revenue: number;
  goods: number;
  orders: number;
  aov: number | null;
  repeat_rate: number | null;
  cost_of_goods: number | null;
  margin: number | null;
  cost_source: CostSource;
  cash_usd: number | null;
  detail: { byChannel: Record<string, { orders: number; revenue: number }>; costNote?: string; failed: string[] };
}

/** One day's row for kpi_snapshots. Margin is (goods − cost) / goods, left out when there's no cost or no goods. */
export function daySnapshot(date: string, orders: readonly SnapOrder[], cost: DayCost, cash: number | null, failed: string[] = []): DayRow {
  let revenue = 0, goods = 0, repeat = 0;
  const byChannel: DayRow["detail"]["byChannel"] = {};
  for (const o of orders) {
    revenue += o.total; goods += o.goods;
    if (o.repeat) repeat++;
    byChannel[o.channel] ??= { orders: 0, revenue: 0 };
    byChannel[o.channel].orders++; byChannel[o.channel].revenue = round2(byChannel[o.channel].revenue + o.total);
  }
  const usd = cost.usd != null && Number.isFinite(cost.usd) && cost.usd >= 0 ? round2(cost.usd) : null;
  return {
    date,
    revenue: round2(revenue),
    goods: round2(goods),
    orders: orders.length,
    aov: orders.length ? round2(revenue / orders.length) : null,
    repeat_rate: orders.length ? Number((repeat / orders.length).toFixed(4)) : null,
    cost_of_goods: usd,
    margin: usd != null && goods > 0 ? Number(((goods - usd) / goods).toFixed(4)) : null,
    cost_source: cost.source,
    cash_usd: cash,
    detail: { byChannel, ...(cost.note ? { costNote: cost.note } : {}), failed },
  };
}
