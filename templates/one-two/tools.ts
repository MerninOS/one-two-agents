import "server-only";
// One Two Coffee Lab's own tools (docs/templates.md): coffee math, Morgan's daily numbers and
// Avery's brief. Registered with the tool list through
// templates/index.ts; the same rules hold as for every tool in core/tools/catalog.ts (Read and
// Calculate write nothing, numbers are worked out in code, reports reach only the owner or our own
// stores after a finished run).
import { db } from "@/core/db";
import { round2 } from "@/core/num";
import { chicagoDate } from "@/core/time";
import { EMAIL, MERCURY, SHOPIFY, SUPABASE, daysParam, usd } from "@/core/tools/shared";
import type { ToolDef } from "@/core/tools/types";
import { getInventoryLots } from "@/templates/one-two/shopify/lots";
import { getBoardOrders } from "@/templates/one-two/shopify/orders";
import { snapshot } from "./agents/cfo";
import { deliverBrief } from "./agents/chief-of-staff";
import { cover, greenUse, lb } from "./green";

export const ONE_TWO_TOOLS: ToolDef[] = [
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
    id: "report_kpi_snapshot", label: "Save yesterday's numbers", detail: "Works out yesterday's daily numbers again in code (Morgan's math) and saves them to kpi_snapshots, which Avery's brief reads. Never uses the model's words",
    kind: "report", group: "supabase", params: [], trusted: true, needs: [...SHOPIFY, ...SUPABASE], costUsd: 0, codeOnly: true,
    deliver: async () => {
      const s = await snapshot(chicagoDate(1));
      return `saved ${s.date}: ${s.orders} orders, ${usd(s.revenue)} revenue`;
    },
  },
  {
    id: "report_morning_brief", label: "Send the morning brief", detail: "Avery's brief email and Briefs row: the Focus line and watch lines from the result, every number worked out again in code from today's facts. Only to the owner email and the Briefs target on Settings",
    kind: "report", group: "email", params: [], trusted: true, needs: EMAIL, costUsd: 0,
    deliver: async (o, ctx) => deliverBrief(o.summary, ctx.runId ?? null),
  },
];
