import "server-only";
// Everything the Control Room reads. Server only: the service-role client never reaches
// the browser, and every function checks the login first.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { DEFAULT_BUDGET, MEMORY_AGENTS, loadMemory, memoryView, proposedLessons, readPages, type MemoryEvent, type MemoryLoad, type MemoryRow, type PageLoad } from "@/core/memory";
import { MAX_INSTRUCTIONS, listVersions, liveSections, loosening, resolveSetup, setupOrDefaults, toDraft, type AgentMenu, type Setup, type SetupVersion } from "@/core/setup";
import { TOOLS } from "@/core/gateway/policy";
import { hasGateway } from "@/integrations/gateway";
import { modelDef } from "@/integrations/models";
import { MENUS } from "@/agents/menus";
import { AGENTS } from "@/agents/registry";
import { APPROVAL_LABELS, APPROVAL_TOOLS, BUTTON_ONLY, MAX_CHAINS, MAX_STEPS, METRICS, TAKES_HANDOFF, listFlowVersions, loadFlow, nextFirings } from "@/core/flow";
import { BUILT, BY_ID, type IntegrationId } from "./crew";
import type { CrewAgent, CrewCanvasData } from "./components/CrewCanvas";
import type { EditorVersion, SetupEditorData } from "./components/setupEditor";
import { lineDiff, trimDiff } from "./diff";
import { SESSION_COOKIE, controlsOn, validSessionToken } from "./session";

export async function requireSession() {
  const jar = await cookies();
  if (!validSessionToken(jar.get(SESSION_COOKIE)?.value)) redirect("/login");
}

export type RunStatus = "running" | "ok" | "failed" | "skipped";
export interface Run {
  id: string;
  agent_id: string;
  trigger: string;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  summary: string | null;
  error: string | null;
  /** What the run loaded from memory (core/memory.ts loadSummary); null for runs that load none. */
  memory_json: RunMemory | null;
}
export interface RunMemory {
  budget: number; tokens: number; dropped: number; over_budget: boolean;
  groups: Record<string, { lines: number; tokens: number }>;
  pages?: { page_id: string; title: string; tokens: number; cut: boolean; problem: string | null }[];
}
export interface AgentRow { id: string; name: string; model: string; schedule: string | null; enabled: boolean; daily_budget_usd: number }

export interface Floor {
  ok: boolean;
  problem?: string;
  /** When this request read the floor; pages use it instead of calling Date.now() while rendering. */
  now: number;
  agents: Record<string, AgentRow>;
  runs: Run[];
  spentToday: Record<string, number>;
  health: Record<IntegrationId, boolean>;
  /** Charges waiting on a receipt photo (Quinn); null when expense_docs isn't there yet. */
  photosWaiting: number | null;
  /** Approvals waiting on Zak; null when the approvals table isn't there yet. */
  approvalsPending: number | null;
  /** Proposed lessons waiting for Zak's Keep, per agent; empty until the memory tables exist. */
  lessonsWaiting: Record<string, number>;
  /** Tool ids in each agent's active saved setup (agent_defs), by agent id; empty before the runner migration. */
  grants: Record<string, string[]>;
  /** Names from saved setups, for agents built in the app that aren't in dashboard/crew.ts. */
  setupNames: Record<string, string>;
}

const RUN_COLS = "id, agent_id, trigger, started_at, ended_at, status, tokens_in, tokens_out, cost_usd, summary, error, memory_json";
const toRun = (r: Record<string, unknown>) => ({ ...r, cost_usd: Number(r.cost_usd ?? 0), tokens_in: Number(r.tokens_in ?? 0), tokens_out: Number(r.tokens_out ?? 0) }) as Run;

/** Midnight UTC: the same day boundary withRun uses for daily budgets. */
export const budgetDayStart = (now = new Date()) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; };

export function health(): Record<IntegrationId, boolean> {
  return {
    supabase: !!(env.supabaseUrl && env.supabaseServiceKey),
    shopify: !!(env.shopifyDomain && (env.shopifyAdminToken || (env.shopifyClientId && env.shopifyClientSecret))),
    claude: !!process.env.ANTHROPIC_API_KEY,
    mercury: !!(env.mercuryToken && env.mercuryAccountIds.length),
    notion: !!(env.notionToken && env.notionBriefParent),
    email: !!(env.resendKey && env.briefFrom && env.briefTo),
    gmail: !!(env.gmailClientId && env.gmailClientSecret && env.gmailRefreshToken),
    gmail_read: !!(env.gmailClientId && env.gmailClientSecret && env.gmailReceiptsRefreshToken),
    // web search runs through the Claude API key
    web: !!process.env.ANTHROPIC_API_KEY,
    // planned for the Conversion Optimizer; nothing uses it yet
    github: false,
  };
}

/** Agents, the last 60 days of runs (newest first, at most 1000) and today's spend. */
export const getFloor = cache(async (): Promise<Floor> => {
  await requireSession();
  const h = health();
  const now = Date.now();
  const empty: Floor = { ok: false, now, agents: {}, runs: [], spentToday: {}, health: h, photosWaiting: null, approvalsPending: null, lessonsWaiting: {}, grants: {}, setupNames: {} };
  if (!h.supabase) return { ...empty, problem: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so there is nothing to show yet." };
  const since = new Date(now - 60 * 864e5).toISOString();
  const [a, r, ph, ap, lessonsWaiting, defs] = await Promise.all([
    db().from("agents").select("id, name, model, schedule, enabled, daily_budget_usd"),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    db().from("expense_docs").select("id", { count: "exact", head: true }).eq("status", "needs_photo"),
    db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    proposedLessons(),
    db().from("agent_defs").select("agent_id, spec").eq("active", true),
  ]);
  if (a.error || r.error) return { ...empty, problem: `Supabase: ${(a.error ?? r.error)?.message}` };
  const agents = Object.fromEntries((a.data ?? []).map((x) => [x.id, { ...x, daily_budget_usd: Number(x.daily_budget_usd) } as AgentRow]));
  const all = (r.data ?? []).map(toRun);
  // a Preview from the Setup tab is not a run of the agent: it stays out of the floor, the run log
  // and Replay, but its cost counts toward today's spend, the same as withRun's budget check
  const runs = all.filter((x) => x.trigger !== "preview");
  const d0 = budgetDayStart(new Date(now)).getTime();
  const spentToday: Record<string, number> = Object.fromEntries(BUILT.map((b) => [b.id, 0]));
  for (const run of all) if (Date.parse(run.started_at) >= d0) spentToday[run.agent_id] = (spentToday[run.agent_id] ?? 0) + run.cost_usd;
  const grants: Record<string, string[]> = {}, setupNames: Record<string, string> = {};
  for (const d of defs.error ? [] : defs.data ?? []) {
    const spec = (d.spec ?? {}) as { tools?: unknown; name?: unknown };
    grants[d.agent_id] = Array.isArray(spec.tools) ? spec.tools.filter((t): t is string => typeof t === "string") : [];
    if (typeof spec.name === "string" && spec.name) setupNames[d.agent_id] = spec.name;
  }
  return { ok: true, now, agents, runs, spentToday, health: h, photosWaiting: ph.error ? null : ph.count ?? 0, approvalsPending: ap.error ? null : ap.count ?? 0, lessonsWaiting, grants, setupNames };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRun(id: string): Promise<Run | null> {
  await requireSession();
  if (!UUID.test(id) || !health().supabase) return null;
  const { data } = await db().from("agent_runs").select(RUN_COLS).eq("id", id).maybeSingle();
  return data ? toRun(data) : null;
}

export interface Pipeline { stages: Record<string, number>; total: number; domains: string[] }

/** Mission control's "Memory per agent": what each agent's next run would load. Notion pages aren't read here, only counted. */
export async function getMemoryMeters(): Promise<Record<string, { tokens: number; budget: number; lines: number; groups: MemoryLoad["groups"]; linked: number }> | null> {
  await requireSession();
  if (!health().supabase) return null;
  try {
    const ids = [...MEMORY_AGENTS];
    const loads = await Promise.all(ids.map((id) => loadMemory(id, Date.now(), { pages: false })));
    return Object.fromEntries(loads.map((m) => [m.agentId, {
      tokens: m.tokens, budget: m.budget, lines: m.rows.length, groups: m.groups,
      linked: m.rows.filter((r) => r.grp === "standing_order" && r.notion_page_id).length,
    }]));
  } catch { return null; }
}

/** Rowan's pipeline by stage, and the domains it won't repeat. */
export async function getPipeline(): Promise<Pipeline | null> {
  await requireSession();
  if (!health().supabase) return null;
  const { data, error } = await db().from("wholesale_leads").select("stage, domain").order("created_at", { ascending: false }).limit(1000);
  if (error) return null;
  const stages: Record<string, number> = {};
  for (const l of data ?? []) stages[l.stage] = (stages[l.stage] ?? 0) + 1;
  return { stages, total: data?.length ?? 0, domains: (data ?? []).map((l) => l.domain).filter(Boolean) };
}

export async function leadsForRun(runId: string): Promise<number | null> {
  await requireSession();
  if (!UUID.test(runId) || !health().supabase) return null;
  const { count } = await db().from("wholesale_leads").select("id", { count: "exact", head: true }).eq("run_id", runId);
  return count ?? 0;
}

export interface Books {
  statuses: Record<string, number>;
  total: number;
  proposals: number;
  waiting: { date: string; merchant: string; amount_usd: number }[];
  coverage: number | null;
}

/** Quinn's books: expense_docs by status, proposals waiting, and the photo asks. Null until the table exists. */
export async function getBooks(): Promise<Books | null> {
  await requireSession();
  if (!health().supabase) return null;
  const { data, error } = await db().from("expense_docs").select("status, date, merchant, amount_usd, proposal_status").order("date", { ascending: false }).limit(2000);
  if (error) return null;
  const statuses: Record<string, number> = {};
  for (const d of data ?? []) statuses[d.status] = (statuses[d.status] ?? 0) + 1;
  const counted = (data ?? []).filter((d) => d.status !== "not_needed" && d.status !== "personal");
  const covered = counted.filter((d) => d.status === "matched" || d.status === "bank_record_only").length;
  return {
    statuses,
    total: data?.length ?? 0,
    proposals: (data ?? []).filter((d) => d.proposal_status === "proposed").length,
    waiting: (data ?? []).filter((d) => d.status === "needs_photo").slice(0, 8).map((d) => ({ date: d.date, merchant: d.merchant, amount_usd: Number(d.amount_usd) })),
    coverage: counted.length ? Math.round((covered / counted.length) * 1000) / 10 : null,
  };
}

// ---- Approvals and the gateway log

export interface ApprovalItem {
  id: string;
  action_id: string;
  agent_id: string;
  title: string;
  reasoning: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  preview: { date?: string; merchant?: string; amount_usd?: number; receipt_path?: string | null; category?: string | null; note?: string | null; charge?: string; to?: string; subject?: string; body?: string; why?: string };
  /** The gateway tool: a Mercury change or a Gmail draft. */
  tool: string;
  /** A 10-minute signed link to the receipt file, so Zak can check it before approving. */
  receipt_url: string | null;
  action_status: string;
  action_reason: string | null;
}
export interface GatewayAction { id: string; agent_id: string; tool: string; action_type: string; target: string; status: string; reason: string | null; created_at: string; executed_at: string | null; run_id: string | null; exec_run_id: string | null }
export interface ApprovalsView { pending: ApprovalItem[]; waiting: ApprovalItem[]; decided: ApprovalItem[]; log: GatewayAction[]; staleHours: number }

/** The approvals queue, approved changes waiting to be applied, recent decisions and the gateway log. Null until the tables exist. */
export async function getApprovals(): Promise<ApprovalsView | null> {
  await requireSession();
  if (!health().supabase) return null;
  const [ap, log, pol] = await Promise.all([
    db().from("approvals").select("id, action_id, agent_id, title, reasoning, status, created_at, decided_at, preview, agent_actions(status, reason, tool)").order("created_at", { ascending: false }).limit(200),
    db().from("agent_actions").select("id, agent_id, tool, action_type, target, status, reason, created_at, executed_at, run_id, exec_run_id").order("created_at", { ascending: false }).limit(60),
    db().from("policies").select("value_json").eq("key", "approval_expiry_hours").maybeSingle(),
  ]);
  if (ap.error || log.error) return null;
  const items: ApprovalItem[] = await Promise.all((ap.data ?? []).map(async (r) => {
    const act = (Array.isArray(r.agent_actions) ? r.agent_actions[0] : r.agent_actions) as { status: string; reason: string | null; tool: string } | null;
    const preview = (r.preview ?? {}) as ApprovalItem["preview"];
    let receipt_url: string | null = null;
    if (preview.receipt_path && r.status === "pending") {
      const { data } = await db().storage.from("receipts").createSignedUrl(preview.receipt_path, 600);
      receipt_url = data?.signedUrl ?? null;
    }
    return { id: r.id, action_id: r.action_id, agent_id: r.agent_id, title: r.title, reasoning: r.reasoning, status: r.status, created_at: r.created_at, decided_at: r.decided_at, preview, receipt_url, action_status: act?.status ?? "?", action_reason: act?.reason ?? null, tool: act?.tool ?? "" };
  }));
  return {
    pending: items.filter((i) => i.status === "pending").reverse(), // oldest first
    waiting: items.filter((i) => i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status)),
    decided: items.filter((i) => i.status !== "pending" && !(i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status))).slice(0, 30),
    log: (log.data ?? []) as GatewayAction[],
    staleHours: Number(pol.data?.value_json) || 72,
  };
}

// ---- Memory (docs/agent-memory.md)

export interface MemoryTab { rows: MemoryRow[]; events: MemoryEvent[]; load: MemoryLoad | null; loads: boolean; /** Linked Notion pages, as a run would read them now. */ pages: PageLoad[] }

/** One agent's memory for the Memory tab, and what its next run would load. Null with a reason until the tables exist. */
export async function getMemory(agentId: string): Promise<{ tab: MemoryTab | null; problem?: string }> {
  await requireSession();
  if (!health().supabase) return { tab: null, problem: "Supabase isn’t set up." };
  try {
    const loads = MEMORY_AGENTS.has(agentId);
    const [view, load] = await Promise.all([memoryView(agentId), loads ? loadMemory(agentId) : Promise.resolve(null)]);
    // an agent that doesn't load memory yet still shows whether its linked pages can be read
    const pages = load?.pages ?? await readPages(view.rows.filter((r) => r.agent_id === agentId && r.state === "kept"), DEFAULT_BUDGET);
    return { tab: { ...view, load, loads, pages } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { tab: null, problem: /agent_memory|memory_events|schema cache|does not exist/i.test(msg) ? "The memory tables aren’t in Supabase yet. Apply the agent memory migration (see the PR) and this tab fills in." : msg };
  }
}

// ---- Setup (docs/agent-setup.md)

/** The agent's active setup over its menu, for the canvas. Null for an agent that has no menu yet. */
export async function getSetup(agentId: string): Promise<{ setup: Setup; problem?: string } | null> {
  await requireSession();
  const menu = MENUS[agentId];
  if (!menu) return null;
  if (!health().supabase) return { ...(await setupOrDefaults(menu)), problem: "Supabase isn’t set up" };
  const got = await setupOrDefaults(menu);
  return got.problem && /agent_setup|schema cache|does not exist/i.test(got.problem) ? { setup: got.setup, problem: "the agent_setup table isn’t in Supabase yet" } : got;
}

/** Which setup version a run used. Null for a run on built-in values, or until the column exists. */
export async function runSetupVersion(runId: string): Promise<number | null> {
  await requireSession();
  if (!health().supabase) return null;
  const { data, error } = await db().from("agent_runs").select("setup_version").eq("id", runId).maybeSingle();
  return error ? null : (data?.setup_version as number | null) ?? null;
}

/** What one agent's next run would load from memory, for the canvas. Null when it loads none or the store can't be read. */
export async function getMemoryMeter(agentId: string): Promise<{ budget: number; lines: number } | null> {
  await requireSession();
  if (!MEMORY_AGENTS.has(agentId) || !health().supabase) return null;
  try { const m = await loadMemory(agentId, Date.now(), { pages: false }); return { budget: m.budget, lines: m.rows.length }; }
  catch { return null; }
}

/**
 * Everything the Thinking editor shows (dashboard/components/ThinkingEditor.tsx): the menu's
 * choices with prices, the active values, the safety block, the version list with what changed,
 * and the average tokens of the last 10 real runs that called a model. Null for an agent with no menu.
 */
export async function getSetupEditor(agentId: string, runs: Run[], health: Record<IntegrationId, boolean>, got: { setup: Setup; problem?: string } | null): Promise<SetupEditorData | null> {
  await requireSession();
  const menu = MENUS[agentId];
  if (!menu || !got) return null;
  const step = menu.steps[0] as AgentMenu["steps"][number] | undefined;
  const s = got.setup;
  const models = (ids: readonly string[]) => ids.map((id) => { const m = modelDef(id); return { id, label: m?.label ?? id, provider: m?.provider ?? "Unknown", gateway: m?.route === "gateway", in: m?.in ?? null, out: m?.out ?? null }; });
  const optLabel = (k: string, id: string) => menu.choices?.[k]?.options.find((o) => o.id === id)?.label ?? id;
  let versions: SetupVersion[] = [], blocked = got.problem ? `Saving is off: ${got.problem}.` : undefined;
  if (!blocked) {
    try { versions = await listVersions(menu); }
    catch (e) { blocked = `Saving is off: the version list can’t be read (${(e instanceof Error ? e.message : String(e)).slice(0, 100)}).`; }
  }
  const builtIn = (v: Setup) => v.instructions.trim() === menu.instructions.trim();
  const view = versions.map((v, k): EditorVersion => {
    const prev = versions[k + 1]?.setup ?? resolveSetup(menu, null);
    const changes = [
      ...(v.setup.model !== prev.model ? [`model ${prev.model} to ${v.setup.model}`] : []),
      ...(v.setup.effort !== prev.effort ? [`effort ${prev.effort} to ${v.setup.effort}`] : []),
      ...(v.setup.fallback !== prev.fallback ? [`fallback ${prev.fallback ?? "none"} to ${v.setup.fallback ?? "none"}`] : []),
      ...(v.setup.instructions !== prev.instructions ? [builtIn(v.setup) ? "back to the built-in instructions" : "instructions"] : []),
      ...menu.steps.slice(1).filter((d) => JSON.stringify(v.setup.more[d.id]) !== JSON.stringify(prev.more[d.id])).map((d) => `${d.label} ${prev.more[d.id]?.model} ${prev.more[d.id]?.effort} to ${v.setup.more[d.id]?.model} ${v.setup.more[d.id]?.effort}`),
      ...Object.entries(menu.choices ?? {}).filter(([k]) => JSON.stringify(v.setup.choices[k]) !== JSON.stringify(prev.choices[k])).map(([k, d]) => `${d.label}: ${(v.setup.choices[k] ?? []).map((id) => optLabel(k, id)).join(", ")}`),
      ...Object.keys(menu.numbers).filter((n) => v.setup.numbers[n] !== prev.numbers[n]).map((n) => `${menu.numbers[n].label} ${prev.numbers[n]} to ${v.setup.numbers[n]}`),
      ...partChanges(menu, prev, v.setup),
    ];
    return {
      version: v.version, active: v.active, note: v.note, by: v.createdBy, at: v.createdAt,
      model: v.setup.model, effort: v.setup.effort, fallback: v.setup.fallback,
      instructionsChars: v.setup.instructions.length, builtInText: builtIn(v.setup),
      parts: partWords(menu, v.setup),
      looser: v.active ? [] : loosening(menu, s, v.setup, (m) => modelDef(m)?.out ?? Infinity),
      changes: k === versions.length - 1 && !changes.length ? ["first version, same values as the built-in setup"] : changes,
      diff: v.setup.instructions !== prev.instructions ? trimDiff(lineDiff(prev.instructions, v.setup.instructions)) : null,
    };
  });
  const used = runs.filter((r) => r.agent_id === agentId && (r.trigger === "cron" || r.trigger === "manual") && r.tokens_in + r.tokens_out > 0).slice(0, 10);
  return {
    agentId, agentName: BY_ID[agentId]?.name ?? agentId, stepLabel: step?.label ?? "Computed in code", needs: step?.needs ?? "No model",
    models: models(step?.models ?? []), fallbackOff: !step || !!step.fallbackOff,
    more: menu.steps.slice(1).map((d) => ({ id: d.id, label: d.label, needs: d.needs, models: models(d.models) })),
    instructionsLocked: !!menu.instructionsLocked || !step,
    // Avery's preview writes today's real brief with one model call; the others get a free dry run with the draft
    previewKind: AGENTS[agentId]?.preview ? "model" : "dry",
    gatewayReady: hasGateway(),
    active: { version: s.version, ...toDraft(s) },
    builtIn: menu.instructions, safety: menu.safety, maxChars: MAX_INSTRUCTIONS,
    usage: used.length ? { runs: used.length, avgIn: used.reduce((a, r) => a + r.tokens_in, 0) / used.length, avgOut: used.reduce((a, r) => a + r.tokens_out, 0) / used.length } : null,
    controlsOn: controlsOn(), blocked, versions: view,
    reads: menu.reads.map((r) => ({ id: r.id, label: r.label, detail: r.detail, locked: !!r.locked, connected: (health[r.integration as IntegrationId] ?? false) && (r.env ?? []).every((k) => !!process.env[k]?.trim()) })),
    numbers: Object.entries(menu.numbers).map(([key, n]) => ({ key, label: n.label, unit: n.unit, min: n.min, max: n.max, default: n.default, box: n.box })),
    choices: Object.entries(menu.choices ?? {}).map(([key, c]) => ({ key, label: c.label, detail: c.detail, box: c.box, options: c.options.map((o) => ({ id: o.id, label: o.label })), default: [...c.default], min: c.min, max: c.max })),
    outputs: menu.outputs.map((o) => { const missing = (o.env ?? []).filter((k) => !process.env[k]?.trim()); return { id: o.id, label: o.label, detail: o.detail, locked: !!o.locked, ready: o.locked ? (health[o.integration as IntegrationId] ?? false) : !missing.length, missing }; }),
    sections: menu.sections.map((x) => ({ id: x.id, label: x.label, detail: x.detail, locked: !!x.locked, needs: (x.needs ?? []).map((id) => ({ id, label: menu.reads.find((r) => r.id === id)?.label ?? id })) })),
    notion: menu.notion ? {
      tokenSet: !!env.notionToken, pageOnly: !!menu.notion.pageOnly,
      fallback: notionFallback(menu.notion),
    } : null,
    actions: Object.entries(TOOLS).filter(([, t]) => (t.agents as readonly string[]).includes(agentId)).map(([tool, t]) => ({ tool, tier: t.tier, note: "Every action waits for your approval card. Promotion needs 28 of the last 30 approved unedited." })),
  };
}

/** What the Notion env vars point at when the setup picks no target, in words. */
function notionFallback(n: NonNullable<AgentMenu["notion"]>): string | null {
  const set = (k?: string) => !!(k && process.env[k]?.trim());
  if (set(n.envDb)) return `The database in ${n.envDb} (Vercel), until you pick one here`;
  if (set(n.envPage)) return `A page per ${n.pageOnly ? "run" : "day"} under ${n.envPage} (Vercel), until you pick one here`;
  // core/env.ts falls back to the brief's parent page for Rowan's and Quinn's pages
  if (n.pageOnly && env.notionBriefParent) return "A page per run under NOTION_BRIEF_PARENT_ID (Vercel), until you pick one here";
  return null;
}

/** Reads and writes changes between two versions, in words. */
function partChanges(menu: AgentMenu, a: Setup, b: Setup): string[] {
  const label = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
  return [
    ...menu.reads.filter((r) => a.readsOff.includes(r.id) !== b.readsOff.includes(r.id)).map((r) => `${r.label} ${b.readsOff.includes(r.id) ? "off" : "on"}`),
    ...menu.outputs.filter((o) => a.outputsOff.includes(o.id) !== b.outputsOff.includes(o.id)).map((o) => `${o.label} ${b.outputsOff.includes(o.id) ? "off" : "on"}`),
    ...(JSON.stringify(a.sections) !== JSON.stringify(b.sections) ? [`sections ${b.sections.map((id) => label(menu.sections, id)).join(", ")}`] : []),
    ...(a.notion?.id !== b.notion?.id ? [`Notion copy to ${b.notion ? `“${b.notion.title}”` : "the Vercel setting"}`] : []),
  ];
}

/** A version's reads and writes in a few words, for the version list. */
function partWords(menu: AgentMenu, s: Setup): string {
  const off = menu.reads.filter((r) => s.readsOff.includes(r.id)).map((r) => r.label);
  const outs = menu.outputs.filter((o) => !s.outputsOff.includes(o.id)).map((o) => o.label);
  return [
    off.length ? `not reading ${off.join(", ")}` : "every source on",
    `to ${outs.join(" and ") || "nowhere"}${s.notion && !s.outputsOff.includes("notion") ? ` (“${s.notion.title}”)` : ""}`,
    ...(menu.sections.length ? [`${liveSections(menu, s).length} sections`] : []),
    ...Object.entries(menu.numbers).filter(([, d]) => d.box === "writes").map(([k, d]) => `${s.numbers[k]} ${d.unit}`),
  ].join(" · ");
}

// ---- Crew canvas (docs/agent-setup.md, slice 5)

/**
 * The Crew canvas: the active flow, its versions, and the palette of agents a chain can pick
 * (with what each run costs on average, from real runs). Null problem-free values when the
 * crew_flow table isn't there yet.
 */
export async function getCrewCanvas(f: Floor): Promise<CrewCanvasData> {
  await requireSession();
  const ids = Object.keys(AGENTS);
  const palette: CrewAgent[] = ids.map((id) => {
    const a = BY_ID[id];
    const real = f.runs.filter((r) => r.agent_id === id && r.status === "ok" && r.trigger !== "preview").slice(0, 10);
    return {
      id, name: a?.name ?? id, role: a?.role ?? "", hue: a?.hue ?? "#999", icon: a?.icon ?? "bot",
      enabled: !!f.agents[id]?.enabled, buttonOnly: BUTTON_ONLY.has(id), takesHandoff: TAKES_HANDOFF.has(id),
      metrics: METRICS[id] ?? [], avgCost: real.length ? real.reduce((s, r) => s + r.cost_usd, 0) / real.length : null, runs: real.length,
    };
  });
  const base = { palette, approvalTools: APPROVAL_TOOLS.map((t) => ({ id: t, label: APPROVAL_LABELS[t] ?? t })), controls: controlsOn(), maxSteps: MAX_STEPS, maxChains: MAX_CHAINS, now: f.now };
  if (!health().supabase) return { ...base, version: 0, note: null, flow: { chains: [] }, problems: [], versions: [], next: {}, problem: "Supabase isn’t set up, so there is no flow to show." };
  try {
    const [active, all] = await Promise.all([loadFlow(ids), listFlowVersions(ids)]);
    const next = Object.fromEntries(active.flow.chains.map((c) => [c.key, nextFirings(c, f.now, 3).map((t) => new Date(t).toISOString())]));
    return {
      ...base, version: active.version, note: active.note, flow: active.flow, problems: active.problems, next,
      versions: all.map((v) => ({ version: v.version, active: v.active, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt, chains: v.flow.chains.length, on: v.flow.chains.filter((c) => c.on).map((c) => c.name) })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, version: 0, note: null, flow: { chains: [] }, problems: [], versions: [], next: {}, problem: /crew_flow/.test(msg) ? "The crew_flow table isn’t in Supabase yet: apply the migration 20261112200000_crew_flow.sql." : `Supabase: ${msg}` };
  }
}

export interface ChainRun { id: string; step: number; agentId: string; status: RunStatus; startedAt: string; endedAt: string | null; costUsd: number; summary: string | null }

/** Every run of the chain run this run belongs to, in step order; null when it isn't in a chain (or the columns aren't there yet). */
export async function getChainRuns(runId: string): Promise<{ chainId: string; key: string; name: string; steps: string[]; runs: ChainRun[] } | null> {
  await requireSession();
  if (!UUID.test(runId) || !health().supabase) return null;
  const { data: me, error } = await db().from("agent_runs").select("chain_id, chain_key").eq("id", runId).maybeSingle();
  if (error || !me?.chain_id) return null;
  const { data } = await db().from("agent_runs").select("id, agent_id, chain_step, status, started_at, ended_at, cost_usd, summary, error").eq("chain_id", me.chain_id).order("chain_step").order("started_at");
  let name = me.chain_key as string, steps: string[] = [];
  try {
    const flow = await loadFlow(Object.keys(AGENTS));
    const c = flow.flow.chains.find((x) => x.key === me.chain_key);
    if (c) { name = c.name; steps = c.steps.map((s) => s.agent); }
  } catch { /* the flow can't be read: show the runs alone */ }
  return {
    chainId: me.chain_id as string, key: me.chain_key as string, name, steps,
    runs: (data ?? []).map((r) => ({ id: r.id, step: Number(r.chain_step ?? 0), agentId: r.agent_id, status: r.status as RunStatus, startedAt: r.started_at, endedAt: r.ended_at, costUsd: Number(r.cost_usd ?? 0), summary: (r.summary ?? r.error ?? null) as string | null })),
  };
}

// ---- Vendors and suppressed addresses (Settings). Null when the caps migration isn't applied yet.

export interface VendorRow { id: string; name: string; kind: string; mercury_recipient_id: string | null; contact_email: string | null; added_by: string; added_at: string }
export interface SuppressionRow { email: string; reason: string | null; source: string; created_at: string }

export async function getVendorsAndSuppressions(): Promise<{ vendors: VendorRow[]; suppressed: SuppressionRow[] } | null> {
  await requireSession();
  if (!health().supabase) return null;
  const [v, s] = await Promise.all([
    db().from("vendors").select("id, name, kind, mercury_recipient_id, contact_email, added_by, added_at").order("name"),
    db().from("email_suppressions").select("email, reason, source, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  if (v.error || s.error) return null;
  return { vendors: (v.data ?? []) as VendorRow[], suppressed: (s.data ?? []) as SuppressionRow[] };
}
