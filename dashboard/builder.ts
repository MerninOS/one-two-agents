import "server-only";
// Data for the agent builder (/build): the agents built in the app, and for one agent everything
// its screens show: the active spec and its versions, the tool list the flow picks from (each tool
// with its connection, docs/builder-flow.md), the Claude models, its standards from the memory
// store, and its latest runs step by step.
import { db } from "@/core/db";
import { BUDGET_CEILING, EFFORTS, RUN_LIMITS, listSpecVersions, loadSpec, readSpec, type AgentSpec, type SpecVersion } from "@/core/agent-spec";
import { SAFETY } from "@/core/runner";
import { TOOL_LIST, TOOLS } from "@/core/tools/catalog";
import { MODEL_LIST } from "@/integrations/models";
import { env } from "@/core/env";
import { when } from "@/dashboard/format";
import { CREW } from "@/dashboard/crew";
import { REBUILT, onRunner } from "@/core/built";
import { activePlaybook, listPlaybooks, pendingPlaybook, playbookHold, stepLabel } from "@/core/playbook";
import { CONNECTIONS, connOf, isSetUp, type ConnId } from "@/dashboard/connections";
import { health } from "@/dashboard/data";

export interface BuildStep {
  idx: number; kind: "model" | "tool" | "stop"; tool: string | null; toolLabel: string | null; input: unknown; output: string | null;
  ok: boolean; numbers: Record<string, number> | null; tokens_in: number; tokens_out: number; cost_usd: number; ms: number;
}
export interface BuildRun { id: string; trigger: string; mode: string | null; started_at: string; ended_at: string | null; status: string; summary: string | null; error: string | null; cost_usd: number; steps: BuildStep[] }
export interface BuildTool { id: string; label: string; detail: string; kind: string; group: string; conn: ConnId; trusted: boolean; connected: boolean; needs: string[]; grantable: boolean; agents: string[] | null }
/** A connection as the flow shows it: plain data, set up or not (no values of keys). */
export interface FlowConn { id: ConnId; name: string; sub: string; icon: string; builtIn: boolean; about: string; setUp: boolean }
export interface BuildModel { id: string; label: string; in: number; out: number }
export interface Standard { id: string; grp: "standing_order" | "crew"; text: string; notionPageId: string | null }
export interface BuiltRow { id: string; name: string; mandate: string; enabled: boolean; budget: number; version: number | null; problems: number; lastRun: { at: string; status: string } | null }

// a tool is Connected when every setting it needs is present (values are never shown)
const SETTING: Record<string, unknown> = {
  SHOPIFY_STORE_DOMAIN: env.shopifyDomain && (env.shopifyAdminToken || (env.shopifyClientId && env.shopifyClientSecret)),
  MERCURY_API_TOKEN: env.mercuryToken, NOTION_TOKEN: env.notionToken,
  SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey,
  RESEND_API_KEY: env.resendKey, BRIEF_FROM: env.briefFrom, BRIEF_TO: env.briefTo,
  GMAIL_CLIENT_ID: env.gmailClientId, GMAIL_CLIENT_SECRET: env.gmailClientSecret, GMAIL_REFRESH_TOKEN: env.gmailRefreshToken,
};
const GRANTABLE = new Set(["read", "calculate", "report", "action"]);

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
  const h = health();
  return {
    tools: TOOL_LIST.map((t): BuildTool => ({ id: t.id, label: t.label, detail: t.detail, kind: t.kind, group: t.group, conn: connOf(t), trusted: t.trusted, needs: [...t.needs], connected: t.needs.every((k) => !!SETTING[k]), grantable: GRANTABLE.has(t.kind), agents: t.agents ? [...t.agents] : null })),
    agentNames: Object.fromEntries(CREW.map((a) => [a.id, `${a.name} (${a.id})`])) as Record<string, string>,
    models: MODEL_LIST.filter((m) => m.route === "anthropic").map((m): BuildModel => ({ id: m.id, label: m.label, in: m.in, out: m.out })),
    efforts: [...EFFORTS],
    limits: RUN_LIMITS,
    budgetCeiling: BUDGET_CEILING,
    safety: SAFETY,
    conns: CONNECTIONS.map((c): FlowConn => ({ id: c.id, name: c.name, sub: c.sub, icon: c.icon, builtIn: c.builtIn, about: c.about, setUp: isSetUp(c, h) })),
  };
}
export type BuilderMenu = ReturnType<typeof builderMenu>;

/** What a new agent can start from: every built agent's active spec, minus actions (the gateway names its agents). */
export async function listTemplates(): Promise<{ id: string; name: string; spec: AgentSpec }[]> {
  const { data, error } = await db().from("agent_defs").select("agent_id, spec").eq("active", true);
  if (error) return [];
  return (data ?? []).map((d) => {
    const { spec } = readSpec(d.spec, d.agent_id as string);
    return { id: d.agent_id as string, name: spec.name, spec: { ...spec, tools: spec.tools.filter((t) => TOOLS[t]?.kind !== "action") } };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

/** Agents a new one may read from: every built agent's output name, and whether it has a finished one. */
export async function listOthers(): Promise<BuilderData["others"]> {
  const [defs, outs] = await Promise.all([
    db().from("agent_defs").select("agent_id, spec").eq("active", true),
    db().from("agent_outputs").select("agent_id, finished").eq("finished", true).limit(500),
  ]);
  const has = new Set((outs.error ? [] : outs.data ?? []).map((o) => o.agent_id as string));
  return (defs.data ?? []).map((d) => {
    const sp = (d.spec ?? {}) as Partial<AgentSpec>;
    return { id: d.agent_id as string, name: sp.name || d.agent_id, outputName: sp.outputName || "result", hasOutput: has.has(d.agent_id as string) };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

type DefRow = { agent_id: unknown; spec: unknown };
/** Agents whose saved spec reads this one's result (agent_output with it picked), for the map's Used by column. */
const usedByOf = (agentId: string, defs: DefRow[]) => defs.filter((d) => d.agent_id !== agentId).flatMap((d) => {
  const { spec } = readSpec(d.spec, d.agent_id as string);
  return spec.tools.includes("agent_output") && spec.readsFrom.some((r) => r.agentId === agentId) ? [{ id: d.agent_id as string, name: spec.name }] : [];
}).sort((x, y) => x.name.localeCompare(y.name));

/** What the agent map needs from the database: the active spec and which agents use its result. Null without a saved spec. */
export async function mapFor(agentId: string): Promise<{ spec: AgentSpec; usedBy: { id: string; name: string }[] } | null> {
  const { data, error } = await db().from("agent_defs").select("agent_id, spec").eq("active", true);
  if (error) return null;
  const mine = (data ?? []).find((d) => d.agent_id === agentId);
  return mine ? { spec: readSpec(mine.spec, agentId).spec, usedBy: usedByOf(agentId, data ?? []) } : null;
}

/** One run's tool calls, for laying the run over the map. Empty for runs of an agent's own code. */
export async function mapSteps(runId: string): Promise<{ kind: string; tool: string | null; ok: boolean; ms: number }[]> {
  const { data, error } = await db().from("run_steps").select("kind, tool, ok, ms").eq("run_id", runId).order("idx");
  return error ? [] : (data ?? []).map((s) => ({ kind: s.kind, tool: s.tool, ok: !!s.ok, ms: Number(s.ms ?? 0) }));
}

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
  usedBy: { id: string; name: string }[];
  lastOutput: { name: string; summary: string; numbers: { label: string; value: number; tool: string }[]; at: string; finished: boolean } | null;
  playbooks: PlaybookView | null;
  /** Morgan, Avery, Rowan and Quinn (slices 6 and 7): whether runs use their own code or the runner. Null for agents built here. */
  engine: { onRunner: boolean } | null;
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
  const engine = REBUILT.has(agentId) ? { onRunner: await onRunner(agentId) } : null;
  const outRows = outs.error ? [] : outs.data ?? [];
  const mine = outRows.find((o) => o.agent_id === agentId);
  return {
    id: a.id, enabled: a.enabled, budget: Number(a.daily_budget_usd), active, versions, standards: st, runs: rs,
    spentToday: (spent.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0),
    others: (defs.data ?? []).map((d) => {
      const sp = (d.spec ?? {}) as Partial<AgentSpec>;
      return { id: d.agent_id as string, name: sp.name || d.agent_id, outputName: sp.outputName || "result", hasOutput: outRows.some((o) => o.agent_id === d.agent_id && o.finished) };
    }).sort((x, y) => x.name.localeCompare(y.name)),
    usedBy: usedByOf(agentId, defs.data ?? []),
    playbooks, engine,
    lastOutput: mine ? { name: mine.name, summary: mine.summary, numbers: (Array.isArray(mine.numbers) ? mine.numbers : []) as { label: string; value: number; tool: string }[], at: when(mine.created_at), finished: mine.finished } : null,
  };
}
