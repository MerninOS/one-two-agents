import "server-only";
// The tool list (docs/agent-builder.md): every ability an agent built in the app can be given.
// Slice 1 has Read and Calculate tools only, built from code the four agents already use.
// Report and Action tools arrive in slice 5, and actions only ever go through core/gateway.
// Rules that hold for every tool here:
// - Read-only. No tool on this list writes anything, anywhere.
// - Numbers are computed in code and returned in `numbers`, never left to the model.
// - Inputs are small, checked values (whole numbers in a range, or a choice from a fixed list).
//   No tool takes a URL, an address or free text from the model.
import { G_PER_LB, round2 } from "@/domain/coffee";
import { db } from "@/core/db";
import { chicagoDate } from "@/core/time";
import { snapshot } from "@/agents/cfo";
import { mercuryCash, mercuryTransactions } from "@/integrations/mercury";
import { notionPageText } from "@/integrations/notion";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { getBoardOrders, greenLedger } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";
import type { Param, ToolDef } from "./types";

const SHOPIFY = ["SHOPIFY_STORE_DOMAIN"], MERCURY = ["MERCURY_API_TOKEN"], NOTION = ["NOTION_TOKEN"], SUPABASE = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const daysParam = (def: number, max: number, what: string): Param => ({ name: "days", type: "int", min: 1, max, default: def, description: what });
const lb = (g: number) => Math.round((g / G_PER_LB) * 10) / 10;

/** Green used per lot over a window, from orders that had green deducted (the same ledger Avery's brief uses). */
async function greenUse(days: number) {
  const [lots, stock, loss] = await Promise.all([getInventoryLots(), fetchStockCoffees(), getRoastLoss()]);
  const ledger = await greenLedger({ stock, lots, loss }, days);
  const used = new Map<string, number>();
  for (const r of ledger) if (r.state === "deducted") for (const l of r.lots) used.set(l.id, (used.get(l.id) ?? 0) + l.g);
  return { lots, used, neverDeducted: ledger.filter((r) => r.state === "missing").length };
}

/** Days of cover for each listed lot: grams on hand divided by grams used per day over the window. */
async function cover(days: number) {
  const { lots, used } = await greenUse(days);
  return lots.filter((l) => l.listed).map((l) => {
    const perDay = (used.get(l.id) ?? 0) / days;
    return { id: l.id, lot: l.name, onHandLb: lb(l.availG), usedPerWeekLb: lb(perDay * 7), daysOfCover: perDay > 0 ? Math.round(l.availG / perDay) : null, perDayG: perDay, onHandG: l.availG, priceUsdPerLb: l.price };
  });
}

const TOOLS_LIST: ToolDef[] = [
  // ---- Shopify (read-only app "One Two Agents (read)")
  {
    id: "shopify_green_lots", label: "Green lots on hand", detail: "Every green lot that isn't archived: origin, lot code, process, pounds on hand, green price, and whether customers can pick it",
    kind: "read", group: "shopify", params: [], trusted: true, needs: SHOPIFY, costUsd: 0,
    run: async () => {
      const lots = await getInventoryLots();
      return {
        data: lots.map((l) => ({ id: l.id, lot: l.name, origin: l.origin, lotCode: l.lot, process: l.process, onHandLb: l.avail, greenUsdPerLb: l.price, listed: l.listed })),
        numbers: { lots: lots.length, listed_lots: lots.filter((l) => l.listed).length, green_on_hand_lb: round2(lots.reduce((s, l) => s + l.avail, 0)) },
      };
    },
  },
  {
    id: "shopify_open_orders", label: "Open orders", detail: "Open orders by stage (paid, roasting, packing) and which are on QC hold. Order numbers only, no customer details",
    kind: "read", group: "shopify", params: [], trusted: true, needs: SHOPIFY, costUsd: 0,
    run: async () => {
      const open = (await getBoardOrders()).filter((o) => o.status !== "shipped");
      const count = (s: string) => open.filter((o) => o.status === s).length;
      const qc = open.filter((o) => o.qcHold).map((o) => o.name);
      return { data: { paid: count("paid"), roasting: count("roasting"), packing: count("packing"), qcHold: qc }, numbers: { open_orders: open.length, paid: count("paid"), roasting: count("roasting"), packing: count("packing"), qc_hold: qc.length } };
    },
  },

  // ---- Calculate (plain code, no model)
  {
    id: "calc_green_use", label: "Green use per week", detail: "Pounds of each green lot used per week, from orders over a window",
    kind: "calculate", group: "calculate", params: [daysParam(30, 90, "How many days of orders to average over.")], trusted: true, needs: SHOPIFY, costUsd: 0,
    run: async ({ days }) => {
      const d = Number(days);
      const { lots, used, neverDeducted } = await greenUse(d);
      const rows = lots.filter((l) => used.has(l.id)).map((l) => ({ id: l.id, lot: l.name, usedLb: lb(used.get(l.id)!), perWeekLb: lb((used.get(l.id)! / d) * 7) }));
      return { data: { windowDays: d, lots: rows, ordersNeverDeducted: neverDeducted }, numbers: { green_used_lb: round2(rows.reduce((s, r) => s + r.usedLb, 0)), orders_never_deducted: neverDeducted } };
    },
  },
  {
    id: "calc_green_cover", label: "Days of green cover", detail: "For each listed lot: pounds on hand, weekly use and how many days it lasts at that rate",
    kind: "calculate", group: "calculate", params: [daysParam(30, 90, "How many days of orders the weekly use is averaged over.")], trusted: true, needs: SHOPIFY, costUsd: 0,
    run: async ({ days }) => {
      const rows = await cover(Number(days));
      const known = rows.filter((r) => r.daysOfCover != null).map((r) => r.daysOfCover!);
      return {
        data: { windowDays: Number(days), lots: rows.map(({ id, lot, onHandLb, usedPerWeekLb, daysOfCover }) => ({ id, lot, onHandLb, usedPerWeekLb, daysOfCover })), note: "daysOfCover is null when the lot wasn't used in the window" },
        numbers: { lowest_days_of_cover: known.length ? Math.min(...known) : -1, lots_under_21_days: known.filter((n) => n < 21).length },
      };
    },
  },
  {
    id: "calc_reorder_amount", label: "Reorder amount for a cover target", detail: "For each listed lot under the target: pounds to buy to get back to that many days of cover, and the green cost at today's price",
    kind: "calculate", group: "calculate", trusted: true, needs: SHOPIFY, costUsd: 0,
    params: [{ name: "target_days", type: "int", min: 7, max: 180, default: 60, description: "Days of cover to get back to." }, daysParam(30, 90, "How many days of orders the weekly use is averaged over.")],
    run: async ({ target_days, days }) => {
      const target = Number(target_days);
      const rows = (await cover(Number(days))).filter((r) => r.daysOfCover != null && r.daysOfCover < target).map((r) => {
        const needLb = lb(Math.max(0, r.perDayG * target - r.onHandG));
        return { id: r.id, lot: r.lot, daysOfCover: r.daysOfCover, reorderLb: needLb, greenCostUsd: round2(needLb * r.priceUsdPerLb) };
      });
      return { data: { targetDays: target, lots: rows }, numbers: { lots_to_reorder: rows.length, reorder_lb: round2(rows.reduce((s, r) => s + r.reorderLb, 0)), reorder_cost_usd: round2(rows.reduce((s, r) => s + r.greenCostUsd, 0)) } };
    },
  },
  {
    id: "calc_daily_snapshot", label: "Daily numbers snapshot", detail: "Morgan's math for one day: revenue, orders, AOV, repeat rate, green cost and margin, cash. Worked out, not saved",
    kind: "calculate", group: "calculate", params: [daysParam(1, 30, "How many days ago (1 = yesterday).")], trusted: true, needs: [...SHOPIFY, ...MERCURY], costUsd: 0,
    run: async ({ days }) => {
      const s = await snapshot(chicagoDate(Number(days)), { dryRun: true });
      const numbers: Record<string, number> = { revenue_usd: s.revenue, orders: s.orders };
      if (s.aov != null) numbers.aov_usd = s.aov;
      if (s.repeat_rate != null) numbers.repeat_rate = s.repeat_rate;
      if (s.green_margin != null) numbers.green_margin = s.green_margin;
      if (s.cash_usd != null) numbers.cash_usd = s.cash_usd;
      return { data: s, numbers };
    },
  },
  {
    id: "calc_burn_rate", label: "Burn rate and runway", detail: "From Mercury: money out and in per 30 days over a window, net burn, and months of cash left at that rate",
    kind: "calculate", group: "calculate", params: [daysParam(90, 180, "How many days of Mercury history to average over.")], trusted: true, needs: MERCURY, costUsd: 0,
    run: async ({ days }) => {
      const d = Number(days);
      const [txns, cash] = await Promise.all([mercuryTransactions(chicagoDate(d), chicagoDate(0)), mercuryCash()]);
      // money moving between One Two's own accounts is neither spend nor income
      const real = txns.filter((t) => !/internal|treasury/i.test(t.kind ?? ""));
      const out = real.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      const inn = real.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const per30 = (x: number) => round2((x / d) * 30);
      const net = per30(out - inn);
      const runway = cash != null && net > 0 ? Math.round((cash / net) * 10) / 10 : null;
      const numbers: Record<string, number> = { spend_per_30d_usd: per30(out), income_per_30d_usd: per30(inn), net_burn_per_30d_usd: net };
      if (cash != null) numbers.cash_usd = cash;
      if (runway != null) numbers.runway_months = runway;
      return { data: { windowDays: d, transactions: real.length, spendPer30dUsd: per30(out), incomePer30dUsd: per30(inn), netBurnPer30dUsd: net, cashUsd: cash, runwayMonths: runway, note: runway == null ? (cash == null ? "Cash isn't set up (MERCURY_ACCOUNT_IDS), so no runway." : "Not burning cash over this window, so no runway limit.") : undefined }, numbers };
    },
  },

  // ---- Mercury (read-only token, business org)
  {
    id: "mercury_balances", label: "Cash balance", detail: "Available cash across One Two's Mercury accounts",
    kind: "read", group: "mercury", params: [], trusted: true, needs: MERCURY, costUsd: 0,
    run: async () => { const cash = await mercuryCash(); const numbers: Record<string, number> = cash == null ? {} : { cash_usd: cash }; return { data: { cashUsd: cash }, numbers }; },
  },
  {
    id: "mercury_charges", label: "Charges", detail: "Settled money in and out over a window: date, merchant, amount, category. Merchant names come from outside, so they are untrusted",
    kind: "read", group: "mercury", params: [daysParam(30, 60, "How many days back.")], trusted: false, needs: MERCURY, costUsd: 0,
    run: async ({ days }) => {
      const txns = await mercuryTransactions(chicagoDate(Number(days)), chicagoDate(0));
      const rows = txns.slice(-200).map((t) => ({ date: (t.postedAt ?? t.createdAt ?? "").slice(0, 10), merchant: t.counterpartyNickname || t.counterpartyName || t.bankDescription || "?", amountUsd: t.amount, category: t.categoryData?.name ?? t.mercuryCategory ?? null }));
      return { data: { days: Number(days), shown: rows.length, of: txns.length, charges: rows }, numbers: { transactions: txns.length } };
    },
  },

  // ---- Our own records (Supabase)
  {
    id: "kpi_snapshots", label: "Morgan's daily numbers", detail: "The latest daily snapshots Morgan saved: revenue, orders, AOV, repeat rate, green margin, cash",
    kind: "read", group: "supabase", params: [daysParam(8, 30, "How many days of snapshots.")], trusted: true, needs: SUPABASE, costUsd: 0,
    run: async ({ days }) => {
      const { data, error } = await db().from("kpi_snapshots").select("date, revenue, orders, aov, repeat_rate, green_margin, cash_usd").order("date", { ascending: false }).limit(Number(days));
      if (error) throw new Error(error.message);
      const latest = data?.[0];
      const numbers: Record<string, number> = { snapshots: data?.length ?? 0 };
      if (latest) { numbers.latest_revenue_usd = Number(latest.revenue); numbers.latest_orders = Number(latest.orders); }
      return { data: data ?? [], numbers };
    },
  },
  {
    id: "agent_runs_recent", label: "Other agents' runs", detail: "Every agent run in the last 24 hours: who, when, status and summary. Summaries can quote web pages, so they are untrusted",
    kind: "read", group: "supabase", params: [], trusted: false, needs: SUPABASE, costUsd: 0,
    run: async (_input, ctx) => {
      const since = new Date(Date.now() - 864e5).toISOString();
      const { data, error } = await db().from("agent_runs").select("agent_id, status, summary, started_at").gte("started_at", since).neq("trigger", "preview").neq("agent_id", ctx.agentId).order("started_at").limit(100);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r) => ({ ...r, summary: (r.summary ?? "").slice(0, 400) }));
      return { data: rows, numbers: { runs: rows.length, failed_runs: rows.filter((r) => r.status === "failed").length } };
    },
  },
  {
    id: "approvals_waiting", label: "Approvals waiting", detail: "How many approval cards are waiting for Zak and how old the oldest is",
    kind: "read", group: "supabase", params: [], trusted: true, needs: SUPABASE, costUsd: 0,
    run: async () => {
      const { data, error } = await db().from("approvals").select("created_at").eq("status", "pending").order("created_at").limit(500);
      if (error) throw new Error(error.message);
      const n = data?.length ?? 0;
      const oldest = n ? Math.round((Date.now() - Date.parse(data![0].created_at)) / 36e5) : null;
      const numbers: Record<string, number> = { approvals_waiting: n };
      if (oldest != null) numbers.oldest_approval_hours = oldest;
      return { data: { waiting: n, oldestHours: oldest }, numbers };
    },
  },
  {
    id: "wholesale_leads_recent", label: "Rowan's leads", detail: "Wholesale leads from a window: business, city, kind, fit score and stage. Found on the web, so untrusted",
    kind: "read", group: "supabase", params: [daysParam(14, 90, "How many days back.")], trusted: false, needs: SUPABASE, costUsd: 0,
    run: async ({ days }) => {
      const since = new Date(Date.now() - Number(days) * 864e5).toISOString();
      const { data, error } = await db().from("wholesale_leads").select("business, city, type, fit_score, stage, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return { data: data ?? [], numbers: { leads: data?.length ?? 0 } };
    },
  },

  // ---- Notion: only pages the spec lists, picked by id, never by URL
  {
    id: "notion_read_page", label: "Read a Notion page", detail: "The text of one of the Notion pages listed in this agent's setup, read fresh each run",
    kind: "read", group: "notion", trusted: true, needs: NOTION, costUsd: 0,
    params: [],
    paramsFor: (ctx) => [{ name: "page", type: "enum", options: ctx.notionPages.map((p) => p.id), description: `Which page. ${ctx.notionPages.map((p) => `${p.id} = ${p.label}`).join("; ")}` }],
    run: async ({ page }, ctx) => {
      const p = ctx.notionPages.find((x) => x.id === page);
      if (!p) throw new Error("That page isn't in this agent's setup.");
      const t = await notionPageText(p.id, 6000);
      return { data: { title: t.title, text: t.text, cut: t.cut } };
    },
  },
  {
    // outputs as sources (slice 3): the latest finished output of an agent picked in this agent's
    // setup. Its words are another agent's (untrusted); its numbers were copied by code from that
    // agent's tool results, so this agent may cite them in its own output in turn.
    id: "agent_output", label: "Read another agent's output", detail: "The latest finished result of an agent picked in this agent's setup: its words and the numbers code traced",
    kind: "read", group: "agents", trusted: false, needs: SUPABASE, costUsd: 0,
    params: [],
    paramsFor: (ctx) => [{ name: "agent", type: "enum", options: ctx.outputSources.map((a) => a.agentId), description: `Whose output. ${ctx.outputSources.map((a) => `${a.agentId} = ${a.label}`).join("; ")}` }],
    run: async ({ agent }, ctx) => {
      const src = ctx.outputSources.find((x) => x.agentId === agent);
      if (!src) throw new Error("That agent isn't in this agent's setup.");
      if (src.agentId === ctx.agentId) throw new Error("An agent can't read its own output this way.");
      const { data, error } = await db().from("agent_outputs").select("name, summary, numbers, created_at").eq("agent_id", src.agentId).eq("finished", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { data: { agent: src.label, output: null, note: "No finished output yet." } };
      const nums = (Array.isArray(data.numbers) ? data.numbers : []) as { label: string; value: number }[];
      const numbers: Record<string, number> = {};
      nums.forEach((n, i) => { if (Number.isFinite(n.value)) numbers[`n${i + 1}`] = n.value; });
      return {
        data: { agent: src.label, output: data.name, at: data.created_at, summary: data.summary, numbers: nums.map((n, i) => ({ key: `n${i + 1}`, label: n.label, value: n.value })) },
        numbers,
      };
    },
  },
];

export const TOOLS: Readonly<Record<string, ToolDef>> = Object.fromEntries(TOOLS_LIST.map((t) => [t.id, t]));
export const TOOL_LIST: readonly ToolDef[] = TOOLS_LIST;
