// The agent map (docs/builder-flow.md, slice 3): what an agent is, drawn left to right from its saved
// spec: when it runs, what it reads, how it thinks, what it hands you, and which agents use its
// result. A run can be laid over it (each tool's calls from run_steps). Plain data and pure helpers;
// components/AgentMap.tsx draws it. Every box comes from data, nothing is drawn by hand per agent.
import type { AgentSpec } from "@/core/agent-spec";
import type { Run, RunStatus } from "./data";
import { when } from "./format";
import type { BuilderMenu } from "./builder";
import { estimate, money, type StepKey } from "./flowSteps";

export type ColKey = "when" | "reads" | "thinks" | "hands" | "usedBy";
/**
 * The columns, left to right. Only columns the data can fill: the departments epic adds a
 * "Reports to" column here (and lead agents' team outputs under Reads) once an agent can have a head.
 */
export const MAP_COLS: { key: ColKey; title: string }[] = [
  { key: "when", title: "When" },
  { key: "reads", title: "Reads" },
  { key: "thinks", title: "Thinks" },
  { key: "hands", title: "Hands you" },
  { key: "usedBy", title: "Used by" },
];

export type NodeState = "ok" | "failed" | "unused" | "live";
export type NodeLook = "plain" | "brain" | "dashed" | "do" | "out";
export interface MapNode { id: string; kicker: string; title: string; sub: string; foot?: string; href: string | null; look: NodeLook; state: NodeState | null }
export interface MapCol { key: ColKey; title: string; nodes: MapNode[] }
export interface AgentMapModel { name: string; cols: MapCol[]; edges: { from: string; to: string }[]; run: MapRun | null }

export interface MapStep { kind: string; tool: string | null; ok: boolean; ms: number }
/** A run laid over the map. Runs from before the engine (an agent's old code) have no steps, so only the brain shows how it went. */
export interface MapRun {
  status: RunStatus; trigger: string; at: string;
  tokensIn: number; tokensOut: number; costUsd: number;
  memory: { lines: number; tokens: number } | null;
  steps: MapStep[];
}

export interface MapInput {
  agentId: string;
  spec: AgentSpec;
  menu: Pick<BuilderMenu, "tools" | "models" | "conns">;
  /** The schedule in words (dashboard/schedule.ts schedWords), or null when it only runs when pressed. */
  schedule: string | null;
  chain: string | null;
  usedBy: { id: string; name: string }[];
  /** The flow's edit link (`/build/<id>?edit=1`), so each box opens its step; null where the map is read-only. */
  edit: string | null;
  run?: MapRun | null;
}

const MAX_PER_COL = 6;
const TRIGGER: Record<string, string> = { cron: "Vercel Schedule", manual: "You pressed Run", approval: "You approved changes", chain: "Its chain ran it", preview: "A try from the builder" };
const secs = (ms: number) => (ms < 100 ? "under 0.1s" : `${(ms / 1000).toFixed(1)}s`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function mapOf(x: MapInput): AgentMapModel {
  const { spec, menu, run } = x;
  const stepped = !!run && run.steps.length > 0;
  // a try sends, queues and saves nothing by design, so those boxes say so instead of "not used"
  const isTry = run?.trigger === "preview";
  const step = (k: StepKey) => (x.edit ? `${x.edit}&step=${k}` : null);
  const connName = (id: string) => menu.conns.find((c) => c.id === id)?.name ?? id;
  const tools = spec.tools.map((id) => menu.tools.find((t) => t.id === id)).filter((t): t is BuilderMenu["tools"][number] => !!t);

  // how a tool did in this run: only runs on the runner log their calls
  const did = (toolId: string, sub: string): Pick<MapNode, "state" | "sub"> => {
    if (!stepped) return { state: null, sub };
    const calls = run!.steps.filter((s) => s.kind === "tool" && s.tool === toolId);
    if (!calls.length) return { state: "unused", sub: "Not used this run" };
    const ms = calls.reduce((s, c) => s + c.ms, 0);
    const bad = calls.filter((c) => !c.ok).length;
    return { state: bad ? "failed" : "ok", sub: `${calls.length > 1 ? `${calls.length} calls · ` : ""}${bad ? `${bad} failed · ` : ""}${secs(ms)}` };
  };

  const when: MapNode = run
    ? { id: "when", kicker: run.trigger === "preview" ? "Try" : "Run", title: TRIGGER[run.trigger] ?? run.trigger, sub: run.at, href: null, look: "plain", state: null }
    : { id: "when", kicker: x.chain ? `${x.chain} chain` : "Schedule", title: x.schedule ?? "When you press Run", sub: x.schedule ? (x.chain ? "Runs in its chain, when the chain is on" : "When its schedule is on") : "No automatic runs", href: null, look: "plain", state: null };

  const reads: MapNode[] = [{
    id: "memory", kicker: "Memory", title: "Standing orders",
    sub: run?.memory ? `${run.memory.lines} line${run.memory.lines === 1 ? "" : "s"} · ${run.memory.tokens.toLocaleString("en-US")} tokens` : isTry ? "Loaded as on a live run" : run ? "Loaded none this run" : "Loaded at the start of each run",
    href: `/agents/${x.agentId}?tab=memory`, look: "plain", state: null,
  }];
  for (const t of tools.filter((t) => t.kind === "read" || t.kind === "calculate")) {
    if (t.id === "agent_output") {
      for (const r of spec.readsFrom) reads.push({ id: `from:${r.agentId}`, kicker: "Another agent", title: r.label, ...did(t.id, "Its latest finished result"), href: `/build/${r.agentId}`, look: "plain" });
      continue;
    }
    const sub = t.id === "notion_read_page" && spec.notionPages.length ? spec.notionPages.map((p) => p.label).join(", ") : t.detail;
    reads.push({ id: `t:${t.id}`, kicker: t.kind === "calculate" ? "Math in code" : connName(t.conn), title: t.label, ...did(t.id, clip(sub, 90)), href: step("connections"), look: "plain" });
  }

  const est = estimate(spec, menu.models);
  const model = menu.models.find((m) => m.id === spec.model)?.label ?? spec.model;
  const brain: MapNode = {
    id: "brain", kicker: `Brain · ${spec.effort}`, title: model,
    sub: run
      ? run.status === "running" ? "Working now" : run.status === "skipped" ? "Skipped: off duty or over budget" : `${run.tokensIn.toLocaleString("en-US")} in · ${run.tokensOut.toLocaleString("en-US")} out`
      : clip(spec.mandate, 110),
    foot: run ? (run.status === "skipped" ? undefined : `${money(run.costUsd)}${run.status === "running" ? " so far" : ""} · stops at ${money(spec.limits.maxCostUsd)}`) : `${est != null ? `≈ ${money(est)} a run · ` : ""}stops at ${money(spec.limits.maxCostUsd)}`,
    href: step("brain"), look: "brain",
    state: run ? (run.status === "running" ? "live" : run.status === "failed" ? "failed" : run.status === "ok" ? "ok" : null) : null,
  };

  const hands: MapNode[] = [];
  for (const t of tools.filter((t) => t.kind === "report")) {
    const sub = t.id === "report_notion_page" && spec.reportPage ? `Under ${spec.reportPage.label}` : clip(t.detail, 90);
    hands.push({ id: `t:${t.id}`, kicker: connName(t.conn), title: t.label, ...(isTry ? { state: "unused" as const, sub: "Not sent in a try" } : did(t.id, sub)), href: step("hands"), look: "plain" });
  }
  for (const t of tools.filter((t) => t.kind === "action")) {
    hands.push({ id: `t:${t.id}`, kicker: `${connName(t.conn)} · asks you first`, title: t.label, ...(isTry ? { state: "unused" as const, sub: "Not queued in a try" } : did(t.id, "An approval card you tap")), href: step("connections"), look: "do" });
  }
  hands.push({ id: "out", kicker: "Saves", title: `“${spec.outputName}”`, sub: isTry ? "Not saved in a try" : "Other agents can read it", href: step("hands"), look: "out", state: isTry ? "unused" : null });

  const usedBy: MapNode[] = x.usedBy.length
    ? x.usedBy.map((u) => ({ id: `by:${u.id}`, kicker: "Reads its result", title: u.name, sub: "Picked in its Connections step", href: `/build/${u.id}`, look: "plain" as const, state: null }))
    : [{ id: "by:none", kicker: "Nobody yet", title: "", sub: "Pick it in another agent's Connections step", href: null, look: "dashed", state: null }];

  const cap = (nodes: MapNode[], col: ColKey): MapNode[] => nodes.length <= MAX_PER_COL ? nodes
    : [...nodes.slice(0, MAX_PER_COL - 1), { id: `${col}:more`, kicker: "", title: `+${nodes.length - MAX_PER_COL + 1} more`, sub: nodes.slice(MAX_PER_COL - 1).map((n) => n.title).join(", "), href: nodes[MAX_PER_COL - 1].href, look: "dashed", state: null }];

  const byCol: Record<ColKey, MapNode[]> = { when: [when], reads: cap(reads, "reads"), thinks: [brain], hands: cap(hands, "hands"), usedBy: cap(usedBy, "usedBy") };
  const cols = MAP_COLS.map((c) => ({ ...c, nodes: byCol[c.key] }));

  const edges: AgentMapModel["edges"] = [];
  for (const r of byCol.reads) edges.push({ from: "when", to: r.id }, { from: r.id, to: "brain" });
  for (const h of byCol.hands) edges.push({ from: "brain", to: h.id });
  const out = byCol.hands.find((h) => h.id === "out") ?? byCol.hands[byCol.hands.length - 1];
  for (const u of byCol.usedBy) edges.push({ from: out.id, to: u.id });

  return { name: spec.name, cols, edges, run: run ?? null };
}

/** A logged run as the map shows it. */
export function mapRunOf(r: Run, steps: MapStep[]): MapRun {
  const mem = r.memory_json;
  const lines = mem ? Object.values(mem.groups).reduce((s, g) => s + g.lines, 0) : 0;
  return {
    status: r.status, trigger: r.trigger, at: `${when(r.started_at)} CT`,
    tokensIn: r.tokens_in, tokensOut: r.tokens_out, costUsd: r.cost_usd,
    memory: mem ? { lines, tokens: mem.tokens } : null,
    steps,
  };
}
