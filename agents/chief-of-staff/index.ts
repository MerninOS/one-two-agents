import "server-only";
// Avery's morning brief, as the engine's report tool report_morning_brief delivers it
// (core/tools/catalog.ts). Everything with a number in it is worked out here in code; the
// focus and watch list come from the run's finished result. The brief goes to Zak by email
// (docs/avery-email.md), with a Notion copy as the archive: a row in the Briefs database
// (docs/avery-briefs-database.md), or a page per day when that isn't set up. Either the email
// or Notion alone also works.
import { G_PER_LB } from "@/domain/coffee";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { chicagoDate, dayTitle } from "@/core/time";
import { emailZak, hasEmail } from "@/integrations/email";
import { h2, li, notionArchive, notionPage, notionRow, notionRowOn, notionSetProps, p, prop, type Block, type Props } from "@/integrations/notion";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { getBoardOrders, greenLedger } from "@/integrations/shopify/orders";
import { getRoastLoss } from "@/integrations/shopify/settings";
import { fetchStockCoffees } from "@/integrations/shopify/stock";
import { BY_ID } from "@/dashboard/crew";
import { SECTIONS, briefEmail, type BriefView, type Kpi } from "./email";

interface Judgment { watch: string[]; focus: { action: string; reason: string }; remember?: string[] }

const usd = (n: number | null | undefined) => (n == null ? "n/a" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(Number(n) * 100)}%`);

/** How far back the brief looks, and when a green lot counts as low. */
const KPI_DAYS = 8, GREEN_DAYS = 30, COVER_WARN_DAYS = 21;

/** Today's facts, every number worked out in code. */
async function facts() {
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const [{ data: kpis }, { data: runs }, { data: pending }, { count: newDrafts }, orders, green] = await Promise.all([
    db().from("kpi_snapshots").select("*").order("date", { ascending: false }).limit(KPI_DAYS),
    // a try from the builder is not a run the brief reports on
    db().from("agent_runs").select("id, agent_id, status, summary, error, started_at").gte("started_at", dayAgo).neq("trigger", "preview").order("started_at"),
    db().from("approvals").select("created_at").eq("status", "pending").order("created_at").limit(500),
    db().from("wholesale_leads").select("id", { count: "exact", head: true }).not("gmail_draft_id", "is", null).gte("created_at", dayAgo),
    getBoardOrders(),
    Promise.all([getInventoryLots(), fetchStockCoffees(), getRoastLoss()]).then(async ([lots, stock, loss]) => ({ lots, ledger: await greenLedger({ stock, lots, loss }, GREEN_DAYS) })),
  ]);
  const open = orders.filter((o) => o.status !== "shipped");
  const used = new Map<string, number>();
  for (const r of green.ledger) if (r.state === "deducted") for (const l of r.lots) used.set(l.id, (used.get(l.id) ?? 0) + l.g);
  const cover = green.lots.filter((l) => l.listed).map((l) => {
    const perDay = (used.get(l.id) ?? 0) / GREEN_DAYS, onHand = l.availG;
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
    neverDeducted: green.ledger.filter((r) => r.state === "missing").map((r) => r.name),
  };
}
type Facts = Awaited<ReturnType<typeof facts>>;

export function rulesJudgment(f: Facts): Judgment {
  const low = [...f.lowGreen].sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const watch = [
    ...low.map((l) => `${l.lot} has about ${l.daysOfCover} days of green left (${l.onHandLb} lb).`),
    ...(f.openOrders?.qcHold.length ? [`${f.openOrders.qcHold.length} order(s) on QC hold: ${f.openOrders.qcHold.join(", ")}.`] : []),
    ...(f.neverDeducted.length ? [`Green was never deducted for ${f.neverDeducted.join(", ")}.`] : []),
    ...f.agentRuns.filter((r) => r.status === "failed").map((r) => `The ${r.agent_id} run failed: ${r.error ?? "no error recorded"}.`),
  ].slice(0, 5);
  const focus = low.length
    ? { action: `Reorder ${low[0].lot}`, reason: `It runs out first, in about ${low[0].daysOfCover} days.` }
    : f.openOrders?.paid
      ? { action: `Roast the ${f.openOrders.paid} paid order(s)`, reason: "They are waiting on a machine." }
      : { action: "Work the wholesale pipeline", reason: "No orders or stock need you this morning." };
  return { watch, focus };
}

/** The Notion page body: the same sections, in the same order, as the email. */
export function briefBlocks(f: Facts, j: Judgment, sections: readonly string[] = SECTIONS): Block[] {
  const y = f.yesterday, o = f.openOrders;
  const ran = f.agentRuns.map((r) => `${r.agent_id}: ${r.status}${r.summary ? `. ${r.summary}` : ""}${r.error ? `. ${r.error}` : ""}`);
  const waiting = [
    ...(f.approvals?.pending ? [li(`Approvals waiting: ${f.approvals.pending}`)] : []),
    ...(f.newDrafts ? [li(`New wholesale drafts from Rowan: ${f.newDrafts}`)] : []),
    ...(o ? [li(`Orders to roast: ${o.paid} paid, ${o.roasting} roasting, ${o.packing} packing`)] : []),
    ...(o?.qcHold.length ? [li(`QC hold: ${o.qcHold.join(", ")}`)] : []),
    ...(f.neverDeducted.length ? [li(`Green never deducted: ${f.neverDeducted.join(", ")}`)] : []),
  ];
  const part: Record<string, () => Block[]> = {
    focus: () => [h2("Today's focus"), p(`${j.focus.action}. ${j.focus.reason}`)],
    waiting: () => [h2("Waiting on you"), ...(waiting.length ? waiting : [p("Nothing is waiting on you.")])],
    numbers: () => [h2("Numbers"), ...(y
      ? [li(`${y.date}: ${usd(y.revenue)} revenue from ${y.orders} orders, AOV ${usd(y.aov)}`), li(`Repeat rate ${pct(y.repeat_rate)}, green margin ${pct(y.green_margin)}`), li(`Cash ${usd(y.cash_usd)}`)]
      : [p("No snapshot yet. The CFO runs at 5:30 AM CT.")])],
    watch: () => [h2("Watch"), ...(j.watch.length ? j.watch.map(li) : [p("Nothing flagged.")])],
    ran: () => [h2("What ran"), ...(ran.length ? ran.map(li) : [p("No agent runs in the last 24 hours.")])],
  };
  return sections.flatMap((id) => part[id]?.() ?? []);
}

/** The day's row in the Briefs database. Every value is a fact computed above; "Focus done" is Zak's and only carried over. */
export function briefRow(f: Facts, j: Judgment, focusDone: boolean): Props {
  const y = f.yesterday;
  return {
    Name: prop.title(dayTitle(f.today)),
    Date: prop.date(f.today),
    Focus: prop.text(`${j.focus.action}. ${j.focus.reason}`.replace(/\s+/g, " ").trim()),
    "Focus done": prop.check(focusDone),
    Revenue: prop.num(y?.revenue),
    Orders: prop.num(y?.orders),
    AOV: prop.num(y?.aov),
    Cash: prop.num(y?.cash_usd),
    "Repeat rate": prop.num(y?.repeat_rate),
    "Green margin": prop.num(y?.green_margin),
    "Numbers from": prop.date(y?.date),
    "Approvals waiting": prop.num(f.approvals?.pending),
    "Failed runs": prop.num(f.agentRuns.filter((r) => r.status === "failed").length),
    Emailed: prop.check(false),
  };
}

/**
 * Writes today's row. A second run on the same day replaces the first row (the old one goes
 * to Notion's trash) and keeps Zak's "Focus done" tick, so there is one row per day.
 */
async function writeBriefRow(databaseId: string, f: Facts, j: Judgment, sections: readonly string[]) {
  const old = await notionRowOn(databaseId, "Date", f.today);
  const row = await notionRow(databaseId, briefRow(f, j, old?.properties["Focus done"]?.checkbox ?? false), briefBlocks(f, j, sections));
  let note = "";
  if (old) {
    try { await notionArchive(old.id); }
    catch (e) { note = ` The earlier row for today could not be removed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}.`; }
  }
  return { id: row.id, url: row.url, note };
}

/** What the email is built from. Every value is a fact computed above, plus the model's two sections. */
const briefView = (f: Facts, j: Judgment, sections: readonly string[], notionUrl?: string): BriefView => ({
  today: f.today,
  yesterday: (f.yesterday as Kpi | null) ?? null,
  earlier: f.lastWeek as Kpi[],
  openOrders: f.openOrders,
  neverDeducted: f.neverDeducted,
  runs: f.agentRuns,
  approvals: f.approvals,
  newDrafts: f.newDrafts,
  watch: j.watch,
  focus: j.focus,
  dashboardUrl: env.dashboardUrl,
  notionUrl,
  names: Object.fromEntries(Object.values(BY_ID).map((a) => [a.id, a.name])),
  sections,
});

/**
 * Where the brief goes. Email only to BRIEF_TO (integrations/email.ts has no recipient). The
 * Notion copy goes to NOTION_BRIEFS_DB_ID, else a page under NOTION_BRIEF_PARENT_ID.
 */
function destinations(): { email: boolean; notion: { kind: "database" | "page"; id: string } | null } {
  const email = hasEmail();
  if (!env.notionToken) return { email, notion: null };
  if (env.notionBriefsDb) return { email, notion: { kind: "database", id: env.notionBriefsDb } };
  if (env.notionBriefParent) return { email, notion: { kind: "page", id: env.notionBriefParent } };
  return { email, notion: null };
}

/** Writes the Notion copy, then emails the brief. Returns one line on what went where. */
async function sendBrief(f: Facts, judgment: Judgment, sections: readonly string[] = SECTIONS): Promise<string> {
  const view = (notionUrl?: string) => briefView(f, judgment, sections, notionUrl);
  const { email, notion: target } = destinations();
  if (!email && !target) throw new Error("Nowhere to send the brief: email needs RESEND_API_KEY, BRIEF_FROM and BRIEF_TO; Notion needs NOTION_TOKEN and NOTION_BRIEFS_DB_ID or NOTION_BRIEF_PARENT_ID");

  // Notion first, so the email can link to its copy. A Notion failure never stops the email.
  let url: string | undefined, rowId: string | undefined, notionError = "";
  if (target) {
    try {
      if (target.kind === "database") {
        const row = await writeBriefRow(target.id, f, judgment, sections);
        url = row.url; rowId = row.id; notionError = row.note;
      } else url = await notionPage(`Morning brief · ${dayTitle(f.today)}`, briefBlocks(f, judgment, sections), target.id);
    } catch (e) { if (!email) throw e; notionError = ` Notion ${target.kind === "database" ? "row" : "page"} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}.`; }
  }
  let sent = "";
  if (email) {
    const m = briefEmail(view(url));
    const id = await emailZak(m.subject, m.html, m.text);
    sent = `Brief emailed (${id}).`;
    // the row is written before the send, so it is only marked once the email has gone
    if (rowId) await notionSetProps(rowId, { Emailed: prop.check(true) }).catch(() => { notionError += " The row's Emailed box could not be ticked."; });
  }
  return `${sent}${url ? `${sent ? " Notion copy" : "Brief posted"}: ${url}.` : ""}${notionError}`.trim();
}

/**
 * Avery's focus and watch list from a run's result: a line
 * starting "Focus:" and up to five lines starting "- ". Null when there is no Focus line.
 */
export function parseJudgment(text: string): Judgment | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const f = lines.find((l) => /^focus\s*:/i.test(l));
  if (!f) return null;
  const body = f.replace(/^focus\s*:\s*/i, "");
  const cut = body.search(/\.\s/);
  const focus = cut > 0 ? { action: body.slice(0, cut), reason: body.slice(cut + 1).trim() } : { action: body.replace(/\.$/, ""), reason: "" };
  const watch = lines.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, "").slice(0, 300)).slice(0, 5);
  return focus.action ? { watch, focus } : null;
}

/**
 * The report tool report_morning_brief: the email and Briefs row, with every number worked out
 * here in code from today's facts, and the focus and watch list taken from the run's finished
 * result. When the result has no Focus line, the
 * fixed rules write both, as they do when no model can be reached.
 */
export async function deliverBrief(result: string): Promise<string> {
  const f = await facts();
  const parsed = parseJudgment(result);
  const judgment = parsed ?? rulesJudgment(f);
  const sent = await sendBrief(f, judgment);
  return `${sent}${parsed ? "" : " (no Focus line in the result, so the fixed rules wrote the focus and watch list)"}`;
}
