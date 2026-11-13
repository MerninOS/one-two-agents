import "server-only";
// Data for the agent builder (/build, docs/agent-builder.md slice 2): the agents built in the app,
// and for one agent everything its builder screen shows: the active spec and its versions, the
// tool list it can pick from, the Claude models, its standards from the memory store, and its
// latest runs step by step.
import { db } from "@/core/db";
import { BUDGET_CEILING, EFFORTS, RUN_LIMITS, listSpecVersions, loadSpec, type AgentSpec, type SpecVersion } from "@/core/agent-spec";
import { SAFETY } from "@/core/runner";
import { TOOL_LIST, TOOLS } from "@/core/tools/catalog";
import { MODEL_LIST } from "@/integrations/models";
import { env } from "@/core/env";
import { when } from "@/dashboard/format";
import { CREW } from "@/dashboard/crew";
import { activePlaybook, listPlaybooks, pendingPlaybook, playbookHold, stepLabel } from "@/core/playbook";

export interface BuildStep {
  idx: number; kind: "model" | "tool" | "stop"; tool: string | null; toolLabel: string | null; input: unknown; output: string | null;
  ok: boolean; numbers: Record<string, number> | null; tokens_in: number; tokens_out: number; cost_usd: number; ms: number;
}
export interface BuildRun { id: string; trigger: string; mode: string | null; started_at: string; ended_at: string | null; status: string; summary: string | null; error: string | null; cost_usd: number; steps: BuildStep[] }
export interface BuildTool { id: string; label: string; detail: string; kind: string; group: string; trusted: boolean; connected: boolean; needs: string[]; grantable: boolean; agents: string[] | null }
export interface BuildModel { id: string; label: string; in: number; out: number }
export interface Standard { id: string; grp: "standing_order" | "crew"; text: string; notionPageId: string | null }
export interface BuiltRow { id: string; name: string; mandate: string; enabled: boolean; budget: number; version: number | null; problems: number; lastRun: { at: string; status: string } | null }

// a tool is Connected when every setting it needs is present (values are never shown)
const SETTING: Record<string, unknown> = {
  SHOPIFY_STORE_DOMAIN: env.shopifyDomain && (env.shopifyAdminToken || (env.shopifyClientId && env.shopifyClientSecret)),
  MERCURY_API_TOKEN: env.mercuryToken, NOTION_TOKEN: env.notionToken,
  SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey,
  RESEND_API_KEY: env.resendKey, BRIEF_FROM: env.briefFrom, BRIEF_TO: env.briefTo,
};
const GRANTABLE = new Set(["read", "calculate", "report", "action"]);

export const GROUP_LABEL: Record<string, string> = {
  shopify: "Shopify", calculate: "Calculate (plain code, no model)", mercury: "Mercury", supabase: "Control Room data", agents: "Other agents’ outputs", notion: "Notion", email: "Email to Zak", web: "Web", gmail: "Gmail",
};

/** Null when the runner migration isn't applied yet. */
export async function listBuilt(): Promise<BuiltRow[] | null> {
  const { data: defs, error } = await db().from("agent_defs").select("agent_id, version, spec").eq("active", true);
  if (error) return null;
  const ids = (defs ?? []).map((d) => d.agent_id as string);
  if (!ids.length) return [];
  const [{ data: rows }, { data: runs }] = await Promise.all([
    db().from("agents").select("id, name, enabled, daily_budget_usd").in("id", ids),
    db().from("agent_runs").select("agent_id, started_at, status").in("agent_id", ids).order("started_at", { ascending: false }).limit(200),
  ]);
  return (rows ?? []).map((a) => {
    const d = defs!.find((x) => x.agent_id === a.id);
    const spec = (d?.spec ?? {}) as Partial<AgentSpec>;
    const last = (runs ?? []).find((r) => r.agent_id === a.id);
    return { id: a.id, name: spec.name || a.name, mandate: spec.mandate ?? "", enabled: a.enabled, budget: Number(a.daily_budget_usd), version: d?.version ?? null, problems: 0, lastRun: last ? { at: last.started_at, status: last.status } : null };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

/** The pick-lists the builder offers, all from code. */
export function builderMenu() {
  return {
    tools: TOOL_LIST.map((t): BuildTool => ({ id: t.id, label: t.label, detail: t.detail, kind: t.kind, group: t.group, trusted: t.trusted, needs: [...t.needs], connected: t.needs.every((k) => !!SETTING[k]), grantable: GRANTABLE.has(t.kind), agents: t.agents ? [...t.agents] : null })),
    agentNames: Object.fromEntries(CREW.map((a) => [a.id, `${a.name} (${a.id})`])) as Record<string, string>,
    models: MODEL_LIST.filter((m) => m.route === "anthropic").map((m): BuildModel => ({ id: m.id, label: m.label, in: m.in, out: m.out })),
    efforts: [...EFFORTS],
    limits: RUN_LIMITS,
    budgetCeiling: BUDGET_CEILING,
    safety: SAFETY,
  };
}
export type BuilderMenu = ReturnType<typeof builderMenu>;

async function standards(agentId: string): Promise<Standard[]> {
  const { data, error } = await db().from("agent_memory").select("id, grp, text, notion_page_id, agent_id").or(`agent_id.eq.${agentId},agent_id.is.null`).eq("state", "kept").in("grp", ["standing_order", "crew"]).order("created_at", { ascending: true }).limit(100);
  if (error) return [];
  return (data ?? []).map((r) => ({ id: r.id, grp: r.grp, text: r.text, notionPageId: r.notion_page_id }));
}

async function runs(agentId: string): Promise<BuildRun[]> {
  const { data: rs } = await db().from("agent_runs").select("id, trigger, started_at, ended_at, status, summary, error, cost_usd, metrics").eq("agent_id", agentId).order("started_at", { ascending: false }).limit(5);
  const runIds = (rs ?? []).map((r) => r.id);
  const { data: steps } = runIds.length ? await db().from("run_steps").select("run_id, idx, kind, tool, input, output, ok, numbers, tokens_in, tokens_out, cost_usd, ms").in("run_id", runIds).order("idx") : { data: [] };
  return (rs ?? []).map(({ metrics, ...r }) => ({
    ...r, cost_usd: Number(r.cost_usd),
    mode: (() => { const m = (metrics ?? {}) as Record<string, number>; return m.playbook ? "followed playbook" : m.fell_back ? "fell back to exploring" : "finished" in m ? "explored" : null; })(),
    steps: (steps ?? []).filter((s) => s.run_id === r.id).map((s) => ({ ...s, cost_usd: Number(s.cost_usd), toolLabel: s.tool ? TOOLS[s.tool]?.label ?? s.tool : null })) as BuildStep[],
  }));
}

export interface BuilderData {
  id: string; enabled: boolean; budget: number; active: SpecVersion | null;
  versions: (SpecVersion & { active: boolean; createdBy: string })[];
  standards: Standard[]; runs: BuildRun[]; spentToday: number;
  others: { id: string; name: string; outputName: string; hasOutput: boolean }[];
  lastOutput: { name: string; summary: string; numbers: { label: string; value: number; tool: string }[]; at: string; finished: boolean } | null;
  playbooks: PlaybookView | null;
}

export interface PlaybookRow { id: number; version: number; status: string; steps: string[]; changes: string | null; auto: boolean; when: string }
export interface PlaybookView { active: PlaybookRow | null; pending: PlaybookRow | null; history: PlaybookRow[]; hold: string | null }

/** Null when the playbook migration isn't applied yet. */
async function playbookView(agentId: string): Promise<PlaybookView | null> {
  try {
    const [all, hold] = await Promise.all([listPlaybooks(agentId), playbookHold(agentId)]);
    const view = (p: (typeof all)[number]): PlaybookRow => ({ id: p.id, version: p.version, status: p.status, steps: p.steps.map(stepLabel), changes: p.changes, auto: p.auto, when: when(p.decidedAt ?? p.createdAt) });
    const a = activePlaybook(all), q = pendingPlaybook(all);
    return { active: a && view(a), pending: q && view(q), history: all.map(view), hold: hold?.reason ?? null };
  } catch { return null; }
}

/** Null when the agent isn't one built in the app. */
export async function getBuilder(agentId: string): Promise<BuilderData | null> {
  const { data: a } = await db().from("agents").select("id, enabled, daily_budget_usd").eq("id", agentId).maybeSingle();
  if (!a) return null;
  const versions = await listSpecVersions(agentId);
  if (!versions.length) return null;
  const since = new Date(Date.now() - 864e5).toISOString();
  const [active, st, rs, spent, defs, outs, playbooks] = await Promise.all([
    loadSpec(agentId), standards(agentId), runs(agentId),
    db().from("agent_runs").select("cost_usd").eq("agent_id", agentId).gte("started_at", since),
    db().from("agent_defs").select("agent_id, spec").eq("active", true).neq("agent_id", agentId),
    db().from("agent_outputs").select("agent_id, name, summary, numbers, created_at, finished").order("created_at", { ascending: false }).limit(200),
    playbookView(agentId),
  ]);
  const outRows = outs.error ? [] : outs.data ?? [];
  const mine = outRows.find((o) => o.agent_id === agentId);
  return {
    id: a.id, enabled: a.enabled, budget: Number(a.daily_budget_usd), active, versions, standards: st, runs: rs,
    spentToday: (spent.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0),
    others: (defs.data ?? []).map((d) => {
      const sp = (d.spec ?? {}) as Partial<AgentSpec>;
      return { id: d.agent_id as string, name: sp.name || d.agent_id, outputName: sp.outputName || "result", hasOutput: outRows.some((o) => o.agent_id === d.agent_id && o.finished) };
    }).sort((x, y) => x.name.localeCompare(y.name)),
    playbooks,
    lastOutput: mine ? { name: mine.name, summary: mine.summary, numbers: (Array.isArray(mine.numbers) ? mine.numbers : []) as { label: string; value: number; tool: string }[], at: when(mine.created_at), finished: mine.finished } : null,
  };
}
