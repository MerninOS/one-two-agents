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

/** Slice 1 grants Read and Calculate tools only; Report and Action tools arrive with slice 5. */
const GRANTABLE_KINDS = new Set(["read", "calculate"]);

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
}

export const MAX_DIRECTIVE = 4000;

/** Claude models only (Zak, Nov 12): no AI Gateway route for a built agent. */
export const specModelOk = (id: string) => modelDef(id)?.route === "anthropic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const NOTION_ID = /^[0-9a-f]{32}$/;

/**
 * A stored or drafted spec, checked against what code offers. Anything it asks for that code
 * doesn't offer is left out and named in `problems`; limits above the ceiling are refused, not
 * clamped, so a run never uses a value Zak didn't pick.
 */
export function readSpec(raw: unknown): { spec: AgentSpec; problems: string[] } {
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
    if (!tools.includes(t.id)) tools.push(t.id);
  }
  const notionPages = (Array.isArray(r.notionPages) ? r.notionPages : []).flatMap((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    const id = str(x.id, 40).replace(/-/g, "");
    if (!NOTION_ID.test(id)) { problems.push("a Notion page id is not valid"); return []; }
    return [{ id, label: str(x.label, 80) || "Notion page" }];
  }).slice(0, 10);
  if (tools.includes("notion_read_page") && !notionPages.length) problems.push("Read a Notion page is granted but no page is listed");
  const lim = (r.limits ?? {}) as Record<string, unknown>;
  const limit = (k: keyof typeof RUN_LIMITS) => {
    const c = RUN_LIMITS[k], v = lim[k] === undefined ? c.default : Number(lim[k]);
    if (!Number.isFinite(v) || v < c.min || v > c.max) { problems.push(`${k} must be from ${c.min} to ${c.max}`); return c.default; }
    return k === "maxSteps" ? Math.floor(v) : v;
  };
  return {
    spec: { name, mandate: str(r.mandate, 200), directive, goodResult: str(r.goodResult, 1000), model, effort, tools, notionPages, limits: { maxSteps: limit("maxSteps"), maxCostUsd: limit("maxCostUsd") } },
    problems,
  };
}

export interface SpecVersion { agentId: string; version: number; spec: AgentSpec; problems: string[]; note: string | null; createdAt: string }

/** The active spec for a built agent, or null when it has none. Throws when the table can't be read. */
export async function loadSpec(agentId: string): Promise<SpecVersion | null> {
  const { data, error } = await db().from("agent_defs").select("agent_id, version, spec, note, created_at").eq("agent_id", agentId).eq("active", true).maybeSingle();
  if (error) throw new Error(`Agent specs: ${error.message}`);
  if (!data) return null;
  const { spec, problems } = readSpec(data.spec);
  return { agentId, version: data.version, spec, problems, note: data.note, createdAt: data.created_at };
}
