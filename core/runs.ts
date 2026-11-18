import "server-only";
// Run plumbing shared by every agent: the run log, the enabled flag, the daily budget and
// department budget checks, and the cron bearer check.
import { traced } from "@/core/trace";
import { db } from "@/core/db";
import { agentSpend } from "@/core/usage";
import { env } from "@/core/env";
import { agentDepartment, claimBudgetAlert, deptBudgetBlock } from "@/core/org";
import { emailOwner, hasEmail } from "@/integrations/email";
import { planBlock } from "@/core/extensions";
import { afterLoad, loadMemory, loadSummary, saveWorking, type MemoryLoad } from "@/core/memory";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; manual runs use the same header. */
export const cronAuthorized = (req: Request) => !!env.cronSecret && req.headers.get("authorization") === `Bearer ${env.cronSecret}`;

export interface RunResult {
  status: "ok" | "skipped"; summary: string; tokensIn?: number; tokensOut?: number; costUsd?: number;
  /**
   * Lines the agent wants for its next run, set only when the model actually read its memory.
   * withRun caps and cleans them (core/memory.ts saveWorking); [] clears working memory.
   */
  remember?: string[];
  /** For an agent that keeps no working memory: the model read its memory, so next-run notes count down. */
  readMemory?: boolean;
  /** Numbers computed in code (core/flow.ts METRICS), for chain checks and hand-offs. */
  metrics?: Record<string, number>;
}

/** Which chain a run belongs to (core/chain.ts). */
export interface RunChain { chainId: string; key: string; step: number; parent?: string }

/**
 * Why the agent may not run now (disabled, over today's budget, its department over this
 * month's budget, or the business's plan, core/extensions.ts), or null. A Preview (Setup tab) writes and sends nothing, so it may run while
 * the agent is off duty; it still needs budget.
 */
async function blockedReason(agentId: string, trigger: string) {
  const { data: agent } = await db().from("agents").select("enabled, daily_budget_usd").eq("id", agentId).single();
  if (!agent) return "Agent is not in the agents table.";
  if (!agent.enabled && trigger !== "preview") return "Agent is disabled.";
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const spent = await agentSpend(agentId, since.toISOString());
  if (spent >= Number(agent.daily_budget_usd)) return `Daily budget of $${agent.daily_budget_usd} reached ($${spent.toFixed(2)} spent).`;
  return (await deptBlocked(agentId)) ?? planBlock({ kind: "run", agentId, trigger });
}

/**
 * The department budget (docs/org-chart.md, slice 2): the agents seated in a department share its
 * monthly budget, on top of each one's daily budget. The first skip of the month emails the owner. No
 * org chart, no department or no department budget: nothing to check. Spend that can't be read
 * blocks the run, since it can't be shown to be under the budget.
 */
async function deptBlocked(agentId: string): Promise<string | null> {
  let at: Awaited<ReturnType<typeof agentDepartment>>;
  try { at = await agentDepartment(agentId, { spend: true }); }
  catch (e) { return `Couldn’t check the department budget: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}.`; }
  const why = at && deptBudgetBlock(at.dept, at.spentUsd);
  if (!at || !why) return null;
  try {
    if ((await hasEmail()) && (await claimBudgetAlert(at.dept.id))) {
      const line = `${why} Its agents’ runs are skipped at $0 until next month, or until you raise the budget on Crew > Org chart (Edit chart, then Edit on ${at.dept.name}).`;
      await emailOwner(`${at.dept.name} reached its monthly AI budget`, `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`, line);
    }
  } catch { /* an alert that can't be sent never changes the skip */ }
  return why;
}

/**
 * Run one agent job with a row in agent_runs around it; a failure is recorded, then rethrown.
 * Every agent gets its memory loaded after the on-duty and budget check (a skipped
 * run loads nothing) and leave working memory when the run finishes. A memory store that can't
 * be read never stops the run: the job gets null and the summary says so.
 * Trigger "preview" (a try from the builder) loads none: the job reads memory itself without
 * changing it.
 */
export async function withRun(agentId: string, trigger: string, job: (runId: string, memory: MemoryLoad | null) => Promise<RunResult>, opts: { chain?: RunChain } = {}): Promise<RunResult & { runId: string }> {
  return traced("run", { "operator.agent": agentId, "operator.trigger": trigger, "operator.chain": opts.chain?.key }, async (set) => {
    const out = await loggedRun(agentId, trigger, job, opts, (runId) => set({ "operator.run": runId }));
    set({ "operator.status": out.status, "operator.tokens_in": out.tokensIn ?? 0, "operator.tokens_out": out.tokensOut ?? 0, "operator.cost_usd": out.costUsd ?? 0 });
    return out;
  });
}

async function loggedRun(agentId: string, trigger: string, job: (runId: string, memory: MemoryLoad | null) => Promise<RunResult>, opts: { chain?: RunChain }, started: (runId: string) => void): Promise<RunResult & { runId: string }> {
  // chain columns arrive with the crew_flow migration; only a chain run names them
  const c = opts.chain;
  const chainCols = c ? { chain_id: c.chainId, chain_key: c.key, chain_step: c.step, ...(c.parent ? { parent_run_id: c.parent } : {}) } : {};
  const { data: run, error } = await db().from("agent_runs").insert({ agent_id: agentId, trigger, ...chainCols }).select("id").single();
  if (error || !run) throw new Error(`Could not start run: ${error?.message}`);
  started(run.id);
  const finish = (patch: Record<string, unknown>) => db().from("agent_runs").update({ ended_at: new Date().toISOString(), ...patch }).eq("id", run.id);
  let memory: MemoryLoad | null = null, memoryNote = "";
  try {
    const blocked = await blockedReason(agentId, trigger);
    const agentRun = !blocked && (trigger === "cron" || trigger === "manual" || trigger === "chain");
    // only agent runs load memory; a gateway apply run (trigger "approval") is not the agent thinking,
    // and a Preview reads memory itself without counting anything down
    if (agentRun) {
      try { memory = await loadMemory(agentId); }
      catch (e) { memoryNote += ` (memory not loaded: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)})`; }
    }
    const res: RunResult = blocked ? { status: "skipped", summary: blocked } : await job(run.id, memory);
    // `remember` (even empty) means the model read its memory: count down next-run notes and
    // replace working memory. Without it (rules fallback, model unreachable) memory is left as it was.
    if (memory && res.status === "ok" && (res.remember !== undefined || res.readMemory)) {
      try {
        await afterLoad(memory, run.id);
        if (res.remember !== undefined) memoryNote += await saveWorking(agentId, run.id, res.remember);
      } catch (e) { memoryNote += ` Memory not updated: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}.`; }
    }
    await finish({
      status: res.status, summary: `${res.summary}${memoryNote}`, tokens_in: res.tokensIn ?? 0, tokens_out: res.tokensOut ?? 0, cost_usd: res.costUsd ?? 0,
      ...(memory ? { memory_json: loadSummary(memory) } : {}),
      // every run's metrics are kept: a try's spec_version and finished flag are what unlock Go live
      ...(res.metrics ? { metrics: res.metrics } : {}),
    });
    return { ...res, summary: `${res.summary}${memoryNote}`, runId: run.id };
  } catch (e) {
    await finish({ status: "failed", error: e instanceof Error ? e.message : String(e), ...(memory ? { memory_json: loadSummary(memory) } : {}) });
    throw e;
  }
}
