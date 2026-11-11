import "server-only";
// Chief of Staff morning brief. Everything with a number in it is worked out
// here in code; the model only reads those facts and writes the Watch list and
// one recommended focus. The brief goes to Zak by email (docs/avery-email.md), with a
// Notion page as the archive; either one alone also works.
import { G_PER_LB } from "@/domain/coffee";
import { db } from "@/core/db";
import type { RunResult } from "@/core/runs";
import { env } from "@/core/env";
import { chicagoDate, dayTitle } from "@/core/time";
import { Anthropic, MODELS, claude, costUsd, inputTokens } from "@/integrations/anthropic";
import { emailZak, hasEmail } from "@/integrations/email";
import { h2, li, notionPage, p, type Block } from "@/integrations/notion";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { getBoardOrders, greenLedger } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";
import { BY_ID } from "@/dashboard/crew";
import { briefEmail, type BriefView, type Kpi } from "./email";
import { SOP } from "./prompt";

const MODEL = MODELS.sonnet;
const COVER_WARN_DAYS = 21;

const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      watch: { type: "array", items: { type: "string" } },
      focus: { type: "object", properties: { action: { type: "string" }, reason: { type: "string" } }, required: ["action", "reason"], additionalProperties: false },
    },
    required: ["watch", "focus"],
    additionalProperties: false,
  },
};
interface Judgment { watch: string[]; focus: { action: string; reason: string } }

const usd = (n: number | null | undefined) => (n == null ? "n/a" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(Number(n) * 100)}%`);

async function facts() {
  const [lots, stock, loss] = await Promise.all([getInventoryLots(), fetchStockCoffees(), getRoastLoss()]);
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const [{ data: kpis }, { data: runs }, { data: pending }, { count: newDrafts }, orders, ledger] = await Promise.all([
    db().from("kpi_snapshots").select("*").order("date", { ascending: false }).limit(8),
    db().from("agent_runs").select("id, agent_id, status, summary, error, started_at").gte("started_at", dayAgo).order("started_at"),
    // the approvals table arrives with the gateway migration; without it this is just empty
    db().from("approvals").select("created_at").eq("status", "pending").order("created_at").limit(500),
    db().from("wholesale_leads").select("id", { count: "exact", head: true }).not("gmail_draft_id", "is", null).gte("created_at", dayAgo),
    getBoardOrders(),
    greenLedger({ stock, lots, loss }, 30),
  ]);
  const open = orders.filter((o) => o.status !== "shipped");
  const used30 = new Map<string, number>();
  for (const r of ledger) if (r.state === "deducted") for (const l of r.lots) used30.set(l.id, (used30.get(l.id) ?? 0) + l.g);
  const cover = lots.filter((l) => l.listed).map((l) => {
    const perDay = (used30.get(l.id) ?? 0) / 30, onHand = l.availG;
    return { lot: l.name, onHandLb: Math.round(onHand / G_PER_LB * 10) / 10, daysOfCover: perDay > 0 ? Math.round(onHand / perDay) : null };
  });
  return {
    today: chicagoDate(0),
    yesterday: kpis?.[0] ?? null,
    lastWeek: (kpis ?? []).slice(1),
    openOrders: {
      paid: open.filter((o) => o.status === "paid").length,
      roasting: open.filter((o) => o.status === "roasting").length,
      packing: open.filter((o) => o.status === "packing").length,
      qcHold: open.filter((o) => o.qcHold).map((o) => o.name),
    },
    lowGreen: cover.filter((c) => c.daysOfCover != null && c.daysOfCover < COVER_WARN_DAYS),
    agentRuns: runs ?? [],
    approvals: { pending: pending?.length ?? 0, oldestHours: pending?.length ? (Date.now() - Date.parse(pending[0].created_at)) / 36e5 : null },
    newDrafts: newDrafts ?? 0,
    neverDeducted: ledger.filter((r) => r.state === "missing").map((r) => r.name),
  };
}
type Facts = Awaited<ReturnType<typeof facts>>;

async function judge(f: Facts) {
  const res = await claude().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: FORMAT },
    system: SOP,
    messages: [{ role: "user", content: `Facts for ${f.today}:\n${JSON.stringify(f, null, 1)}` }],
  });
  if (res.stop_reason === "refusal") throw new Error("Brief model declined the request");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`Brief model returned no text (stop: ${res.stop_reason})`);
  return { judgment: JSON.parse(text.text) as Judgment, usage: res.usage };
}

/** The same two sections from fixed rules, for when the model can't be reached (no key, no credits, outage). */
export function rulesJudgment(f: Facts): Judgment {
  const low = [...f.lowGreen].sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const watch = [
    ...low.map((l) => `${l.lot} has about ${l.daysOfCover} days of green left (${l.onHandLb} lb).`),
    ...(f.openOrders.qcHold.length ? [`${f.openOrders.qcHold.length} order(s) on QC hold: ${f.openOrders.qcHold.join(", ")}.`] : []),
    ...(f.neverDeducted.length ? [`Green was never deducted for ${f.neverDeducted.join(", ")}.`] : []),
    ...f.agentRuns.filter((r) => r.status === "failed").map((r) => `The ${r.agent_id} run failed: ${r.error ?? "no error recorded"}.`),
  ].slice(0, 5);
  const focus = low.length
    ? { action: `Reorder ${low[0].lot}`, reason: `It runs out first, in about ${low[0].daysOfCover} days.` }
    : f.openOrders.paid
      ? { action: `Roast the ${f.openOrders.paid} paid order(s)`, reason: "They are waiting on a machine." }
      : { action: "Work the wholesale pipeline", reason: "No orders or stock need you this morning." };
  return { watch, focus };
}

export function briefBlocks(f: Facts, j: Judgment): Block[] {
  const y = f.yesterday;
  const ran = f.agentRuns.map((r) => `${r.agent_id}: ${r.status}${r.summary ? `. ${r.summary}` : ""}${r.error ? `. ${r.error}` : ""}`);
  return [
    h2("Numbers"),
    ...(y
      ? [li(`${y.date}: ${usd(y.revenue)} revenue from ${y.orders} orders, AOV ${usd(y.aov)}`), li(`Repeat rate ${pct(y.repeat_rate)}, green margin ${pct(y.green_margin)}`), li(`Cash ${usd(y.cash_usd)}`)]
      : [p("No snapshot yet. The CFO runs at 5:30 AM CT.")]),
    h2("Waiting on you"),
    li(`Orders to roast: ${f.openOrders.paid} paid, ${f.openOrders.roasting} roasting, ${f.openOrders.packing} packing`),
    ...(f.openOrders.qcHold.length ? [li(`QC hold: ${f.openOrders.qcHold.join(", ")}`)] : []),
    ...(f.neverDeducted.length ? [li(`Green never deducted: ${f.neverDeducted.join(", ")}`)] : []),
    h2("What ran"),
    ...(ran.length ? ran.map(li) : [p("No agent runs in the last 24 hours.")]),
    h2("Watch"),
    ...(j.watch.length ? j.watch.map(li) : [p("Nothing flagged.")]),
    h2("Today's focus"),
    p(`${j.focus.action}. ${j.focus.reason}`),
  ];
}

export async function runBrief(opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  const f = await facts();
  let judgment: Judgment, usage: Anthropic.Beta.BetaUsage | null = null, fallback = "";
  // a dry run never calls the model: it checks the data plumbing for free
  if (opts.dryRun) judgment = rulesJudgment(f);
  else {
    try {
      ({ judgment, usage } = await judge(f));
    } catch (e) {
      // the numbers still go out; only the two judgment sections fall back to rules
      if (!(e instanceof Anthropic.APIError) && !(e instanceof Anthropic.AnthropicError)) throw e;
      judgment = rulesJudgment(f);
      fallback = ` (model unavailable, rules used: ${e.message.slice(0, 120)})`;
    }
  }
  const view = (notionUrl?: string): BriefView => ({
    today: f.today,
    yesterday: (f.yesterday as Kpi | null) ?? null,
    earlier: f.lastWeek as Kpi[],
    openOrders: f.openOrders,
    neverDeducted: f.neverDeducted,
    runs: f.agentRuns,
    approvals: f.approvals,
    newDrafts: f.newDrafts,
    watch: judgment.watch,
    focus: judgment.focus,
    dashboardUrl: env.dashboardUrl,
    notionUrl,
    names: Object.fromEntries(Object.values(BY_ID).map((a) => [a.id, a.name])),
  });
  const email = hasEmail(), notion = !!(env.notionToken && env.notionBriefParent);
  if (opts.dryRun) {
    const { subject, html } = briefEmail(view());
    const to = email ? "would email it" : notion ? "email not set up, would post to Notion only" : "no email or Notion set up";
    return { status: "ok", summary: `[dry run, nothing sent] "${subject}" (${Math.round(html.length / 1024)} KB, ${to}). ${f.approvals.pending} approvals pending, ${f.lowGreen.length} low lots, ${f.agentRuns.length} runs in 24h.` };
  }
  if (!email && !notion) throw new Error("Nowhere to send the brief: set RESEND_API_KEY, BRIEF_FROM and BRIEF_TO for email, or NOTION_TOKEN and NOTION_BRIEF_PARENT_ID for Notion");

  // Notion first, so the email can link to its copy. A Notion failure never stops the email.
  let url: string | undefined, notionError = "";
  if (notion) {
    try { url = await notionPage(`Morning brief · ${dayTitle(f.today)}`, briefBlocks(f, judgment)); }
    catch (e) { if (!email) throw e; notionError = ` Notion page failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}.`; }
  }
  let sent = "";
  if (email) {
    const m = briefEmail(view(url));
    const id = await emailZak(m.subject, m.html, m.text);
    sent = `Brief emailed (${id}).`;
  }
  const tokensIn = usage ? inputTokens(usage) : 0;
  const tokensOut = usage?.output_tokens ?? 0;
  return {
    status: "ok",
    summary: `${sent}${url ? `${sent ? " Notion copy" : "Brief posted"}: ${url}.` : ""}${notionError} Focus: ${judgment.focus.action}${fallback}`.trim(),
    tokensIn, tokensOut,
    costUsd: costUsd(MODEL, tokensIn, tokensOut),
  };
}
