import "server-only";
// Status and alerts (docs/usage.md, slice 4): reads what core/status-rules.ts judges, for the
// Status page and for the scheduler's alert emails. Reads only the current org's rows (db()).
// Alerts go only through integrations/email.ts, to the org's own owner email (Settings), for every org
// that has one (slice 8.1b); an org without one sees its problems on its Status page only.
import { db } from "@/core/db";
import { MCP_SERVERS } from "@/core/mcp-rules";
import { isCustomId } from "@/core/custom-mcp-rules";
import { emailOwner, hasEmail } from "@/integrations/email";
import { OVERDUE_MIN, alertEmail, alertsDue, statusProblems, type Problem, type StatusFacts } from "@/core/status-rules";

const DAY = 864e5;

/** What is wrong right now in this org. */
export async function readStatus(now = Date.now()): Promise<{ facts: StatusFacts; problems: Problem[] }> {
  const since = new Date(now - DAY).toISOString(), overdue = new Date(now - OVERDUE_MIN * 6e4).toISOString();
  const unread: string[] = [];
  const read = async <T>(what: string, q: PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>, map: (data: unknown, count: number) => T, empty: T): Promise<T> => {
    const { data, error, count } = await q;
    if (error) { unread.push(what); return empty; }
    return map(data, count ?? 0);
  };
  const [deadJobs, waitingJobs, overdueJobs, paused, refused, failedRuns] = await Promise.all([
    read<StatusFacts["deadJobs"]>("jobs", db().from("jobs").select("outcome, failed_at", { count: "exact" }).gte("failed_at", since).order("failed_at", { ascending: false }).limit(1),
      (d, n) => { const r = (d as { outcome: string | null; failed_at: string }[])[0]; return { count: n, latest: r ? { outcome: r.outcome, at: r.failed_at } : null }; }, { count: 0, latest: null }),
    read("jobs", db().from("jobs").select("id", { count: "exact", head: true }).is("claimed_at", null).is("done_at", null).is("failed_at", null), (_d, n) => n, 0),
    read<StatusFacts["overdueJobs"]>("jobs", db().from("jobs").select("run_after", { count: "exact" }).is("claimed_at", null).is("done_at", null).is("failed_at", null).lt("run_after", overdue).order("run_after").limit(1),
      (d, n) => ({ count: n, oldestDue: (d as { run_after: string }[])[0]?.run_after ?? null }), { count: 0, oldestDue: null }),
    pausedConnections().catch(() => { unread.push("connections"); return []; }),
    read<StatusFacts["refused"]>("approvals", db().from("agent_actions").select("reason", { count: "exact" }).eq("status", "refused").gte("created_at", since).order("created_at", { ascending: false }).limit(1),
      (d, n) => ({ count: n, latest: (d as { reason: string | null }[])[0]?.reason ?? null }), { count: 0, latest: null }),
    read<StatusFacts["failedRuns"]>("runs", db().from("agent_runs").select("agent_id").eq("status", "failed").gte("started_at", since).limit(200),
      (d) => { const rows = d as { agent_id: string }[]; return { count: rows.length, agents: [...new Set(rows.map((r) => r.agent_id))] }; }, { count: 0, agents: [] }),
  ]);
  const facts: StatusFacts = { deadJobs, waitingJobs, overdueJobs, paused, refused, failedRuns, unread: [...new Set(unread)] };
  return { facts, problems: statusProblems(facts, now) };
}

async function pausedConnections(): Promise<StatusFacts["paused"]> {
  const { data, error } = await db().from("mcp_connections").select("id, last_error").not("paused_at", "is", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; last_error: string | null }[];
  const custom = rows.filter((r) => isCustomId(r.id)).map((r) => r.id);
  const names: Record<string, string> = {};
  if (custom.length) {
    const c = await db().from("mcp_custom_servers").select("id, name").in("id", custom);
    for (const r of (c.data ?? []) as { id: string; name: string }[]) names[r.id] = r.name;
  }
  return rows.map((r) => ({ id: r.id, why: r.last_error, custom: isCustomId(r.id), name: names[r.id] ?? (MCP_SERVERS as Record<string, { name: string }>)[r.id]?.name ?? r.id }));
}

/**
 * Emails the owner the alerts that are due (the scheduler calls this for each org). Each problem
 * goes out once, then at most once a day while it lasts. Returns the keys emailed.
 */
export async function sendStatusAlerts(origin: string, now = Date.now()): Promise<string[]> {
  if (!(await hasEmail())) return [];
  const { problems } = await readStatus(now);
  if (!problems.some((p) => p.level === "alert")) return [];
  const { data, error } = await db().from("status_alerts").select("key, sent_at");
  if (error) return [];
  const lastSent = Object.fromEntries(((data ?? []) as { key: string; sent_at: string }[]).map((r) => [r.key, r.sent_at]));
  const due = alertsDue(problems, lastSent, now);
  if (!due.length) return [];
  // mark first, so two schedulers at once can't both send; a send that fails is retried next day
  const at = new Date(now).toISOString();
  const { error: e2 } = await db().from("status_alerts").upsert(due.map((p) => ({ key: p.key, sent_at: at })), { onConflict: "key" });
  if (e2) return [];
  const m = alertEmail(due, origin);
  await emailOwner(m.subject, m.html, m.text);
  return due.map((p) => p.key);
}
