import "server-only";
// Runs an agent on the runner outside the builder screen (docs/agent-builder.md, slice 6): on a
// schedule, in a chain, or by hand through /api/agents/<id>. Morgan and Avery use it once Zak
// switches them over (agents.on_runner); until then their own code runs.
//
// - Only an approved playbook runs this way. Explore runs stay by hand, from the builder screen.
// - A real run delivers: its reports go out and its proposals become approval cards.
// - A dry run makes the playbook's tool calls in code and stops there: no model, nothing written.
import { db } from "@/core/db";
import { loadSpec } from "@/core/agent-spec";
import { activePlaybook, afterRun, listPlaybooks } from "@/core/playbook";
import { runExplore } from "@/core/runner";
import { TOOLS } from "@/core/tools/catalog";
import { checkInput, paramsOf, type ToolCtx } from "@/core/tools/types";
import type { MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import type { Handoff } from "@/core/chain";

/** Agents rebuilt on the runner that can be switched between their own code and the runner. */
export const REBUILT = new Set(["cfo", "chief_of_staff"]);

/** True when Zak switched this agent to the runner. False when the column isn't there yet. */
export async function onRunner(agentId: string): Promise<boolean> {
  const { data, error } = await db().from("agents").select("on_runner").eq("id", agentId).maybeSingle();
  return !error && !!(data as { on_runner?: boolean } | null)?.on_runner;
}

export async function setOnRunner(agentId: string, on: boolean) {
  const { error } = await db().from("agents").update({ on_runner: on }).eq("id", agentId);
  if (error) throw new Error(error.message);
}

/** The active spec and approved playbook, or why the agent can't run on the runner. */
async function ready(agentId: string) {
  const spec = await loadSpec(agentId);
  if (!spec) return { problem: "it has no saved spec" } as const;
  if (spec.problems.length) return { problem: `its spec asks for something code doesn't offer: ${spec.problems.join("; ")}` } as const;
  const pb = activePlaybook(await listPlaybooks(agentId));
  if (!pb) return { problem: "it has no approved playbook yet (explore runs are by hand, from the builder screen)" } as const;
  return { spec: spec.spec, version: spec.version, playbook: pb } as const;
}

/** A free dry run: the playbook's tool calls, made in code. No model, nothing written. */
export async function dryRunPlaybook(agentId: string): Promise<RunResult & { lines: string[] }> {
  const r = await ready(agentId);
  if ("problem" in r) return { status: "skipped", summary: `Not ready for the runner: ${r.problem}.`, lines: [] };
  const ctx: ToolCtx = { agentId, notionPages: r.spec.notionPages, outputSources: r.spec.readsFrom, reportPage: r.spec.reportPage };
  const lines: string[] = [];
  const numbers: Record<string, number> = {};
  for (const s of r.playbook.steps) {
    const t = TOOLS[s.tool];
    if (!t?.run || !r.spec.tools.includes(s.tool)) { lines.push(`FAILED ${s.tool}: not a tool this spec grants`); continue; }
    const checked = checkInput(paramsOf(t, ctx), s.input);
    if ("problem" in checked) { lines.push(`FAILED ${t.label}: ${checked.problem}`); continue; }
    try {
      const out = await t.run(checked.input, ctx);
      Object.assign(numbers, out.numbers ?? {});
      const nums = Object.entries(out.numbers ?? {}).slice(0, 6).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ");
      lines.push(`OK ${t.label}${nums ? `: ${nums}` : ""}`);
    } catch (e) { lines.push(`FAILED ${t.label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`); }
  }
  const reports = r.spec.tools.map((id) => TOOLS[id]).filter((t) => t?.kind === "report").map((t) => t!.label);
  const bad = lines.filter((l) => l.startsWith("FAILED")).length;
  return {
    status: "ok",
    summary: `[dry run, nothing sent] Spec v${r.version}, playbook v${r.playbook.version}: ${r.playbook.steps.length - bad} of ${r.playbook.steps.length} steps worked. A real run then has ${r.spec.model} write the result${reports.length ? ` and delivers: ${reports.join("; ")}` : ""}.`,
    metrics: numbers, lines,
  };
}

/** One run on the runner, following the approved playbook, delivering what it produces. Call inside withRun. */
export async function runBuilt(agentId: string, opts: { runId?: string; dryRun?: boolean; memory?: MemoryLoad | null; handoff?: Handoff | null }): Promise<RunResult> {
  if (opts.dryRun) { const { lines, ...res } = await dryRunPlaybook(agentId); return { ...res, summary: `${res.summary} ${lines.join(" · ")}` }; }
  const r = await ready(agentId);
  if ("problem" in r) return { status: "skipped", summary: `Not run on the runner: ${r.problem}.` };
  const h = opts.handoff ? { from: opts.handoff.from, summary: opts.handoff.summary ?? "", metrics: opts.handoff.metrics ?? {} } : null;
  const res = await runExplore(r.spec, { agentId, runId: opts.runId, memoryBlock: opts.memory?.block ?? "", playbook: { version: r.playbook.version, steps: r.playbook.steps }, deliver: true, handoff: h });
  let note = "";
  try { note = ` ${await afterRun(agentId, opts.runId ?? null, res)}`; } catch (e) { note = ` (Playbook not updated: ${e instanceof Error ? e.message : String(e)})`; }
  return {
    status: res.status, summary: `[runner, spec v${r.version}] ${res.summary}${note}`.trim(),
    tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd, metrics: res.metrics,
    // the model read the memory block, so next-run notes count down
    readMemory: !!opts.memory && res.finished,
  };
}
