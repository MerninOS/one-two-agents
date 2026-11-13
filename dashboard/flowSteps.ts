// The builder flow's steps (docs/builder-flow.md, slice 2), as plain data and pure helpers shared by
// the flow (components/Flow.tsx) and the agent's builder page. The flow is built from STEPS, so a
// step can be added later (a Team step for departments and who an agent reports to) without
// reworking the shell. Nothing here decides what an agent may do: the server checks every draft
// against code again (core/agent-spec.ts readSpec).
import type { AgentSpec, Effort } from "@/core/agent-spec";
import type { BuilderMenu, FlowConn } from "./builder";

export const STEPS = [
  { key: "job", title: "The job" },
  { key: "connections", title: "Connections" },
  { key: "hands", title: "Hands you" },
  { key: "brain", title: "Brain and budget" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
/** Steps 5 and 6 (Try it, Go live) come in slice 4; the progress bar already counts them. */
export const AFTER_STEPS = ["Try it", "Go live"] as const;
export const TOTAL_STEPS = STEPS.length + AFTER_STEPS.length;
export const stepIndex = (k: string | undefined) => Math.max(0, STEPS.findIndex((s) => s.key === k));

export type Tool = BuilderMenu["tools"][number];
export type Model = BuilderMenu["models"][number];
export type Ability = "read" | "do" | "hands";
export const abilityOf = (t: Pick<Tool, "kind">): Ability => (t.kind === "action" ? "do" : t.kind === "report" ? "hands" : "read");

export const money = (v: number) => (v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

const OUT_TOKENS: Record<Effort, number> = { low: 500, medium: 900, high: 1500 };

/** A rough guide to one run's cost: a turn per tool call plus a wrap-up, each turn re-reading what came before. */
export function estimate(spec: Pick<AgentSpec, "model" | "effort" | "tools" | "limits">, models: Model[]): number | null {
  const m = models.find((x) => x.id === spec.model);
  if (!m) return null;
  const turns = Math.min(spec.limits.maxSteps, Math.max(1, spec.tools.length)) + 1;
  let usd = 0;
  for (let i = 0; i < turns; i++) usd += (2500 + 1200 * i) * m.in + OUT_TOKENS[spec.effort] * m.out;
  return Math.min(usd, spec.limits.maxCostUsd);
}

export interface Preset { key: "quick" | "balanced" | "deep"; label: string; about: string; model: string; effort: Effort; recommended?: boolean }

/** Quick, Balanced and Deep: the cheapest, middle and priciest Claude model on the list, with matching effort. */
export function presets(models: Model[]): Preset[] {
  const m = [...models].sort((a, b) => a.out - b.out);
  if (!m.length) return [];
  return [
    { key: "quick", label: "Quick", about: "Fine for sorting and simple summaries.", model: m[0].id, effort: "low" },
    { key: "balanced", label: "Balanced", about: "Good at weighing a few things and picking one focus.", model: m[Math.min(1, m.length - 1)].id, effort: "medium", recommended: true },
    { key: "deep", label: "Deep", about: "For research and judgment calls across many sources.", model: m[m.length - 1].id, effort: "high" },
  ];
}
export const presetOf = (d: Pick<AgentSpec, "model" | "effort">, models: Model[]) => presets(models).find((p) => p.model === d.model && p.effort === d.effort) ?? null;

export const blankSpec = (menu: BuilderMenu, name = "New agent"): AgentSpec => {
  const bal = presets(menu.models).find((p) => p.key === "balanced");
  return { name, mandate: "", directive: "", goodResult: "", model: bal?.model ?? menu.models[0]?.id ?? "", effort: bal?.effort ?? "low", tools: [], notionPages: [], limits: { maxSteps: menu.limits.maxSteps.default, maxCostUsd: menu.limits.maxCostUsd.default }, outputName: "result", readsFrom: [], reportPage: null };
};

/** Why the gateway won't let this agent ask for an action, or null when it may. */
export function blockedFor(t: Tool, agentId: string | null, menu: BuilderMenu): string | null {
  if (!t.agents) return null;
  if (agentId && t.agents.includes(agentId)) return null;
  return `Only ${t.agents.map((a) => menu.agentNames[a] ?? a).join(" and ")} may ask for this. That rule is in code.`;
}

export interface Problem { step: StepKey; text: string }

/** What stops a save, each on the step where it is fixed. The server checks all of it again. */
export function problemsOf(d: AgentSpec, menu: BuilderMenu): Problem[] {
  const L = menu.limits;
  const out: Problem[] = [];
  if (!d.name.trim()) out.push({ step: "job", text: "give it a name" });
  if (!d.directive.trim()) out.push({ step: "job", text: "write its job" });
  if (d.tools.includes("notion_read_page") && !d.notionPages.length) out.push({ step: "connections", text: "add a Notion page it may open, or untick Read a Notion page" });
  if (d.tools.includes("agent_output") && !d.readsFrom.length) out.push({ step: "connections", text: "pick an agent to read from, or untick it" });
  if (d.tools.includes("report_notion_page") && !d.reportPage) out.push({ step: "hands", text: "pick the Notion page to write under, or untick Write a Notion page" });
  if (!(Number.isInteger(d.limits.maxSteps) && d.limits.maxSteps >= L.maxSteps.min && d.limits.maxSteps <= L.maxSteps.max)) out.push({ step: "brain", text: `the step limit must be from ${L.maxSteps.min} to ${L.maxSteps.max}` });
  if (!(Number.isFinite(d.limits.maxCostUsd) && d.limits.maxCostUsd >= L.maxCostUsd.min && d.limits.maxCostUsd <= L.maxCostUsd.max)) out.push({ step: "brain", text: `the cost per run must be from $${L.maxCostUsd.min} to $${L.maxCostUsd.max}` });
  return out;
}

/** What lets the draft do more than the saved version (the same list the server checks before saving). */
export function looserThan(saved: AgentSpec | null, d: AgentSpec, menu: BuilderMenu): string[] {
  if (!saved) return [];
  const tool = (id: string) => menu.tools.find((t) => t.id === id);
  return [
    ...d.tools.filter((id) => !saved.tools.includes(id)).map(tool).filter((t) => t && (t.kind === "report" || t.kind === "action")).map((t) => `adds ${t!.kind === "action" ? "the action" : "the report"} “${t!.label}”`),
    d.tools.includes("report_notion_page") && saved.tools.includes("report_notion_page") && d.reportPage?.id !== saved.reportPage?.id && `writes to a different Notion page (${d.reportPage?.label ?? "none"})`,
    d.limits.maxCostUsd > saved.limits.maxCostUsd && `cost per run goes from $${saved.limits.maxCostUsd.toFixed(2)} to $${d.limits.maxCostUsd.toFixed(2)}`,
    d.limits.maxSteps > saved.limits.maxSteps && `the step limit goes from ${saved.limits.maxSteps} to ${d.limits.maxSteps}`,
  ].filter(Boolean) as string[];
}

/** Which steps a draft changes, for the version note. */
export function changedSteps(saved: AgentSpec | null, d: AgentSpec, menu: BuilderMenu): StepKey[] {
  if (!saved) return [];
  const pick = (s: AgentSpec, ab: Ability[]) => s.tools.filter((id) => { const t = menu.tools.find((x) => x.id === id); return t && ab.includes(abilityOf(t)); }).sort().join();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const out: StepKey[] = [];
  if (!same([saved.name, saved.mandate, saved.directive, saved.goodResult], [d.name, d.mandate, d.directive, d.goodResult])) out.push("job");
  if (pick(saved, ["read", "do"]) !== pick(d, ["read", "do"]) || !same(saved.notionPages, d.notionPages) || !same(saved.readsFrom, d.readsFrom)) out.push("connections");
  if (pick(saved, ["hands"]) !== pick(d, ["hands"]) || saved.outputName !== d.outputName || !same(saved.reportPage, d.reportPage)) out.push("hands");
  if (!same([saved.model, saved.effort, saved.limits], [d.model, d.effort, d.limits])) out.push("brain");
  return out;
}

export interface Chip { label: string; tone: "read" | "do" | "hands" | "plain" }
export interface StepSummary { line: string; chips: Chip[] }

/** The "so far" rail: one line and a few chips per step. */
export function summarize(d: AgentSpec, menu: BuilderMenu): Record<StepKey, StepSummary> {
  const tools = d.tools.map((id) => menu.tools.find((t) => t.id === id)).filter(Boolean) as Tool[];
  const conn = (id: FlowConn["id"]) => menu.conns.find((c) => c.id === id)?.name ?? id;
  const per = new Map<string, { n: number; asks: boolean }>();
  for (const t of tools) {
    if (abilityOf(t) === "hands") continue;
    const cur = per.get(t.conn) ?? { n: 0, asks: false };
    cur.n++; if (abilityOf(t) === "do") cur.asks = true;
    per.set(t.conn, cur);
  }
  const reads: Chip[] = [...per].map(([c, v]) => ({ label: `${conn(c as FlowConn["id"])} · ${v.n}${v.asks ? " · asks first" : ""}`, tone: v.asks ? "do" : "read" }));
  for (const r of d.readsFrom) reads.push({ label: r.label.split(":")[0], tone: "plain" });
  const hands = tools.filter((t) => abilityOf(t) === "hands");
  const pr = presetOf(d, menu.models);
  const model = menu.models.find((m) => m.id === d.model);
  const est = estimate(d, menu.models);
  const job = d.mandate.trim() || d.directive.trim();
  return {
    job: { line: job ? (job.length > 70 ? `${job.slice(0, 68)}…` : job) : "Not written yet", chips: [] },
    connections: { line: per.size ? `Looks at ${per.size} place${per.size === 1 ? "" : "s"}` : "Nothing picked yet", chips: reads },
    hands: { line: hands.length ? hands.map((t) => t.label).join(" + ") : "Saved for other agents only", chips: [...hands.map((t): Chip => ({ label: t.label, tone: "hands" })), { label: `Saves “${d.outputName || "result"}”`, tone: "plain" }] },
    brain: { line: `${pr?.label ?? model?.label ?? d.model}${pr ? "" : `, ${d.effort}`} · about ${est == null ? "?" : money(est)} a run, never over $${d.limits.maxCostUsd.toFixed(2)}`, chips: [] },
  };
}

/** How done the current step looks, 0 to 1, for the progress bar. */
export function stepFill(k: StepKey, d: AgentSpec, menu: BuilderMenu): number {
  if (k === "job") return [d.name, d.directive, d.goodResult].filter((x) => x.trim()).length / 3;
  if (k === "connections") return d.tools.some((id) => { const t = menu.tools.find((x) => x.id === id); return t && abilityOf(t) !== "hands"; }) ? 1 : 0.15;
  if (k === "hands") return d.tools.some((id) => menu.tools.find((x) => x.id === id)?.kind === "report") ? 1 : 0.6;
  return 1;
}
