import "server-only";
// One Two Coffee Lab's own tools (docs/templates.md): open orders, Morgan's daily numbers and
// Avery's brief. Registered with the tool list through
// templates/index.ts; the same rules hold as for every tool in core/tools/catalog.ts (Read and
// Calculate write nothing, numbers are worked out in code, reports reach only the owner or our own
// stores after a finished run).
import { db } from "@/core/db";
import { chicagoDate } from "@/core/time";
import { EMAIL, MERCURY, SHOPIFY, SUPABASE, daysParam, usd } from "@/core/tools/shared";
import type { ToolDef } from "@/core/tools/types";
import { getBoardOrders } from "@/templates/one-two/shopify/orders";
import { snapshot } from "./agents/cfo";
import { deliverBrief } from "./agents/chief-of-staff";

export const ONE_TWO_TOOLS: ToolDef[] = [
  // ---- Shopify (read-only app "One Two Agents (read)")
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
