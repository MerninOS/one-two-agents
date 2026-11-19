import "server-only";
// The goal measures (core/goal-rules.ts MEASURES), counted in code from our own tables, Shopify
// (read-only), Mercury (read-only) and Klaviyo (its MCP server, read-only). A model never supplies a number here. Each read gives up
// after a while and says why, so a slow service shows "Couldn't read" instead of hanging a page.
import { round2 } from "@/core/num";
import { db } from "@/core/db";
import { chicagoDate, nextDay } from "@/core/time";
import { ordersBetween } from "@/integrations/shopify/orders";
import { burnRate } from "@/core/money";
import { measureOf, type MeasureKey, type Reading } from "@/core/goal-rules";
import { mcpStatus } from "@/integrations/mcp";
import { klaviyoListSize } from "@/integrations/klaviyo";
import { numberDefs, type NumberSource } from "@/core/goal-number-rules";
import { ownNumberSources, readOwnNumber } from "@/core/tools/custom";

/** The leads list by stage, in funnel order (wholesale_leads.stage). */
export const FUNNEL = ["new", "drafted", "contacted", "replied", "tasting", "won"] as const;
export type Funnel = Record<(typeof FUNNEL)[number], number>;
/** Extra detail a goal page can draw: the leads funnel. */
export type Detail = { funnel: Funnel } | null;
export type MeasureRead = { reading: Reading; detail: Detail };

const TIMEOUT_MS = 20_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
const withTimeout = <T,>(p: Promise<T>, what: string) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} took too long`)), TIMEOUT_MS))]);

async function monthOrders(today: string) {
  const start = `${today.slice(0, 7)}-01`;
  const orders = await ordersBetween(start, nextDay(today));
  return { count: orders.length, revenue: round2(orders.reduce((s, o) => s + Number(o.totalPriceSet.shopMoney.amount), 0)) };
}

async function readOne(key: MeasureKey, today: string, shared: { month?: ReturnType<typeof monthOrders> }, own: readonly NumberSource[]): Promise<MeasureRead> {
  const mine = own.find((s) => s.key === key);
  if (mine) return { reading: await readOwnNumber(mine), detail: null };
  switch (key) {
    case "wholesale_won": {
      const { data, error } = await db().from("wholesale_leads").select("stage").limit(5000);
      if (error) throw new Error(`the leads list: ${error.message}`);
      const funnel = Object.fromEntries(FUNNEL.map((s) => [s, 0])) as Funnel;
      for (const r of data ?? []) if ((FUNNEL as readonly string[]).includes(r.stage)) funnel[r.stage as keyof Funnel]++;
      return { reading: { value: funnel.won }, detail: { funnel } };
    }
    case "revenue_month":
    case "orders_month": {
      shared.month ??= monthOrders(today);
      const m = await shared.month;
      return { reading: { value: key === "orders_month" ? m.count : m.revenue }, detail: null };
    }
    case "runway_months": {
      const b = await burnRate(90);
      if (b.cashUsd == null) return { reading: { error: "cash isn't set up (Mercury accounts on Settings)" }, detail: null };
      if (b.runwayMonths == null) return { reading: { value: 0, unbounded: true }, detail: null };
      return { reading: { value: b.runwayMonths }, detail: null };
    }
    case "email_list_size": {
      const k = await mcpStatus("klaviyo");
      if (!k?.connected) return { reading: { error: "Klaviyo isn't connected (Connections › Klaviyo)" }, detail: null };
      const list = k.settings.emailListId;
      if (!list) return { reading: { error: "pick the email list on Connections › Klaviyo" }, detail: null };
      return { reading: { value: (await klaviyoListSize(list)).profiles }, detail: null };
    }
    default:
      return { reading: { error: "nothing counts this measure" }, detail: null };
  }
}

/** The business's own goal numbers (core/goal-number-rules.ts), as measures. Empty when none, or when they can't be listed. */
export async function ownMeasures(): Promise<{ sources: NumberSource[]; defs: ReturnType<typeof numberDefs> }> {
  const sources = await ownNumberSources().catch(() => []);
  return { sources, defs: numberDefs(sources) };
}

/** Reads each measure once, however many goals use it. Unknown or not-yet-countable keys are left out. */
export async function readMeasures(keys: readonly (string | null)[], now = new Date(), own?: Awaited<ReturnType<typeof ownMeasures>>): Promise<Record<string, MeasureRead>> {
  const today = chicagoDate(0, now);
  const o = own ?? (keys.some((k) => k?.startsWith("n_")) ? await ownMeasures() : { sources: [], defs: [] });
  const want = [...new Set(keys)].map((k) => measureOf(k, o.defs)).filter((m) => m?.available) as { key: MeasureKey; label: string }[];
  const shared: { month?: ReturnType<typeof monthOrders> } = {};
  const got = await Promise.all(want.map(async (m): Promise<[string, MeasureRead]> => {
    try { return [m.key, await withTimeout(readOne(m.key, today, shared, o.sources), m.label)]; }
    catch (e) { return [m.key, { reading: { error: msg(e) }, detail: null }]; }
  }));
  return Object.fromEntries(got);
}
