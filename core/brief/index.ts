import "server-only";
// The morning brief for any business (docs/morning-brief.md), as the report tool report_morning_brief
// delivers it (core/tools/catalog.ts). Everything with a number in it is worked out here in code; the
// focus and watch list come from the run's finished result. The brief goes to the owner email on
// Settings (integrations/email.ts has no recipient argument), with a Notion copy as the archive: a row
// in the Briefs database (docs/briefs-database.md), or a page per day when that isn't set up. Either the
// email or Notion alone also works.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { settings } from "@/core/settings";
import { chicagoDate, dayTitle } from "@/core/time";
import { emailOwner, hasEmail } from "@/integrations/email";
import { h2, li, notionArchive, notionPage, notionRow, notionConnected, notionRowOn, notionUpdateRow, p, prop, type Block, type Props } from "@/integrations/notion";
import { openOrders } from "@/integrations/shopify/orders";
import { agentNames, agentsIn, companySeat, loadOrg, seatOf } from "@/core/org";
import { goalsNow, listGoals, type GoalNow } from "@/core/goals";
import { STATUS_WORDS } from "@/core/goal-rules";
import { numberText } from "@/core/goal-number-rules";
import { ownNumberSources, readOwnNumber } from "@/core/tools/custom";
import { SECTIONS, briefEmail, deptLine, openLine, rateLine, NO_SNAPSHOT, type BriefDept, type BriefView, type Kpi } from "./email";
import { openCounts, parseJudgment, rulesJudgment, type GoalBehind, type Judgment } from "./rules";

const usd = (n: number | null | undefined) => (n == null ? "n/a" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

/** How far back the brief looks: daily numbers, and open orders. */
const KPI_DAYS = 8, OPEN_ORDER_DAYS = 90;

const NO_DEPT = "Not in a department";

/**
 * Each department on the org chart (docs/org-chart.md): its goals' status and the last day's runs, all
 * counted in code, then the agents not in a department. The company seat's own runs are left out.
 * Empty when the org chart isn't there.
 */
async function departmentRuns(runs: { agent_id: string; status: string; cost_usd: number | string | null }[], goals: GoalNow[]): Promise<{ departments: BriefDept[]; chief: string | null }> {
  const o = await loadOrg().catch(() => null);
  if (!o) return { departments: [], chief: null };
  const top = companySeat(o)?.agentId;
  const goalLines = (deptId: string) => goals.filter((x) => x.goal.department_id === deptId)
    .map(({ goal, progress }) => `${goal.title}: ${progress.line}, ${STATUS_WORDS[progress.status].toLowerCase()}`);
  const tally = (ids: (id: string) => boolean, name: string, deptGoals: string[]): BriefDept => {
    const mine = runs.filter((r) => r.agent_id !== top && ids(r.agent_id));
    return { name, goals: deptGoals, runs: mine.length, failed: mine.filter((r) => r.status === "failed").length, costUsd: mine.reduce((s, r) => s + Math.round(Number(r.cost_usd ?? 0) * 100), 0) / 100 };
  };
  const out = o.departments.map((d) => { const ids = new Set(agentsIn(o, d.id)); return tally((id) => ids.has(id), d.name, goalLines(d.id)); });
  const loose = tally((id) => !seatOf(o, id), NO_DEPT, []);
  const chief = top ? (await agentNames([top]).catch(() => ({} as Record<string, string>)))[top] ?? null : null;
  return { departments: loose.runs ? [...out, loose] : out, chief };
}

/** The business's own numbers marked "Show in the morning brief", read in code after the tool check. */
async function ownNumberLines(): Promise<string[]> {
  const sources = (await ownNumberSources().catch(() => [])).filter((s) => s.number.brief).slice(0, 8);
  return Promise.all(sources.map(async (s) => {
    const r = await readOwnNumber(s).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return "value" in r ? numberText(s.number, r.value) : `${s.number.label}: couldn't read (${String("error" in r ? r.error : "no number").slice(0, 120)})`;
  }));
}

/** Today's facts, every number worked out in code. */
async function facts() {
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const since = chicagoDate(OPEN_ORDER_DAYS);
  const [{ data: kpis }, { data: runs }, { data: pending }, { count: newDrafts }, orders, goals, ownNumbers] = await Promise.all([
    db().from("kpi_snapshots").select("*").order("date", { ascending: false }).limit(KPI_DAYS),
    // a try from the builder is not a run the brief reports on
    db().from("agent_runs").select("id, agent_id, status, summary, error, started_at, cost_usd").gte("started_at", dayAgo).not("trigger", "in", "(preview,chat)").order("started_at"),
    db().from("approvals").select("created_at").eq("status", "pending").order("created_at").limit(500),
    db().from("wholesale_leads").select("id", { count: "exact", head: true }).not("gmail_draft_id", "is", null).gte("created_at", dayAgo),
    // Shopify not connected, or not readable: the brief leaves open orders out
    openOrders(since).then(openCounts, () => null),
    listGoals().then((g) => (g ? goalsNow(g) : [])).catch(() => [] as GoalNow[]),
    ownNumberLines(),
  ]);
  const { departments, chief } = await departmentRuns(runs ?? [], goals);
  const behind: GoalBehind[] = goals.filter((g) => g.progress.status === "behind" || g.progress.status === "missed")
    .map((g) => ({ title: g.goal.title, line: g.progress.line, status: g.progress.status as GoalBehind["status"] }));
  return {
    today: chicagoDate(0),
    yesterday: (kpis?.[0] as Kpi | undefined) ?? null,
    lastWeek: (kpis ?? []).slice(1) as Kpi[],
    openOrders: orders,
    ownNumbers,
    behind,
    agentRuns: runs ?? [],
    departments,
    chief,
    approvals: { pending: pending?.length ?? 0, oldestHours: pending?.length ? (Date.now() - Date.parse(pending[0].created_at)) / 36e5 : null },
    newDrafts: newDrafts ?? 0,
    // each agent's name from its live version, whether it started in code or the app
    names: await agentNames([...new Set((runs ?? []).map((r) => r.agent_id as string))]).catch(() => ({} as Record<string, string>)),
  };
}
type Facts = Awaited<ReturnType<typeof facts>>;

/** The Notion page body: the same sections, in the same order, as the email. */
export function briefBlocks(f: Facts, j: Judgment, sections: readonly string[] = SECTIONS): Block[] {
  const y = f.yesterday, o = f.openOrders;
  const depts = f.departments;
  const ol = openLine(o);
  const waiting = [
    ...(f.approvals?.pending ? [li(`Approvals waiting: ${f.approvals.pending}`)] : []),
    ...(f.newDrafts ? [li(`New lead drafts in Gmail: ${f.newDrafts}`)] : []),
    ...(ol ? [li(ol)] : []),
    ...(o?.onHold.length ? [li(`On hold: ${o.onHold.join(", ")}`)] : []),
  ];
  const part: Record<string, () => Block[]> = {
    focus: () => [h2("Today's focus"), p(`${j.focus.action}. ${j.focus.reason}`)],
    waiting: () => [h2("Waiting on you"), ...(waiting.length ? waiting : [p("Nothing is waiting on you.")])],
    numbers: () => [h2("Numbers"), ...(y
      ? [li(`${y.date}: ${usd(Number(y.revenue))} revenue from ${y.orders} orders, AOV ${usd(y.aov == null ? null : Number(y.aov))}`), li(rateLine(y)), li(`Cash ${usd(y.cash_usd == null ? null : Number(y.cash_usd))}`)]
      : [p(NO_SNAPSHOT)]), ...f.ownNumbers.map((t) => li(t))],
    watch: () => [h2("Watch"), ...(j.watch.length ? j.watch.map(li) : [p("Nothing flagged.")])],
    departments: () => [h2("Departments"), ...(depts.length ? depts.map((d) => li(deptLine(d))) : [p("No departments on the org chart yet.")])],
  };
  return sections.flatMap((id) => part[id]?.() ?? []);
}

/** The day's row in the Briefs database. Every value is a fact computed above; "Focus done" is the owner's and only carried over. */
export function briefRow(f: Facts, j: Judgment, focusDone: boolean): Props {
  const y = f.yesterday;
  const n = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
  return {
    Name: prop.title(dayTitle(f.today)),
    Date: prop.date(f.today),
    Focus: prop.text(`${j.focus.action}. ${j.focus.reason}`.replace(/\s+/g, " ").trim()),
    "Focus done": prop.check(focusDone),
    Revenue: prop.num(n(y?.revenue)),
    Orders: prop.num(y?.orders),
    AOV: prop.num(n(y?.aov)),
    Cash: prop.num(n(y?.cash_usd)),
    "Repeat rate": prop.num(n(y?.repeat_rate)),
    Margin: prop.num(n(y?.margin)),
    "Numbers from": prop.date(y?.date),
    "Approvals waiting": prop.num(f.approvals?.pending),
    "Failed runs": prop.num(f.agentRuns.filter((r) => r.status === "failed").length),
    Emailed: prop.check(false),
  };
}

/**
 * Writes today's row. A second run on the same day replaces the first row (the old one goes
 * to Notion's trash) and keeps the owner's "Focus done" tick, so there is one row per day.
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
const briefView = (f: Facts, j: Judgment, sections: readonly string[], notionUrl?: string, runId?: string | null): BriefView => ({
  today: f.today,
  yesterday: f.yesterday,
  earlier: f.lastWeek,
  openOrders: f.openOrders,
  ownNumbers: f.ownNumbers,
  runs: f.agentRuns,
  departments: f.departments,
  approvals: f.approvals,
  newDrafts: f.newDrafts,
  watch: j.watch,
  focus: j.focus,
  dashboardUrl: env.dashboardUrl,
  runId: runId ?? undefined,
  notionUrl,
  names: f.names,
  chief: f.chief ?? undefined,
  sections,
});

/**
 * Where the brief goes. Email only to the owner email (integrations/email.ts has no recipient). The
 * Notion copy goes to the briefs database, else a page under the briefs page (Settings).
 */
async function destinations(): Promise<{ email: boolean; notion: { kind: "database" | "page"; id: string } | null }> {
  const email = await hasEmail();
  if (!(await notionConnected())) return { email, notion: null };
  const s = await settings();
  if (s.notionBriefsDb) return { email, notion: { kind: "database", id: s.notionBriefsDb } };
  if (s.notionBriefParent) return { email, notion: { kind: "page", id: s.notionBriefParent } };
  return { email, notion: null };
}

/** Writes the Notion copy, then emails the brief. Returns one line on what went where. */
async function sendBrief(f: Facts, judgment: Judgment, sections: readonly string[] = SECTIONS, runId: string | null = null): Promise<string> {
  const view = (notionUrl?: string) => briefView(f, judgment, sections, notionUrl, runId);
  const { email, notion: target } = await destinations();
  if (!email && !target) throw new Error("Nowhere to send the brief: email needs RESEND_API_KEY, BRIEF_FROM and an owner email on Settings; Notion needs its key pasted on Connections and a briefs database or page on Settings");

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
    const id = await emailOwner(m.subject, m.html, m.text);
    sent = `Brief emailed (${id}).`;
    // the row is written before the send, so it is only marked once the email has gone
    if (rowId) await notionUpdateRow(rowId, { Emailed: prop.check(true) }).catch(() => { notionError += " The row's Emailed box could not be ticked."; });
  }
  return `${sent}${url ? `${sent ? " Notion copy" : "Brief posted"}: ${url}.` : ""}${notionError}`.trim();
}

/**
 * The report tool report_morning_brief: the email and Briefs row, with every number worked out
 * here in code from today's facts, and the focus and watch list taken from the run's finished
 * result. When the result has no Focus line, the fixed rules write both, as they do when no model
 * can be reached.
 */
export async function deliverBrief(result: string, runId: string | null = null): Promise<string> {
  const f = await facts();
  const parsed = parseJudgment(result);
  const judgment = parsed ?? rulesJudgment(f);
  const sent = await sendBrief(f, judgment, SECTIONS, runId);
  return `${sent}${parsed ? "" : " (no Focus line in the result, so the fixed rules wrote the focus and watch list)"}`;
}
