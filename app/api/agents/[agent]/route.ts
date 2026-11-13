import { NextResponse, after } from "next/server";
import { AGENTS, resolveAgent } from "@/agents/registry";
import { continueChain, handoffFrom, readCtx } from "@/core/chain";
import { TAKES_HANDOFF, loadFlow } from "@/core/flow";
import { db } from "@/core/db";
import { cronAuthorized, withRun } from "@/core/runs";

export const maxDuration = 300;

// One entry point for every agent. Vercel Schedules (vercel.json) call it with the CRON_SECRET bearer;
// a manual run adds ?trigger=manual. ?dryRun=1 reads real data but writes nothing
// (no agent_runs row, no Supabase, Notion or Gmail writes) and calls no model.
// A chain step (core/chain.ts) adds ?trigger=chain&chain=…&key=…&step=…: the step must be in the
// saved crew flow with this agent, and when the run ends the next step starts as its own request.
export async function GET(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const found = resolveAgent((await params).agent);
  if (!found) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const { id, def } = found;
  const url = new URL(req.url);
  const asked = url.searchParams.get("trigger");
  const trigger = asked === "manual" ? "manual" : asked === "chain" ? "chain" : "cron";
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");
  if (trigger === "chain") return chainStep(req, id);

  // Manual-only agents have no schedule; refuse anything that isn't an explicit manual run.
  if (def.manualOnly && !dryRun && trigger !== "manual") {
    return NextResponse.json({ status: "skipped", summary: "This agent runs only by hand: add ?trigger=manual." });
  }
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await def.job({ dryRun })) });
    return NextResponse.json(await withRun(id, trigger, (runId, memory) => def.job({ runId, memory })));
  } catch (e) {
    console.error(`[agents/${id}]`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}

/**
 * One step of a chain. The chain and step come from the saved flow, never from the request:
 * the request only names them, and the agent must be the one the flow has at that step. A chain
 * that is off runs only when it was started with the Run chain button.
 */
async function chainStep(req: Request, id: string) {
  const url = new URL(req.url);
  const ctx = readCtx(url);
  if (!ctx) return NextResponse.json({ error: "Bad chain step" }, { status: 400 });
  let flow;
  try { flow = await loadFlow(Object.keys(AGENTS)); }
  catch (e) { return NextResponse.json({ error: `Crew flow can't be read: ${e instanceof Error ? e.message : e}` }, { status: 500 }); }
  const c = flow.flow.chains.find((x) => x.key === ctx.key);
  const step = c?.steps[ctx.step];
  if (!c || !step || step.agent !== id) return NextResponse.json({ status: "skipped", summary: "That step isn't in the saved crew flow." });
  if (!c.on && !ctx.manual) return NextResponse.json({ status: "skipped", summary: `The ${c.name} chain is off.` });
  // a manual-only agent runs in a chain only when Zak pressed Run chain
  if (AGENTS[id].manualOnly && !ctx.manual) return NextResponse.json({ status: "skipped", summary: "This agent runs only by hand: start its chain with Run chain." });
  const handoff = step.passAlong && TAKES_HANDOFF.has(id) ? await handoffFrom(ctx.parent) : null;
  const origin = url.origin;
  try {
    const res = await withRun(id, "chain", (runId, memory) => AGENTS[id].job({ runId, memory, handoff }), { chain: { chainId: ctx.chainId, key: ctx.key, step: ctx.step, parent: ctx.parent } });
    // the next step is its own request; this one answers now
    after(() => continueChain(origin, c, ctx, res.runId, { status: res.status, metrics: res.metrics }).then((w) => console.log(`[chain ${c.key}] ${w}`), (e) => console.error(`[chain ${c.key}]`, e)));
    return NextResponse.json(res);
  } catch (e) {
    console.error(`[agents/${id}] chain ${c.key}`, e);
    // a failed step can still lead somewhere (a step with when "failed" or "any")
    const { data } = await db().from("agent_runs").select("id").eq("chain_id", ctx.chainId).eq("chain_step", ctx.step).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (data) after(() => continueChain(origin, c, ctx, data.id, { status: "failed" }).catch((x) => console.error(`[chain ${c.key}]`, x)));
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
