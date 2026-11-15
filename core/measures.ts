import "server-only";
// The goal measures (core/goal-rules.ts MEASURES), counted in code from our own tables, Shopify
// (read-only) and Mercury (read-only). A model never supplies a number here. Each read gives up
// after a while and says why, so a slow service shows "Couldn't read" instead of hanging a page.
import { round2 } from "@/domain/coffee";
import { db } from "@/core/db";
import { chicagoDate, nextDay } from "@/core/time";
import { ordersBetween } from "@/agents/cfo";
import { cover } from "@/core/green";
import { burnRate } from "@/core/money";
import { measureOf, type MeasureKey, type Reading } from "@/core/goal-rules";

/** The leads list by stage, in funnel order (wholesale_leads.stage). */
export const FUNNEL = ["new", "drafted", "contacted", "replied", "tasting", "won"] as const;
export type Funnel = Record<(typeof FUNNEL)[number], number>;
/** Extra detail a goal page can draw: the leads funnel, or each lot's days of cover. */
export type Detail = { funnel: Funnel } | { lots: { lot: string; days: number | null }[] } | null;
export type MeasureRead = { reading: Reading; detail: Detail };

const TIMEOUT_MS = 20_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
const withTimeout = <T,>(p: Promise<T>, what: string) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} took too long`)), TIMEOUT_MS))]);

async function monthOrders(today: string) {
  const start = `${today.slice(0, 7)}-01`;
  const orders = await ordersBetween(start, nextDay(today));
  return { count: orders.length, revenue: round2(orders.reduce((s, o) => s + Number(o.totalPriceSet.shopMoney.amount), 0)) };
}

async function readOne(key: MeasureKey, today: string, shared: { month?: ReturnType<typeof monthOrders> }): Promise<MeasureRead> {
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
    case "lowest_cover_days": {
      const rows = await cover(30);
      const known = rows.filter((r) => r.daysOfCover != null).map((r) => r.daysOfCover!);
      if (!known.length) return { reading: { error: rows.length ? "no listed lot was used in the last 30 days" : "no listed green lots" }, detail: null };
      return { reading: { value: Math.min(...known) }, detail: { lots: rows.map((r) => ({ lot: r.lot, days: r.daysOfCover })).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)) } };
    }
    case "runway_months": {
      const b = await burnRate(90);
      if (b.cashUsd == null) return { reading: { error: "cash isn't set up (MERCURY_ACCOUNT_IDS)" }, detail: null };
      if (b.runwayMonths == null) return { reading: { value: 0, unbounded: true }, detail: null };
      return { reading: { value: b.runwayMonths }, detail: null };
    }
    case "email_list_size":
      return { reading: { error: "there's no Klaviyo read yet" }, detail: null };
  }
}

/** Reads each measure once, however many goals use it. Unknown or not-yet-countable keys are left out. */
export async function readMeasures(keys: readonly (string | null)[], now = new Date()): Promise<Record<string, MeasureRead>> {
  const today = chicagoDate(0, now);
  const want = [...new Set(keys)].map((k) => measureOf(k)).filter((m) => m?.available) as { key: MeasureKey }[];
  const shared: { month?: ReturnType<typeof monthOrders> } = {};
  const got = await Promise.all(want.map(async (m): Promise<[string, MeasureRead]> => {
    try { return [m.key, await withTimeout(readOne(m.key, today, shared), measureOf(m.key)!.label)]; }
    catch (e) { return [m.key, { reading: { error: msg(e) }, detail: null }]; }
  }));
  return Object.fromEntries(got);
}
