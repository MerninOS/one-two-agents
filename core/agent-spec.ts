import "server-only";
// An agent built in the app is a saved spec (docs/agent-builder.md): what it is for, its
// directive, which Claude model thinks, the tools it may call and its hard limits. The spec only
// picks from things in code (the tool list, the model list, the limits below), so a spec is
// choices, never authority: it can make an agent smaller, never give it a new ability.
import { db } from "@/core/db";
import { modelDef } from "@/integrations/models";
import { TOOLS } from "@/core/tools/catalog";

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Hard limits per run. A spec picks at or under the ceiling; code stops the run there (Zak, Nov 13). */
export const RUN_LIMITS = {
  maxSteps: { default: 12, min: 1, max: 30 },
  maxCostUsd: { default: 0.5, min: 0.01, max: 2 },
} as const;

/** Every kind can be granted since slice 5; actions still pass the gateway's own allow-list. */
const GRANTABLE_KINDS = new Set(["read", "calculate", "report", "action"]);

export interface AgentSpec {
  name: string;
  mandate: string;
  directive: string;
  goodResult: string;
  model: string;
  effort: Effort;
  tools: string[];
  /** Pages notion_read_page may open, picked in the app from pages the Notion integration can see. */
  notionPages: { id: string; label: string }[];
  limits: { maxSteps: number; maxCostUsd: number };
  /** What each run's result is called when other agents read it (outputs as sources, slice 3). */
  outputName: string;
  /** Agents whose latest output agent_output may read, picked in the builder. */
  readsFrom: { agentId: string; label: string }[];
  /** The Notion page report_notion_page writes under (slice 5), picked in the builder. */
  reportPage: { id: string; label: string } | null;
}

export const MAX_DIRECTIVE = 4000;

/** Claude models only (Zak, Nov 12): no AI Gateway route for a built agent. */
export const specModelOk = (id: string) => modelDef(id)?.route === "anthropic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const NOTION_ID = /^[0-9a-f]{32}$/;
const AGENT_ID = /^[a-z0-9_]{1,60}$/;

/**
 * A stored or drafted spec, checked against what code offers. Anything it asks for that code
 * doesn't offer is left out and named in `problems`; limits above the ceiling are refused, not
 * clamped, so a run never uses a value Zak didn't pick.
 */
export function readSpec(raw: unknown, agentId?: string): { spec: AgentSpec; problems: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const name = str(r.name, 80) || "Untitled agent";
  const directive = str(r.directive, MAX_DIRECTIVE);
  if (!directive) problems.push("the directive is empty");
  let model = str(r.model, 80);
  if (!specModelOk(model)) { problems.push(`${model || "no model"} is not a Claude model on the list`); model = "claude-haiku-5-5"; }
  const effort = (EFFORTS as readonly string[]).includes(r.effort as string) ? (r.effort as Effort) : "low";
  const tools: string[] = [];
  for (const id of Array.isArray(r.tools) ? r.tools : []) {
    const t = typeof id === "string" ? TOOLS[id] : undefined;
    if (!t) { problems.push(`tool "${String(id).slice(0, 40)}" is not on the tool list`); continue; }
    if (!GRANTABLE_KINDS.has(t.kind)) { problems.push(`${t.label} is a ${t.kind} tool, not available yet`); continue; }
    if (t.kind === "action" && agentId && !t.agents?.includes(agentId)) { problems.push(`${t.label}: the gateway lets only ${t.agents?.join(" and ") ?? "no agent"} use it`); continue; }
    if (!tools.includes(t.id)) tools.push(t.id);
  }
  const notionPages = (Array.isArray(r.notionPages) ? r.notionPages : []).flatMap((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    const id = str(x.id, 40).replace(/-/g, "");
    if (!NOTION_ID.test(id)) { problems.push("a Notion page id is not valid"); return []; }
    return [{ id, label: str(x.label, 80) || "Notion page" }];
  }).slice(0, 10);
  if (tools.includes("notion_read_page") && !notionPages.length) problems.push("Read a Notion page is granted but no page is listed");
  const readsFrom = (Array.isArray(r.readsFrom) ? r.readsFrom : []).flatMap((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    const agentId = str(x.agentId, 60);
    if (!AGENT_ID.test(agentId)) { problems.push("an agent to read from is not valid"); return []; }
    return [{ agentId, label: str(x.label, 80) || agentId }];
  }).filter((x, i, a) => a.findIndex((y) => y.agentId === x.agentId) === i).slice(0, 10);
  if (tools.includes("agent_output") && !readsFrom.length) problems.push("Read another agent's output is granted but no agent is picked");
  const rp = (r.reportPage ?? null) as Record<string, unknown> | null;
  let reportPage: AgentSpec["reportPage"] = null;
  if (rp) {
    const id = str(rp.id, 40).replace(/-/g, "");
    if (NOTION_ID.test(id)) reportPage = { id, label: str(rp.label, 80) || "Notion page" };
    else problems.push("the Notion page to write under is not valid");
  }
  if (tools.includes("report_notion_page") && !reportPage) problems.push("Write a Notion page is ticked but no page to write under is picked");
  const lim = (r.limits ?? {}) as Record<string, unknown>;
  const limit = (k: keyof typeof RUN_LIMITS) => {
    const c = RUN_LIMITS[k], v = lim[k] === undefined ? c.default : Number(lim[k]);
    if (!Number.isFinite(v) || v < c.min || v > c.max) { problems.push(`${k} must be from ${c.min} to ${c.max}`); return c.default; }
    return k === "maxSteps" ? Math.floor(v) : v;
  };
  return {
    spec: { name, mandate: str(r.mandate, 200), directive, goodResult: str(r.goodResult, 1000), model, effort, tools, notionPages, limits: { maxSteps: limit("maxSteps"), maxCostUsd: limit("maxCostUsd") }, outputName: str(r.outputName, 60) || "result", readsFrom, reportPage },
    problems,
  };
}

export interface SpecVersion { agentId: string; version: number; spec: AgentSpec; problems: string[]; note: string | null; createdAt: string }

/** The active spec for a built agent, or null when it has none. Throws when the table can't be read. */
export async function loadSpec(agentId: string): Promise<SpecVersion | null> {
  const { data, error } = await db().from("agent_defs").select("agent_id, version, spec, note, created_at").eq("agent_id", agentId).eq("active", true).maybeSingle();
  if (error) throw new Error(`Agent specs: ${error.message}`);
  if (!data) return null;
  const { spec, problems } = readSpec(data.spec, agentId);
  return { agentId, version: data.version, spec, problems, note: data.note, createdAt: data.created_at };
}

// ---- Versions (builder screen, slice 2). Saving never edits a version: it adds the next one and
// makes it active, so every run can be traced to the exact spec it used, and any version can be
// made active again.

/** Daily budget ceiling for any agent, the same as setBudget for the hand-built agents. */
export const BUDGET_CEILING = 50;

/** Every version of a built agent's spec, newest first. */
export async function listSpecVersions(agentId: string): Promise<(SpecVersion & { active: boolean; createdBy: string })[]> {
  const { data, error } = await db().from("agent_defs").select("version, spec, note, created_by, created_at, active").eq("agent_id", agentId).order("version", { ascending: false }).limit(50);
  if (error) throw new Error(`Agent specs: ${error.message}`);
  return (data ?? []).map((d) => ({ agentId, version: d.version, ...readSpec(d.spec, agentId), note: d.note, createdAt: d.created_at, active: d.active, createdBy: d.created_by }));
}

/**
 * Plain-words list of what lets `next` do more than `now`: spend more per run, or (slice 5) reach
 * further with a report or action tool it didn't have. Empty when it can't.
 */
export function specLooser(now: AgentSpec | null, next: AgentSpec): string[] {
  if (!now) return [];
  const out: string[] = [];
  for (const id of next.tools) {
    const t = TOOLS[id];
    if (t && (t.kind === "report" || t.kind === "action") && !now.tools.includes(id)) out.push(`adds ${t.kind === "action" ? "the action" : "the report"} “${t.label}”`);
  }
  if (next.tools.includes("report_notion_page") && now.tools.includes("report_notion_page") && next.reportPage?.id !== now.reportPage?.id) out.push(`writes to a different Notion page (${next.reportPage?.label ?? "none"})`);
  if (next.limits.maxCostUsd > now.limits.maxCostUsd) out.push(`cost per run goes from $${now.limits.maxCostUsd.toFixed(2)} to $${next.limits.maxCostUsd.toFixed(2)}`);
  if (next.limits.maxSteps > now.limits.maxSteps) out.push(`steps per run go from ${now.limits.maxSteps} to ${next.limits.maxSteps}`);
  return out;
}

async function activate(agentId: string, version: number) {
  // the partial unique index allows one active row, so the old one goes off first
  const off = await db().from("agent_defs").update({ active: false }).eq("agent_id", agentId).eq("active", true).neq("version", version);
  if (off.error) throw new Error(off.error.message);
  const on = await db().from("agent_defs").update({ active: true }).eq("agent_id", agentId).eq("version", version);
  if (on.error) throw new Error(on.error.message);
}

/** Saves a checked spec as the next version and makes it active. Returns the new version number. */
export async function saveSpecVersion(agentId: string, spec: AgentSpec, note: string, by: string): Promise<number> {
  const { data: top, error } = await db().from("agent_defs").select("version").eq("agent_id", agentId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const version = (top?.version ?? 0) + 1;
  const ins = await db().from("agent_defs").insert({ agent_id: agentId, version, spec, note: note || null, created_by: by, active: false });
  if (ins.error) throw new Error(ins.error.message);
  await activate(agentId, version);
  // the agents row keeps a readable name and model for the run log
  await db().from("agents").update({ name: spec.name, model: spec.model }).eq("id", agentId);
  return version;
}

/** Makes an earlier version active again. */
export async function activateSpecVersion(agentId: string, version: number) {
  const { data, error } = await db().from("agent_defs").select("version, spec").eq("agent_id", agentId).eq("version", version).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`There is no v${version}.`);
  await activate(agentId, version);
  const { spec } = readSpec(data.spec);
  await db().from("agents").update({ name: spec.name, model: spec.model }).eq("id", agentId);
}

/** A new agent id from its name: "b_" and lowercase words joined by underscores, never one already taken. */
export async function newAgentId(name: string): Promise<string> {
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = `b_${words || "agent"}`.slice(0, 40).replace(/_+$/, "");
  const { data, error } = await db().from("agents").select("id").like("id", `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set((data ?? []).map((r) => r.id as string));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  throw new Error("Too many agents with that name.");
}

/** Creates a built agent: off duty, $1 a day, no schedule, with the given spec as v1. */
export async function createBuiltAgent(spec: AgentSpec, by: string): Promise<string> {
  const id = await newAgentId(spec.name);
  const a = await db().from("agents").insert({ id, name: spec.name, model: spec.model, schedule: null, enabled: false, daily_budget_usd: 1 });
  if (a.error) throw new Error(a.error.message);
  const d = await db().from("agent_defs").insert({ agent_id: id, version: 1, spec, note: "Created in the builder", created_by: by, active: true });
  if (d.error) throw new Error(`The agent was created but its spec wasn’t saved: ${d.error.message}`);
  return id;
}
