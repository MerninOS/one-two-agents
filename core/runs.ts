import "server-only";
// Run plumbing shared by every agent: the run log, the enabled flag and daily budget
// check, and the cron bearer check.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { MEMORY_AGENTS, afterLoad, loadMemory, loadSummary, saveWorking, type MemoryLoad } from "@/core/memory";
import { setupOrDefaults, type Setup } from "@/core/setup";
import { MENUS } from "@/agents/menus";

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
}

/**
 * Why the agent may not run now (disabled, or over today's budget), or null. A Preview (Setup
 * tab) writes and sends nothing, so it may run while the agent is off duty; it still needs budget.
 */
async function blockedReason(agentId: string, trigger: string) {
  const { data: agent } = await db().from("agents").select("enabled, daily_budget_usd").eq("id", agentId).single();
  if (!agent) return "Agent is not in the agents table.";
  if (!agent.enabled && trigger !== "preview") return "Agent is disabled.";
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data: runs } = await db().from("agent_runs").select("cost_usd").eq("agent_id", agentId).gte("started_at", since.toISOString());
  const spent = (runs ?? []).reduce((a, r) => a + Number(r.cost_usd), 0);
  return spent >= Number(agent.daily_budget_usd) ? `Daily budget of $${agent.daily_budget_usd} reached ($${spent.toFixed(2)} spent).` : null;
}

// The column arrives with the agent_setup migration. A version only exists once that has been
// applied, so a run on built-in values never names the column.
const setupCol = (s: Setup | null) => (s?.version != null ? { setup_version: s.version } : {});

/**
 * Run one agent job with a row in agent_runs around it; a failure is recorded, then rethrown.
 * Agents in MEMORY_AGENTS get their memory loaded after the on-duty and budget check (a skipped
 * run loads nothing) and leave working memory when the run finishes. A memory store that can't
 * be read never stops the run: the job gets null and the summary says so.
 * Agents with a menu (agents/menus.ts) also get their active setup (core/setup.ts). A setup that
 * can't be read never stops the run either: the job gets the menu's defaults and the summary says so.
 * Trigger "preview" (a draft setup tried from the Setup tab) gets neither: the job brings its own
 * draft and reads memory without changing it.
 */
export async function withRun(agentId: string, trigger: string, job: (runId: string, memory: MemoryLoad | null, setup: Setup | null) => Promise<RunResult>): Promise<RunResult & { runId: string }> {
  const { data: run, error } = await db().from("agent_runs").insert({ agent_id: agentId, trigger }).select("id").single();
  if (error || !run) throw new Error(`Could not start run: ${error?.message}`);
  const finish = (patch: Record<string, unknown>) => db().from("agent_runs").update({ ended_at: new Date().toISOString(), ...patch }).eq("id", run.id);
  let memory: MemoryLoad | null = null, memoryNote = "";
  let setup: Setup | null = null;
  try {
    const blocked = await blockedReason(agentId, trigger);
    const agentRun = !blocked && (trigger === "cron" || trigger === "manual");
    if (agentRun && MENUS[agentId]) {
      const got = await setupOrDefaults(MENUS[agentId]);
      setup = got.setup;
      if (got.problem) memoryNote = ` (setup not loaded, built-in values used: ${got.problem})`;
      else if (setup.problems.length) memoryNote = ` (setup v${setup.version} values ignored: ${setup.problems.join("; ").slice(0, 200)})`;
    }
    // only agent runs load memory; a gateway apply run (trigger "approval") is not the agent thinking,
    // and a Preview reads memory itself without counting anything down
    if (agentRun && MEMORY_AGENTS.has(agentId)) {
      try { memory = await loadMemory(agentId); }
      catch (e) { memoryNote += ` (memory not loaded: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)})`; }
    }
    const res: RunResult = blocked ? { status: "skipped", summary: blocked } : await job(run.id, memory, setup);
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
      ...(memory ? { memory_json: loadSummary(memory) } : {}), ...setupCol(setup),
    });
    return { ...res, summary: `${res.summary}${memoryNote}`, runId: run.id };
  } catch (e) {
    await finish({ status: "failed", error: e instanceof Error ? e.message : String(e), ...(memory ? { memory_json: loadSummary(memory) } : {}), ...setupCol(setup) });
    throw e;
  }
}
