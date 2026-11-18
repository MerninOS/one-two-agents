import "server-only";
// The audit log (docs/usage.md, slice 2): who did what. Each server action that changes what agents
// may do, spend or reach adds a row once it has worked (check:audit names them). The table is
// append-only in the database. A row that can't be written never undoes the action; the failure is
// logged, scrubbed.
import { db } from "@/core/db";
import { scrubSecrets } from "@/core/mcp-rules";

export interface AuditRow { at: string; actor: string; action: string; target: string | null; detail: Record<string, unknown> | null }

const clip = (v: unknown) => (typeof v === "string" ? scrubSecrets(v).slice(0, 200) : typeof v === "number" || typeof v === "boolean" || v === null ? v : scrubSecrets(JSON.stringify(v)).slice(0, 200));

/** Adds a row: the member, the action's name, what it was done to, and a few plain facts. */
export async function audit(me: { email: string }, action: string, target?: string | null, detail?: Record<string, unknown>): Promise<void> {
  try {
    const d = detail ? Object.fromEntries(Object.entries(detail).slice(0, 12).map(([k, v]) => [k.slice(0, 40), clip(v)])) : null;
    // the table holds at most 2,000 characters of detail: drop facts from the end until it fits
    while (d && JSON.stringify(d).length > 1900) delete d[Object.keys(d).pop()!];
    const { error } = await db().from("audit_log").insert({ actor: me.email, action, target: target == null ? null : scrubSecrets(String(target)).slice(0, 200), detail: d });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(`audit log: ${action} by ${me.email} wasn't recorded: ${scrubSecrets(e instanceof Error ? e.message : String(e))}`);
  }
}

/** The latest rows, newest first. */
export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const { data, error } = await db().from("audit_log").select("at, actor, action, target, detail").order("at", { ascending: false }).limit(Math.min(limit, 500));
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditRow[];
}
