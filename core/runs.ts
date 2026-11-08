import "server-only";
// Run plumbing shared by every agent: the run log, the enabled flag and daily budget
// check, and the cron bearer check.
import { db } from "@/core/db";
import { env } from "@/core/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; manual runs use the same header. */
export const cronAuthorized = (req: Request) => !!env.cronSecret && req.headers.get("authorization") === `Bearer ${env.cronSecret}`;

export interface RunResult { status: "ok" | "skipped"; summary: string; tokensIn?: number; tokensOut?: number; costUsd?: number }

/** Why the agent may not run now (disabled, or over today's budget), or null. */
async function blockedReason(agentId: string) {
  const { data: agent } = await db().from("agents").select("enabled, daily_budget_usd").eq("id", agentId).single();
  if (!agent?.enabled) return "Agent is disabled.";
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data: runs } = await db().from("agent_runs").select("cost_usd").eq("agent_id", agentId).gte("started_at", since.toISOString());
  const spent = (runs ?? []).reduce((a, r) => a + Number(r.cost_usd), 0);
  return spent >= Number(agent.daily_budget_usd) ? `Daily budget of $${agent.daily_budget_usd} reached ($${spent.toFixed(2)} spent).` : null;
}

/** Run one agent job with a row in agent_runs around it; a failure is recorded, then rethrown. */
export async function withRun(agentId: string, trigger: string, job: (runId: string) => Promise<RunResult>): Promise<RunResult & { runId: string }> {
  const { data: run, error } = await db().from("agent_runs").insert({ agent_id: agentId, trigger }).select("id").single();
  if (error || !run) throw new Error(`Could not start run: ${error?.message}`);
  const finish = (patch: Record<string, unknown>) => db().from("agent_runs").update({ ended_at: new Date().toISOString(), ...patch }).eq("id", run.id);
  try {
    const blocked = await blockedReason(agentId);
    const res: RunResult = blocked ? { status: "skipped", summary: blocked } : await job(run.id);
    await finish({ status: res.status, summary: res.summary, tokens_in: res.tokensIn ?? 0, tokens_out: res.tokensOut ?? 0, cost_usd: res.costUsd ?? 0 });
    return { ...res, runId: run.id };
  } catch (e) {
    await finish({ status: "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
