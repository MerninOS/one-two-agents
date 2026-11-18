import "server-only";
// Running chains (core/flow.ts): each step is a job (core/jobs.ts, docs/tenancy.md slice 3), run by
// a worker request as the job's org, with its own time limit and through withRun like any other run.
// A job only names a chain and a step of the SAVED flow; the worker reads the flow for the agent, so
// nothing outside the flow (an inbound email, a web page, a run's output) can choose what runs.
import { loadCrew, resolveAgent } from "@/agents/registry";
import { db } from "@/core/db";
import { afterStep, loadFlow, type Chain, type Ended } from "@/core/flow";
import { chainDedupe, chainPayload, type ChainCtx } from "@/core/job-rules";
import { enqueue, kick } from "@/core/jobs";
import { orgOn } from "@/core/org-switch";
import { withRun } from "@/core/runs";

export type { ChainCtx } from "@/core/job-rules";

/**
 * Starts one step: enqueues it as a job of the current org and, unless it waits for a time,
 * kicks a worker for it. Resolves in seconds; the run itself happens in the worker.
 */
export async function startStep(origin: string, c: Chain, ctx: ChainCtx, runAfter?: number): Promise<void> {
  if (!c.steps[ctx.step]) return;
  const id = await enqueue("chain_step", chainPayload(ctx), chainDedupe(ctx), runAfter);
  if (id && !runAfter) await kick(origin, id);
}

/**
 * After a chain run ends: start the next step now, enqueue it for its "not before" time (the
 * scheduler kicks it then), or stop. Returns what happened, in words, for the log.
 */
export async function continueChain(origin: string, c: Chain, ctx: ChainCtx, runId: string, ended: Ended): Promise<string> {
  const next = afterStep(c, ctx.step, ended);
  if (!next.go) return next.why;
  const nctx: ChainCtx = { chainId: ctx.chainId, key: ctx.key, step: next.step, parent: runId, manual: ctx.manual };
  await startStep(origin, c, nctx, next.at ?? undefined);
  return next.at ? `Step ${next.step + 1} waits until ${new Date(next.at).toISOString()}.` : `Step ${next.step + 1} started.`;
}

/**
 * Runs one chain step for the worker, as the current org. The chain and agent come from the saved
 * flow. A chain that is off, or any chain while the org is off, runs only when it was started with
 * the Run chain button. Returns what happened, and the run when there was one.
 */
export async function runChainStep(origin: string, ctx: ChainCtx): Promise<{ outcome: string; runId?: string; failed?: boolean }> {
  const flow = await loadFlow(await loadCrew());
  const c = flow.flow.chains.find((x) => x.key === ctx.key);
  const step = c?.steps[ctx.step];
  if (!c || !step) return { outcome: "Skipped: that step isn't in the saved crew flow." };
  if (!ctx.manual && !c.on) return { outcome: `Skipped: the ${c.name} chain is off.` };
  if (!ctx.manual && !(await orgOn())) return { outcome: "Skipped: the org is off." };
  const found = await resolveAgent(step.agent);
  if (!found) return { outcome: `Skipped: ${step.agent} isn't an agent.` };
  // a manual-only agent runs in a chain only when the owner pressed Run chain
  if (found.manualOnly && !ctx.manual) return { outcome: "Skipped: this agent runs only by hand; start its chain with Run chain." };
  const handoff = step.passAlong ? await handoffFrom(ctx.parent) : null;
  const log = (w: string) => console.log(`[chain ${c.key}] ${w}`);
  try {
    const res = await withRun(found.id, "chain", (runId, memory) => found.job({ runId, memory, handoff }), { chain: { chainId: ctx.chainId, key: ctx.key, step: ctx.step, parent: ctx.parent } });
    const then = await continueChain(origin, c, ctx, res.runId, { status: res.status, metrics: res.metrics }).catch((e) => `The next step couldn't start: ${e instanceof Error ? e.message : e}`);
    log(then);
    return { outcome: `Run ${res.status}. ${then}`, runId: res.runId };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[chain ${c.key}] step ${ctx.step + 1}`, why);
    // a failed step can still lead somewhere (a step with when "failed" or "any")
    const { data } = await db().from("agent_runs").select("id").eq("chain_id", ctx.chainId).eq("chain_step", ctx.step).order("started_at", { ascending: false }).limit(1).maybeSingle();
    let then = "";
    if (data) then = await continueChain(origin, c, ctx, data.id as string, { status: "failed" }).catch((x) => `The next step couldn't start: ${x instanceof Error ? x.message : x}`);
    if (then) log(then);
    return { outcome: `Run failed: ${why} ${then}`.trim(), runId: data?.id as string | undefined, failed: true };
  }
}

/** Claims a scheduled firing; false when another call already started it. */
export async function claimFiring(key: string, at: number, chainId: string): Promise<boolean> {
  const { error } = await db().from("chain_fires").insert({ chain_key: key, fire_at: new Date(at).toISOString(), chain_id: chainId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(error.message);
}

/** The run before, handed to the next agent as facts: who it was, how it ended, its summary and numbers. */
export async function handoffFrom(parent: string | undefined) {
  if (!parent) return null;
  const { data } = await db().from("agent_runs").select("agent_id, status, summary, error, metrics, ended_at").eq("id", parent).maybeSingle();
  if (!data) return null;
  return { from: data.agent_id as string, status: data.status as string, summary: ((data.summary ?? data.error ?? "") as string).slice(0, 1500), metrics: (data.metrics ?? {}) as Record<string, number>, endedAt: data.ended_at as string | null };
}
export type Handoff = NonNullable<Awaited<ReturnType<typeof handoffFrom>>>;

/**
 * An approval was decided in the Control Room: while the org is on, start every chain that is on and starts on this
 * kind of approval. At most once a minute per chain, so approving twenty receipts at once starts
 * a chain once.
 */
export async function approvalDecided(origin: string, flow: { chains: Chain[] }, tool: string, decision: "approve" | "reject"): Promise<string[]> {
  const started: string[] = [];
  // while the org is off nothing starts on its own, an approval start included
  if (!(await orgOn())) return started;
  const minute = Math.floor(Date.now() / 6e4) * 6e4;
  for (const c of flow.chains) {
    if (!c.on || c.start.type !== "approval" || c.start.tool !== tool || (c.start.decision !== "any" && c.start.decision !== decision)) continue;
    const chainId = crypto.randomUUID();
    if (!(await claimFiring(c.key, minute, chainId))) continue;
    started.push(c.name);
    await startStep(origin, c, { chainId, key: c.key, step: 0 });
  }
  return started;
}
