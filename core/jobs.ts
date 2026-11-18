import "server-only";
// The job queue (docs/tenancy.md, slice 3). A job is a row in `jobs`, always the current org's
// (db() stamps and filters it, and the database lock holds it to that org). The scheduler
// (/api/dispatch, every 15 minutes) kicks the jobs that are due; a kick is a signed request to
// /api/jobs/<id>?org=<org>, which claims the job as that org, answers, and runs it in its own
// time limit. Claiming is a conditional update, so a job runs once however often it is kicked.
// A claimed job that never finishes is marked failed, not retried: a run may have half happened.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { DUE_LIMIT, STALE_MS, outcomeText, type JobKind } from "@/core/job-rules";
import { orgId } from "@/core/tenancy";

export interface Job { id: string; kind: JobKind; payload: unknown; attempts: number }

/** Adds a job for the current org; null when a job with that key is already there. */
export async function enqueue(kind: JobKind, payload: Record<string, unknown>, dedupeKey: string, runAfter?: number): Promise<string | null> {
  const { data, error } = await db().from("jobs")
    .insert({ kind, payload, dedupe_key: dedupeKey, ...(runAfter ? { run_after: new Date(runAfter).toISOString() } : {}) })
    .select("id").single();
  if (error) { if (error.code === "23505") return null; throw new Error(error.message); }
  return data.id as string;
}

/** Claims a job that is waiting and due; null when it isn't (already claimed, finished, or not due yet). */
export async function claimJob(id: string, now = Date.now()): Promise<Job | null> {
  const { data: seen, error } = await db().from("jobs").select("attempts").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!seen) return null;
  const { data, error: e2 } = await db().from("jobs")
    .update({ claimed_at: new Date(now).toISOString(), attempts: Math.min((seen.attempts as number) + 1, 10) })
    .eq("id", id).is("claimed_at", null).is("done_at", null).is("failed_at", null).lte("run_after", new Date(now).toISOString())
    .select("id, kind, payload, attempts").maybeSingle();
  if (e2) throw new Error(e2.message);
  return data ? { id: data.id as string, kind: data.kind as JobKind, payload: data.payload, attempts: data.attempts as number } : null;
}

/** Marks a claimed job finished (done, or failed) with what happened. */
export async function finishJob(id: string, how: { failed?: boolean; outcome: string; runId?: string }): Promise<void> {
  const at = new Date().toISOString();
  const { error } = await db().from("jobs")
    .update({ [how.failed ? "failed_at" : "done_at"]: at, outcome: outcomeText(how.outcome), ...(how.runId ? { run_id: how.runId } : {}) })
    .eq("id", id).is("done_at", null).is("failed_at", null);
  if (error) throw new Error(error.message);
}

/** Jobs claimed longer ago than STALE_MS and never finished: marked failed. Returns how many. */
export async function failStale(now = Date.now()): Promise<number> {
  const { data, error } = await db().from("jobs")
    .update({ failed_at: new Date(now).toISOString(), outcome: "Didn't finish within its time limit." })
    .lt("claimed_at", new Date(now - STALE_MS).toISOString()).is("done_at", null).is("failed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Ids of the current org's jobs that are waiting and due, oldest first. */
export async function dueJobs(now = Date.now()): Promise<string[]> {
  const { data, error } = await db().from("jobs").select("id")
    .is("claimed_at", null).is("done_at", null).is("failed_at", null).lte("run_after", new Date(now).toISOString())
    .order("run_after").limit(DUE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Asks a worker to run a job of the current org. Resolves once the worker has claimed it and
 * answered (seconds), not when the work ends. A kick that fails leaves the job waiting, and the
 * next scheduler call kicks it again.
 */
export async function kick(origin: string, id: string): Promise<void> {
  if (!env.cronSecret || !origin) return;
  const org = await orgId();
  try {
    const res = await fetch(`${origin}/api/jobs/${id}?org=${org}`, { headers: { authorization: `Bearer ${env.cronSecret}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) console.error(`[jobs] ${id} answered ${res.status}`);
  } catch (e) { console.error(`[jobs] ${id} could not be started`, e instanceof Error ? e.message : e); }
}
