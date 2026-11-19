import "server-only";
// Data for the agent builder (/build): the agents built in the app, and for one agent everything
// its screens show: the active spec and its versions, the tool list the flow picks from (each tool
// with its connection, docs/builder-flow.md), the Claude models, its standards from the memory
// store, and its latest runs step by step.
import { db } from "@/core/db";
import { agentDepartment } from "@/core/org";
import { BUDGET_CEILING, EFFORTS, RUN_LIMITS, draftOf, listSpecVersions, loadSpec, readSpec, type AgentSpec, type SpecVersion } from "@/core/agent-spec";
import { SAFETY } from "@/core/runner";
import { TOOL_LIST, TOOLS } from "@/core/tools/catalog";
import { MODEL_LIST } from "@/integrations/models";
import { env } from "@/core/env";
import { when } from "@/dashboard/format";
import { activePlaybook, listPlaybooks, pendingPlaybook, playbookHold, stepLabel } from "@/core/playbook";
import { CONNECTIONS, connOf, isSetUp, type ConnId, type CustomConnId } from "@/dashboard/connections";
import { customMenu } from "@/core/tools/custom";
import { CUSTOM_WARNING } from "@/core/custom-mcp-rules";
import { health } from "@/dashboard/data";
import type { IntegrationId } from "@/dashboard/crew";

export interface BuildTool { id: string; label: string; detail: string; kind: string; group: string; conn: ConnId | CustomConnId; trusted: boolean; connected: boolean; needs: string[]; grantable: boolean; agents: string[] | null; seat: "team" | "company" | "head" | null }
/** A connection as the flow shows it: plain data, set up or not (no values of keys). */
export interface FlowConn { id: ConnId | CustomConnId; name: string; sub: string; icon: string; builtIn: boolean; about: string; setUp: boolean; custom?: boolean }
/** Servers the owner added and their turned-on tools, as the builder offers them (docs/custom-servers.md, slice 2). */
export interface CustomMenu { tools: BuildTool[]; conns: FlowConn[] }
export interface BuildModel { id: string; label: string; in: number; out: number }
export interface Standard { id: string; grp: "standing_order" | "crew" | "department"; text: string; notionPageId: string | null }
export interface BuiltRow { id: string; name: string; mandate: string; enabled: boolean; budget: number; version: number | null; problems: number; lastRun: { at: string; status: string } | null }

// a tool is Connected when every setting it needs is present (values are never shown)
const SETTINGS: Record<string, unknown> = {
  SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey,
  RESEND_API_KEY: env.resendKey, BRIEF_FROM: env.briefFrom,
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

/**
 * The tools turned on on servers the owner added, each server as a connection of its own. No
 * network: whether a server is ready is its row's state; the tool check runs before every run.
 */
export async function customMenuFor(): Promise<CustomMenu> {
  const servers = await customMenu().catch(() => []);
  return {
    conns: servers.map(({ server: c, setUp, why }): FlowConn => ({
      id: c.id as CustomConnId, name: c.name, sub: why ?? "A server you added", icon: "plug", builtIn: false, custom: true, setUp,
      about: `${new URL(c.url).host}. ${CUSTOM_WARNING} Only the tools you turned on on Connections show here, and they only read.`,
    })),
    tools: servers.flatMap(({ server: c, setUp, tools }) => tools.map((t): BuildTool => ({
      id: t.id, label: t.label, detail: t.detail, kind: "read", group: "custom", conn: c.id as CustomConnId, trusted: false, needs: [], connected: setUp, grantable: true, agents: null, seat: null,
    }))),
  };
}

/** The pick-lists the builder offers, all from code, plus the tools turned on on servers the owner added (`custom`). */
/** What the builder offers. `crew` names the agents (the Floor's roster) where a rule names one by id. */
export function builderMenu(crew: readonly { id: string; name: string }[] = [], h: Record<IntegrationId, boolean> = health(), custom: CustomMenu = { tools: [], conns: [] }) {
  const SETTING: Record<string, unknown> = { ...SETTINGS, OWNER_EMAIL: h.email, SHOPIFY_CONNECTED: h.shopify, KLAVIYO_CONNECTED: h.klaviyo, NOTION_CONNECTED: h.notion, MERCURY_CONNECTED: h.mercury, GMAIL_CONNECTED: h.gmail };
  return {
    tools: [...TOOL_LIST.map((t): BuildTool => ({ id: t.id, label: t.label, detail: t.detail, kind: t.kind, group: t.group, conn: connOf(t), trusted: t.trusted, needs: [...t.needs], connected: t.needs.every((k) => !!SETTING[k]), grantable: GRANTABLE.has(t.kind), agents: t.agents ? [...t.agents] : null, seat: t.seat ?? null })), ...custom.tools],
    agentNames: Object.fromEntries(crew.map((a) => [a.id, `${a.name} (${a.id})`])) as Record<string, string>,
    models: MODEL_LIST.filter((m) => m.route === "anthropic").map((m): BuildModel => ({ id: m.id, label: m.label, in: m.in, out: m.out })),
    efforts: [...EFFORTS],
    limits: RUN_LIMITS,
    budgetCeiling: BUDGET_CEILING,
    safety: SAFETY,
    conns: [...CONNECTIONS.map((c): FlowConn => ({ id: c.id, name: c.name, sub: c.sub, icon: c.icon, builtIn: c.builtIn, about: c.about, setUp: isSetUp(c, h) })), ...custom.conns],
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

/** One run's tool calls, for laying the run over the map. Empty for runs from before the engine (an agent's old code logged none). */
export async function mapSteps(runId: string): Promise<{ kind: string; tool: string | null; ok: boolean; ms: number }[]> {
  const { data, error } = await db().from("run_steps").select("kind, tool, ok, ms").eq("run_id", runId).order("idx");
  return error ? [] : (data ?? []).map((s) => ({ kind: s.kind, tool: s.tool, ok: !!s.ok, ms: Number(s.ms ?? 0) }));
}

/** A try (builder flow step 5): one preview run of a spec version, and whether Go live may use it. */
export interface TryView {
  runId: string; version: number; at: string; status: string; summary: string; costUsd: number; secs: number | null;
  steps: { kind: string; tool: string | null; ok: boolean; ms: number }[];
  /** True when the run finished, followed or explored without falling back, and no tool step failed. */
  clean: boolean;
  /** Why it isn't clean, as the end of "the latest try …". */
  why: string | null;
}

/** The latest try of one version, from the run log (trigger "preview", metrics.spec_version). Null when it was never tried. */
export async function lastTry(agentId: string, version: number): Promise<TryView | null> {
  const { data, error } = await db().from("agent_runs").select("id, started_at, ended_at, status, summary, error, cost_usd, metrics").eq("agent_id", agentId).eq("trigger", "preview").order("started_at", { ascending: false }).limit(30);
  if (error) return null;
  const r = (data ?? []).find((x) => Number((x.metrics ?? {}).spec_version) === version);
  if (!r) return null;
  const m = (r.metrics ?? {}) as Record<string, number>;
  const steps = await mapSteps(r.id);
  const failed = steps.filter((x) => x.kind === "tool" && !x.ok).length;
  const why = r.status === "running" ? "is still running"
    : r.status !== "ok" ? "failed"
    : m.finished !== 1 ? "didn’t finish"
    : failed ? `had ${failed} step${failed === 1 ? "" : "s"} that didn’t work`
    : m.fell_back === 1 ? "left its routine and explored instead"
    : null;
  return {
    runId: r.id, version, at: when(r.started_at), status: r.status, summary: r.error ?? r.summary ?? "", costUsd: Number(r.cost_usd ?? 0),
    secs: r.ended_at ? Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null,
    steps, clean: why === null, why,
  };
}

async function standards(agentId: string): Promise<Standard[]> {
  // its own standing orders, crew rules, and its department's rules (docs/org-chart.md, slice 2)
  const dept = (await agentDepartment(agentId).catch(() => null))?.dept.id;
  const { data, error } = await db().from("agent_memory").select("id, grp, text, notion_page_id, agent_id").or(`agent_id.eq.${agentId},grp.eq.crew${dept ? `,department_id.eq.${dept}` : ""}`).eq("state", "kept").in("grp", ["standing_order", "crew", "department"]).order("created_at", { ascending: true }).limit(100);
  if (error) return [];
  return (data ?? []).map((r) => ({ id: r.id, grp: r.grp, text: r.text, notionPageId: r.notion_page_id }));
}

export interface BuilderData {
  id: string; enabled: boolean; budget: number; active: SpecVersion | null;
  versions: (SpecVersion & { active: boolean; createdBy: string })[];
  standards: Standard[]; spentToday: number;
  others: { id: string; name: string; outputName: string; hasOutput: boolean }[];
  usedBy: { id: string; name: string }[];
  /** The newest version when it is newer than the live one: what Try it and Go live work on. */
  draft: (SpecVersion & { active: boolean; createdBy: string }) | null;
  /** The latest try of the version being worked on (the draft, else the live one). */
  tried: TryView | null;
  /** What the live version handed you last: the latest finished run that wasn't a try. */
  today: { at: string; summary: string } | null;
  lastOutput: { name: string; summary: string; numbers: { label: string; value: number; tool: string }[]; at: string; finished: boolean } | null;
  playbooks: PlaybookView | null;
}

export interface PlaybookRow { id: number; version: number; status: string; steps: string[]; changes: string | null; auto: boolean; when: string }
export interface PlaybookView { active: PlaybookRow | null; pending: PlaybookRow | null; hold: string | null }

/** Null when the playbook migration isn't applied yet. */
async function playbookView(agentId: string): Promise<PlaybookView | null> {
  try {
    const [all, hold] = await Promise.all([listPlaybooks(agentId), playbookHold(agentId)]);
    const view = (p: (typeof all)[number]): PlaybookRow => ({ id: p.id, version: p.version, status: p.status, steps: p.steps.map(stepLabel), changes: p.changes, auto: p.auto, when: when(p.decidedAt ?? p.createdAt) });
    const a = activePlaybook(all), q = pendingPlaybook(all);
    return { active: a && view(a), pending: q && view(q), hold: hold?.reason ?? null };
  } catch { return null; }
}

/** Null when the agent isn't one built in the app. */
export async function getBuilder(agentId: string): Promise<BuilderData | null> {
  const { data: a } = await db().from("agents").select("id, enabled, daily_budget_usd").eq("id", agentId).maybeSingle();
  if (!a) return null;
  const versions = await listSpecVersions(agentId);
  if (!versions.length) return null;
  const since = new Date(Date.now() - 864e5).toISOString();
  const [active, st, spent, defs, outs, playbooks] = await Promise.all([
    loadSpec(agentId), standards(agentId),
    db().from("agent_runs").select("cost_usd").eq("agent_id", agentId).gte("started_at", since),
    db().from("agent_defs").select("agent_id, spec").eq("active", true).neq("agent_id", agentId),
    db().from("agent_outputs").select("agent_id, name, summary, numbers, created_at, finished").order("created_at", { ascending: false }).limit(200),
    playbookView(agentId),
  ]);
  const draft = draftOf(versions);
  const working = draft ?? versions.find((v) => v.active) ?? null;
  const [tried, today] = await Promise.all([
    working ? lastTry(agentId, working.version) : null,
    db().from("agent_runs").select("started_at, summary").eq("agent_id", agentId).eq("status", "ok").neq("trigger", "preview").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const outRows = outs.error ? [] : outs.data ?? [];
  const mine = outRows.find((o) => o.agent_id === agentId);
  return {
    id: a.id, enabled: a.enabled, budget: Number(a.daily_budget_usd), active, versions, standards: st,
    spentToday: (spent.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0),
    others: (defs.data ?? []).map((d) => {
      const sp = (d.spec ?? {}) as Partial<AgentSpec>;
      return { id: d.agent_id as string, name: sp.name || d.agent_id, outputName: sp.outputName || "result", hasOutput: outRows.some((o) => o.agent_id === d.agent_id && o.finished) };
    }).sort((x, y) => x.name.localeCompare(y.name)),
    usedBy: usedByOf(agentId, defs.data ?? []),
    draft, tried,
    today: today.data?.summary ? { at: when(today.data.started_at), summary: today.data.summary } : null,
    playbooks,
    lastOutput: mine ? { name: mine.name, summary: mine.summary, numbers: (Array.isArray(mine.numbers) ? mine.numbers : []) as { label: string; value: number; tool: string }[], at: when(mine.created_at), finished: mine.finished } : null,
  };
}
