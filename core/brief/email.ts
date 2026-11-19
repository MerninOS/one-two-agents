// The morning brief as an email (docs/morning-brief.md): subject, HTML and plain text from facts that
// are already computed. Pure (no I/O, no secrets) so check:brief can render and check it on its own.
// Everything that came from a model or another agent's summary is escaped.

export interface Kpi { date: string; revenue: number | string; orders: number; aov: number | string | null; repeat_rate: number | string | null; margin: number | string | null; cash_usd: number | string | null }
export interface BriefRun { id: string; agent_id: string; status: string; summary: string | null; error: string | null }
/** One department on the org chart (docs/org-chart.md): its goals and run counts, all worked out in code. */
/** goals: each goal's status, counted in code ("Land 5 accounts: 1 of 5 won, behind"). */
export interface BriefDept { name: string; goals: string[]; runs: number; failed: number; costUsd: number }
export interface BriefView {
  /** Chicago date the brief is for, "2026-11-12" */
  today: string;
  yesterday: Kpi | null;
  /** Earlier snapshots, newest first */
  earlier: Kpi[];
  /** Open orders by Shopify's fulfillment status; null when Shopify isn't connected or couldn't be read. */
  openOrders: OpenCounts | null;
  /** The business's own numbers marked "Show in the morning brief", as lines ("Open tickets: 4"). */
  ownNumbers: string[];
  runs: BriefRun[];
  /** One line per department, then the agents not in one ("Not in a department"). Empty before the org chart exists. */
  departments: BriefDept[];
  /** Null when the Approvals source is turned off. */
  approvals: { pending: number; oldestHours: number | null } | null;
  /** Lead email drafts put in Gmail in the last 24 hours */
  newDrafts: number;
  watch: string[];
  focus: { action: string; reason: string };
  /** Control Room base URL without a trailing slash, when known */
  dashboardUrl?: string;
  /** The run that wrote this brief, so "Not right?" opens Good / Not this on it */
  runId?: string;
  /** The Notion archive page, when one was written */
  notionUrl?: string;
  /** Persona names by agent id, for failed runs */
  names?: Record<string, string>;
  /** The company seat's agent name ("Not right? Tell …"); "your Chief of Staff" when unknown. */
  chief?: string;
  /** Sections to include, in order Default: all, in the built-in order (SECTIONS). */
  sections?: readonly string[];
}

/** Open orders by Shopify's own fulfillment status (docs/morning-brief.md). onHold lists order numbers. */
export interface OpenCounts { unfulfilled: number; partial: number; onHold: string[] }

/** The built-in section order; the setup may reorder or drop any but the focus. */
export const SECTIONS = ["focus", "waiting", "numbers", "watch", "departments"] as const;
export interface Change { text: string; dir: "up" | "down" | "flat" }

const num = (n: number | string | null | undefined) => (n == null || n === "" || !Number.isFinite(Number(n)) ? null : Number(n));
export const usd = (n: number | string | null | undefined) => (num(n) == null ? "n/a" : `$${Math.round(num(n)!).toLocaleString("en-US")}`);
const pct = (n: number | string | null | undefined) => (num(n) == null ? "n/a" : `${Math.round(num(n)! * 100)}%`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const weekday = (date: string, style: "short" | "long" = "short") =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/** Yesterday's revenue against the mean of up to 7 earlier snapshots. Null with fewer than 3 to compare. */
export function revenueChange(y: Kpi | null, earlier: Kpi[]): Change | null {
  const prev = earlier.slice(0, 7).map((k) => num(k.revenue)).filter((n): n is number => n != null);
  const now = num(y?.revenue);
  if (now == null || prev.length < 3) return null;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (avg <= 0) return now > 0 ? { text: `${prev.length}-day average was $0`, dir: "up" } : null;
  const d = Math.round(((now - avg) / avg) * 100);
  return { text: `${d > 0 ? "+" : ""}${d}% vs ${prev.length}-day average`, dir: d > 0 ? "up" : d < 0 ? "down" : "flat" };
}
/** Cash against the oldest snapshot within the last 7, in dollars. */
export function cashChange(y: Kpi | null, earlier: Kpi[]): Change | null {
  const now = num(y?.cash_usd);
  const past = earlier.slice(0, 7).filter((k) => num(k.cash_usd) != null).at(-1);
  if (now == null || !past) return null;
  const d = Math.round(now - num(past.cash_usd)!);
  const day = new Date(`${past.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { text: `${d > 0 ? "+" : d < 0 ? "-" : ""}$${Math.abs(d).toLocaleString("en-US")} since ${day}`, dir: d > 0 ? "up" : d < 0 ? "down" : "flat" };
}

const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** True when the newest snapshot is for the day before the brief; false when the daily numbers haven't run and it is older. */
const isYesterday = (v: BriefView) => !!v.yesterday && Date.parse(`${v.today}T12:00:00Z`) - Date.parse(`${v.yesterday.date}T12:00:00Z`) === 864e5;

interface Item { text: string; href?: string }

function waiting(v: BriefView): Item[] {
  const out: Item[] = [];
  const base = v.dashboardUrl;
  if (v.approvals?.pending) {
    const h = v.approvals.oldestHours;
    const age = h == null ? "" : h < 1 ? ", oldest under an hour" : h < 48 ? `, oldest ${plural(Math.round(h), "hour")}` : `, oldest ${plural(Math.round(h / 24), "day")}`;
    out.push({ text: `${plural(v.approvals.pending, "approval")} waiting for your OK${age}`, href: base && `${base}/approvals` });
  }
  if (v.newDrafts) out.push({ text: `${plural(v.newDrafts, "new lead draft")} in Gmail to review`, href: "https://mail.google.com/mail/#drafts" });
  for (const r of v.runs.filter((r) => r.status === "failed")) {
    out.push({ text: `${v.names?.[r.agent_id] ?? r.agent_id}'s run failed: ${oneLine(r.error ?? r.summary ?? "no error recorded").slice(0, 160)}`, href: base && `${base}/runs/${r.id}` });
  }
  const o = v.openOrders;
  const ol = openLine(o);
  if (ol) out.push({ text: ol });
  if (o?.onHold.length) out.push({ text: `On hold: ${o.onHold.join(", ")}` });
  return out;
}

/** "Open orders: 3 to ship, 1 partly shipped", or null when there are none. */
export function openLine(o: OpenCounts | null): string | null {
  if (!o || !(o.unfulfilled || o.partial)) return null;
  return `Open orders: ${o.unfulfilled} to ship${o.partial ? `, ${o.partial} partly shipped` : ""}`;
}
/** "Repeat rate 30%, margin 61%": margin only when cost of goods was worked out. */
export const rateLine = (y: Kpi, sep = ", ") => `Repeat rate ${pct(y.repeat_rate)}${num(y.margin) == null ? "" : `${sep}margin ${pct(y.margin)}`}`;

/** "Finance: Runway above 12 months: 14.3 months, at least 12 months, on track. 3 runs, all OK, $0.12, in the last 24 hours." Every part is code's: goal status and run counts. */
export function deptLine(d: BriefDept) {
  const runs = !d.runs ? "No runs" : `${plural(d.runs, "run")}, ${d.failed ? `${d.failed} failed` : "all OK"}, $${d.costUsd.toFixed(2)},`;
  const goals = d.goals.length ? `${d.goals.map((g) => oneLine(g).replace(/[.\s]*$/, "")).join("; ")}. ` : "No goal set. ";
  return `${d.name}: ${goals}${runs} in the last 24 hours.`;
}
const NO_DEPTS = "No departments on the org chart yet.";
export const NO_SNAPSHOT = "No daily numbers yet. They're worked out each morning once an agent has Save yesterday's numbers.";

/** Where "Not right? Tell …" goes: Good / Not this on the run that wrote the brief (docs/company-mode.md). */
export const replyUrl = (v: Pick<BriefView, "dashboardUrl" | "runId">) => (v.dashboardUrl && v.runId ? `${v.dashboardUrl}/runs/${v.runId}#react` : undefined);

export function briefSubject(v: BriefView) {
  const action = oneLine(v.focus.action).slice(0, 80);
  const rev = v.yesterday ? ` · ${usd(v.yesterday.revenue)} ${isYesterday(v) ? "yesterday" : `on ${shortDay(v.yesterday.date)}`}` : "";
  return `${weekday(v.today)}: ${action}${rev}`;
}

const C = { ink: "#1B1B1F", ink2: "#55555E", mut: "#8A8A93", line: "#ECECEF", soft: "#F6F5F2", acc: "#F2884B", up: "#1F8A5B", down: "#C2452D", bg: "#FFFFFF" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const label = (t: string) => `<p style="margin:28px 0 10px;font:600 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.mut}">${esc(t)}</p>`;
const link = (i: Item) => (i.href ? `<a href="${esc(i.href)}" style="color:${C.ink};text-decoration:underline;text-decoration-color:${C.acc};text-underline-offset:3px">${esc(i.text)}</a>` : esc(i.text));
const rows = (items: Item[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${items.map((i) =>
    `<tr><td width="18" valign="top" style="padding:5px 0;font:15px/22px ${FONT};color:${C.acc}">&bull;</td><td style="padding:5px 0;font:15px/22px ${FONT};color:${C.ink}">${link(i)}</td></tr>`).join("")}</table>`;
const stat = (name: string, value: string, sub: string, change: Change | null) =>
  `<td width="33%" valign="top" style="padding:14px 12px;background:${C.soft};border-radius:12px">` +
  `<div style="font:600 11px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.mut}">${esc(name)}</div>` +
  `<div style="margin-top:8px;font:700 22px/26px ${FONT};color:${C.ink}">${esc(value)}</div>` +
  `<div style="margin-top:4px;font:12px/16px ${FONT};color:${change ? (change.dir === "up" ? C.up : change.dir === "down" ? C.down : C.ink2) : C.ink2}">${esc(change?.text ?? sub)}</div></td>`;

export function briefEmail(v: BriefView): { subject: string; html: string; text: string } {
  const y = v.yesterday;
  const todo = waiting(v);
  const rev = revenueChange(y, v.earlier), cash = cashChange(y, v.earlier);
  const failed = v.runs.filter((r) => r.status === "failed");
  const subject = briefSubject(v);
  const action = oneLine(v.focus.action), reason = oneLine(v.focus.reason);
  const order = (v.sections ?? SECTIONS).filter((id) => (SECTIONS as readonly string[]).includes(id));
  const reply = replyUrl(v);
  const chief = oneLine(v.chief ?? "").slice(0, 40) || "your Chief of Staff";
  const tell = reply ? `<p style="margin:8px 0 0;font:13px/18px ${FONT}"><a href="${esc(reply)}" style="color:${C.ink2}">Not right? Tell ${esc(chief)}</a></p>` : "";

  const html: Record<string, () => string> = {
    focus: () => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px"><tr><td style="padding:20px;border:1px solid ${C.line};border-left:4px solid ${C.acc};border-radius:14px">` +
      `<div style="font:600 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.acc}">Today's focus</div>` +
      `<div style="margin-top:10px;font:700 21px/27px ${FONT};color:${C.ink}">${esc(action)}</div>` +
      `<div style="margin-top:6px;font:15px/22px ${FONT};color:${C.ink2}">${esc(reason)}</div>` +
      (v.dashboardUrl ? `<div style="margin-top:16px"><a href="${esc(v.dashboardUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:${C.ink};color:#FFFFFF;font:600 14px/18px ${FONT};text-decoration:none">Open the Control Room</a></div>` : "") +
      `</td></tr></table>` + tell,
    waiting: () => label("Waiting on you") +
      (todo.length ? rows(todo) : `<p style="margin:0;font:15px/22px ${FONT};color:${C.ink2}">Nothing is waiting on you.</p>`),
    numbers: () => label(y ? `Numbers · ${isYesterday(v) ? weekday(y.date, "long") : `${shortDay(y.date)}, the latest snapshot`}` : "Numbers") +
      (y
        ? `<table role="presentation" cellpadding="0" cellspacing="6" width="100%"><tr>` +
          stat("Revenue", usd(y.revenue), "no earlier days to compare", rev) +
          stat("Orders", String(y.orders), y.orders ? `AOV ${usd(y.aov)}` : "no orders", null) +
          stat("Cash", usd(y.cash_usd), num(y.cash_usd) == null ? "Mercury not connected" : "no earlier balance", cash) +
          `</tr></table>` +
          `<p style="margin:10px 0 0;font:13px/18px ${FONT};color:${C.ink2}">${esc(rateLine(y, " · "))}</p>`
        : `<p style="margin:0;font:15px/22px ${FONT};color:${C.ink2}">${NO_SNAPSHOT}</p>`) +
      (v.ownNumbers.length ? rows(v.ownNumbers.map((t) => ({ text: oneLine(t) }))) : ""),
    watch: () => label("Watch") +
      (v.watch.length ? rows(v.watch.slice(0, 5).map((t) => ({ text: oneLine(t) }))) : `<p style="margin:0;font:15px/22px ${FONT};color:${C.ink2}">Nothing flagged.</p>`) + tell,
    departments: () => label("Departments") +
      (v.departments.length ? rows(v.departments.map((d) => ({ text: deptLine(d) }))) : `<p style="margin:0;font:15px/22px ${FONT};color:${C.ink2}">${NO_DEPTS}</p>`) +
      (v.dashboardUrl && v.runs.length ? `<p style="margin:8px 0 0;font:13px/18px ${FONT}"><a href="${esc(v.dashboardUrl)}/runs" style="color:${C.ink2}">See the runs</a></p>` : ""),
  };
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg}">` +
    `<div style="display:none;max-height:0;overflow:hidden">${esc(reason)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:24px 16px 40px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px"><tr><td>` +
    `<p style="margin:0;font:13px/18px ${FONT};color:${C.mut}">Morning brief &middot; ${esc(longDay(v.today))}</p>` +
    order.map((id) => html[id]()).join("") +
    // footer
    `<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${C.line};font:12px/18px ${FONT};color:${C.mut}">Sent by ${esc(chief === "your Chief of Staff" ? "your Chief of Staff agent" : `${chief}, your Chief of Staff agent`)}, to this one fixed address. Numbers are computed in code; goal status is counted in code too; the focus and watch list are written by the model from those numbers.` +
    (v.notionUrl ? ` <a href="${esc(v.notionUrl)}" style="color:${C.mut}">Notion copy</a>.` : "") +
    `</p></td></tr></table></td></tr></table></body></html>`;

  const text: Record<string, () => string[]> = {
    focus: () => ["TODAY'S FOCUS", `${action}. ${reason}`, ...(v.dashboardUrl ? [`Control Room: ${v.dashboardUrl}`] : []), ...(reply ? [`Not right? Tell ${chief}: ${reply}`] : [])],
    waiting: () => ["WAITING ON YOU", ...(todo.length ? todo.map((i) => `- ${i.text}${i.href ? ` (${i.href})` : ""}`) : ["Nothing is waiting on you."])],
    numbers: () => [
      y && !isYesterday(v) ? `NUMBERS (${shortDay(y.date)}, the latest snapshot)` : "NUMBERS",
      ...(y
        ? [`Revenue ${usd(y.revenue)}${rev ? ` (${rev.text})` : ""}`, `Orders ${y.orders}${y.orders ? `, AOV ${usd(y.aov)}` : ""}`, `Cash ${usd(y.cash_usd)}${cash ? ` (${cash.text})` : ""}`, rateLine(y)]
        : [NO_SNAPSHOT]),
      ...v.ownNumbers.map(oneLine),
    ],
    watch: () => ["WATCH", ...(v.watch.length ? v.watch.slice(0, 5).map((w) => `- ${oneLine(w)}`) : ["Nothing flagged."])],
    departments: () => ["DEPARTMENTS", ...(v.departments.length ? v.departments.map((d) => `- ${deptLine(d)}`) : [NO_DEPTS]), ...failed.map((r) => `- ${v.names?.[r.agent_id] ?? r.agent_id} failed: ${oneLine(r.error ?? "no error recorded").slice(0, 160)}`)],
  };
  const t: string[] = [
    `Morning brief · ${longDay(v.today)}`,
    ...order.flatMap((id) => ["", ...text[id]()]),
    ...(v.notionUrl ? ["", `Notion copy: ${v.notionUrl}`] : []),
  ];
  return { subject, html: page, text: t.join("\n") };
}
