// Status and alerts (docs/usage.md, slice 4): what is wrong right now, worked out in code with no
// database, so `npm run check:status` can test it. core/status.ts gathers the facts; this decides
// which are problems, which of those email the owner, and when.

export interface StatusFacts {
  /** jobs that failed in the last day */
  deadJobs: { count: number; latest: { outcome: string | null; at: string } | null };
  /** jobs waiting to start, and the oldest due time among those past it */
  waitingJobs: number;
  overdueJobs: { count: number; oldestDue: string | null };
  /** connections paused until someone signs in again or accepts a change */
  paused: { id: string; name: string; why: string | null; custom: boolean }[];
  /** gateway proposals refused in the last day (over a cap, an unknown payee, a suppressed address ...) */
  refused: { count: number; latest: string | null };
  /** runs that failed in the last day, by agent */
  failedRuns: { count: number; agents: string[] };
  /** facts that couldn't be read (a table not migrated yet) */
  unread: string[];
}

export interface Problem { key: string; level: "alert" | "warn"; title: string; detail: string; href: string }

/** A job due more than this long ago and still not started counts as overdue (dispatch runs every 15 minutes, up to 15 late). */
export const OVERDUE_MIN = 45;
/** An alert is emailed again at most this often while its problem lasts. */
export const REALERT_HOURS = 24;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const keyPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);

/** Everything wrong, worst first. Alerts email the owner; warnings only show on the page. */
export function statusProblems(f: StatusFacts, now = Date.now()): Problem[] {
  const out: Problem[] = [];
  if (f.deadJobs.count) out.push({ key: "dead_jobs", level: "alert", title: `${plural(f.deadJobs.count, "job")} failed in the last day`, detail: f.deadJobs.latest?.outcome ? `Latest: ${f.deadJobs.latest.outcome.slice(0, 200)}` : "A chain step stopped without finishing.", href: "/runs" });
  if (f.overdueJobs.count) {
    const mins = f.overdueJobs.oldestDue ? Math.max(0, Math.round((now - Date.parse(f.overdueJobs.oldestDue)) / 6e4)) : null;
    out.push({ key: "overdue_jobs", level: "alert", title: `${plural(f.overdueJobs.count, "job")} waiting past ${f.overdueJobs.count === 1 ? "its" : "their"} time`, detail: `${mins != null ? `The oldest was due ${mins} minutes ago. ` : ""}The scheduler may not be running: check the dispatch schedule in Vercel.`, href: "/runs" });
  }
  for (const p of f.paused) out.push({ key: `paused:${keyPart(p.id)}`, level: "alert", title: `${p.name} is paused`, detail: `${p.why ? `${p.why.slice(0, 200)}. ` : ""}${p.custom ? "Open it on Connections to accept the change or resume it." : "Sign in again (or paste a new key) on Connections."} Agents that use it skip those tools until then.`, href: "/connections" });
  if (f.failedRuns.count) out.push({ key: "failed_runs", level: "warn", title: `${plural(f.failedRuns.count, "run")} failed in the last day`, detail: f.failedRuns.agents.length ? `By ${f.failedRuns.agents.slice(0, 6).join(", ")}.` : "", href: "/runs" });
  if (f.refused.count) out.push({ key: "refused", level: "warn", title: `${plural(f.refused.count, "proposal")} refused by the gateway in the last day`, detail: f.refused.latest ? `Latest: ${f.refused.latest.slice(0, 200)}` : "Over a cap, or to someone agents may not contact or pay.", href: "/approvals" });
  for (const u of f.unread) out.push({ key: `unread:${keyPart(u)}`, level: "warn", title: `Couldn’t check ${u}`, detail: "Its migration may not be applied yet.", href: "/status" });
  return out;
}

/** The alerts to email now: alert-level, and not emailed within REALERT_HOURS. */
export function alertsDue(problems: Problem[], lastSent: Record<string, string>, now = Date.now()): Problem[] {
  return problems.filter((p) => p.level === "alert" && !(lastSent[p.key] && now - Date.parse(lastSent[p.key]) < REALERT_HOURS * 3.6e6));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One email for all the alerts due: subject, html and text. Links point at this app's Status page. */
export function alertEmail(due: Problem[], origin: string): { subject: string; html: string; text: string } {
  const subject = due.length === 1 ? `Alert: ${due[0].title}` : `Alert: ${due.length} things need a look`;
  const lines = due.map((p) => `${p.title}. ${p.detail}`);
  const link = `${origin}/status`;
  return {
    subject: subject.slice(0, 150),
    text: `${lines.join("\n\n")}\n\nStatus: ${link}`,
    html: `${due.map((p) => `<p><b>${esc(p.title)}</b><br>${esc(p.detail)}</p>`).join("")}<p><a href="${esc(link)}">Open Status</a></p>`,
  };
}
