import "server-only";
// Running chains (core/flow.ts): starting a chain's first step, and going on to the next step
// when a run ends. Each step is its own request to /api/agents/<id>, signed with CRON_SECRET,
// so every run gets its own time limit and goes through withRun like any other. The request
// only names a chain and a step of the SAVED flow; the route checks that the agent matches, so
// nothing outside the flow (an inbound email, a web page, a run's output) can choose what runs.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { afterStep, type Chain, type Ended } from "@/core/flow";

export interface ChainCtx {
  chainId: string;
  key: string;
  step: number;
  /** The run of the step before, for the hand-off and the replay. */
  parent?: string;
  /** Started with the Run chain button: later steps go on even while the chain is off. */
  manual?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The chain part of a step request's query string, checked; null when there is none or it is malformed. */
export function readCtx(url: URL): ChainCtx | null {
  const chainId = url.searchParams.get("chain") ?? "", key = url.searchParams.get("key") ?? "", step = Number(url.searchParams.get("step"));
  const parent = url.searchParams.get("parent") ?? undefined;
  if (!UUID.test(chainId) || !/^[a-z0-9_-]{1,40}$/.test(key) || !Number.isInteger(step) || step < 0 || step > 9) return null;
  if (parent !== undefined && !UUID.test(parent)) return null;
  return { chainId, key, step, parent, manual: url.searchParams.get("manual") === "1" };
}

/**
 * Starts one step: a signed request to the agent's own route. Resolves when that run has ended
 * (the route answers after withRun), so callers wrap it in after().
 */
export async function startStep(origin: string, c: Chain, ctx: ChainCtx): Promise<void> {
  const agent = c.steps[ctx.step]?.agent;
  if (!agent || !env.cronSecret) return;
  const q = new URLSearchParams({ trigger: "chain", chain: ctx.chainId, key: ctx.key, step: String(ctx.step), ...(ctx.parent ? { parent: ctx.parent } : {}), ...(ctx.manual ? { manual: "1" } : {}) });
  try {
    const res = await fetch(`${origin}/api/agents/${agent}?${q}`, { headers: { authorization: `Bearer ${env.cronSecret}` }, cache: "no-store" });
    if (!res.ok) console.error(`[chain ${ctx.key}] step ${ctx.step + 1} (${agent}) answered ${res.status}`);
  } catch (e) { console.error(`[chain ${ctx.key}] step ${ctx.step + 1} (${agent}) could not start`, e); }
}

/**
 * After a chain run ends: start the next step now, park it until its "not before" time (the
 * dispatcher picks it up), or stop. Returns what happened, in words, for the log.
 */
export async function continueChain(origin: string, c: Chain, ctx: ChainCtx, runId: string, ended: Ended): Promise<string> {
  const next = afterStep(c, ctx.step, ended);
  if (!next.go) return next.why;
  const nctx: ChainCtx = { chainId: ctx.chainId, key: ctx.key, step: next.step, parent: runId, manual: ctx.manual };
  if (next.at) {
    const { error } = await db().from("chain_waits").insert({ chain_id: ctx.chainId, chain_key: ctx.key, step: next.step, parent_run_id: runId, manual: !!ctx.manual, due_at: new Date(next.at).toISOString() });
    if (error && error.code !== "23505") throw new Error(error.message);
    return `Step ${next.step + 1} waits until ${new Date(next.at).toISOString()}.`;
  }
  await startStep(origin, c, nctx);
  return `Step ${next.step + 1} started.`;
}

/** Claims a scheduled firing; false when another call already started it. */
export async function claimFiring(key: string, at: number, chainId: string): Promise<boolean> {
  const { error } = await db().from("chain_fires").insert({ chain_key: key, fire_at: new Date(at).toISOString(), chain_id: chainId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(error.message);
}

/** Waiting steps that are due, each claimed so only one call starts it. */
export async function claimDueWaits(now = Date.now()): Promise<{ chainId: string; key: string; step: number; parent: string | null; manual: boolean }[]> {
  const { data, error } = await db().from("chain_waits").select("id, chain_id, chain_key, step, parent_run_id, manual").is("started_at", null).lte("due_at", new Date(now).toISOString()).limit(20);
  if (error) throw new Error(error.message);
  const out = [];
  for (const w of data ?? []) {
    const { data: got } = await db().from("chain_waits").update({ started_at: new Date().toISOString() }).eq("id", w.id).is("started_at", null).select("id").maybeSingle();
    if (got) out.push({ chainId: w.chain_id as string, key: w.chain_key as string, step: w.step as number, parent: (w.parent_run_id as string | null) ?? null, manual: !!w.manual });
  }
  return out;
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
 * An approval was decided in the Control Room: start every chain that is on and starts on this
 * kind of approval. At most once a minute per chain, so approving twenty receipts at once starts
 * a chain once.
 */
export async function approvalDecided(origin: string, flow: { chains: Chain[] }, tool: string, decision: "approve" | "reject"): Promise<string[]> {
  const started: string[] = [];
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
