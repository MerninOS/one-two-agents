import "server-only";
// Everything the Control Room reads. Server only: the service-role client never reaches
// the browser, and every function checks the login first.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { DEFAULT_BUDGET, MEMORY_AGENTS, loadMemory, memoryView, proposedLessons, readPages, type MemoryEvent, type MemoryLoad, type MemoryRow, type PageLoad } from "@/core/memory";
import { AGENTS } from "@/agents/registry";
import { agentNames, loadOrg } from "@/core/org";
import { APPROVAL_LABELS, APPROVAL_TOOLS, BUTTON_ONLY, MAX_CHAINS, MAX_STEPS, METRICS, TAKES_HANDOFF, listFlowVersions, loadFlow, nextFirings } from "@/core/flow";
import { BUILT, BY_ID, type IntegrationId } from "./crew";
import type { CrewAgent, CrewCanvasData } from "./components/CrewCanvas";
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
  /** The live (active) saved-setup version of each agent, by agent id. */
  liveVersion: Record<string, number>;
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
  const empty: Floor = { ok: false, now, agents: {}, runs: [], spentToday: {}, health: h, photosWaiting: null, approvalsPending: null, lessonsWaiting: {}, grants: {}, setupNames: {}, liveVersion: {} };
  if (!h.supabase) return { ...empty, problem: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so there is nothing to show yet." };
  const since = new Date(now - 60 * 864e5).toISOString();
  const [a, r, ph, ap, lessonsWaiting, defs] = await Promise.all([
    db().from("agents").select("id, name, model, schedule, enabled, daily_budget_usd"),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    db().from("expense_docs").select("id", { count: "exact", head: true }).eq("status", "needs_photo"),
    // drafts still with their lead (slice 4) aren't waiting on Zak yet; the older shape until that migration is applied
    db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending").or("review_status.is.null,review_status.neq.waiting")
      .then((x) => (x.error ? db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending") : x)),
    proposedLessons(),
    db().from("agent_defs").select("agent_id, version, spec").eq("active", true),
  ]);
  if (a.error || r.error) return { ...empty, problem: `Supabase: ${(a.error ?? r.error)?.message}` };
  const agents = Object.fromEntries((a.data ?? []).map((x) => [x.id, { ...x, daily_budget_usd: Number(x.daily_budget_usd) } as AgentRow]));
  const all = (r.data ?? []).map(toRun);
  // a Preview is not a run of the agent: it stays out of the floor, the run log
  // and Replay, but its cost counts toward today's spend, the same as withRun's budget check
  const runs = all.filter((x) => x.trigger !== "preview");
  const d0 = budgetDayStart(new Date(now)).getTime();
  const spentToday: Record<string, number> = Object.fromEntries(BUILT.map((b) => [b.id, 0]));
  for (const run of all) if (Date.parse(run.started_at) >= d0) spentToday[run.agent_id] = (spentToday[run.agent_id] ?? 0) + run.cost_usd;
  const grants: Record<string, string[]> = {}, setupNames: Record<string, string> = {}, liveVersion: Record<string, number> = {};
  for (const d of defs.error ? [] : defs.data ?? []) {
    const spec = (d.spec ?? {}) as { tools?: unknown; name?: unknown };
    grants[d.agent_id] = Array.isArray(spec.tools) ? spec.tools.filter((t): t is string => typeof t === "string") : [];
    if (typeof spec.name === "string" && spec.name) setupNames[d.agent_id] = spec.name;
    liveVersion[d.agent_id] = Number(d.version);
  }
  return { ok: true, now, agents, runs, spentToday, health: h, photosWaiting: ph.error ? null : ph.count ?? 0, approvalsPending: ap.error ? null : ap.count ?? 0, lessonsWaiting, grants, setupNames, liveVersion };
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
  /** The department the agent sat in when it drafted this (slice 4); null off the chart or before the migration. */
  department_id: string | null;
  /** The lead that checks it first, and how that went: waiting, noted, sent_back, or skipped (not checked in time). */
  reviewer_agent_id: string | null;
  review_status: string | null;
  review_note: string | null;
  review_due: string | null;
}
export interface GatewayAction { id: string; agent_id: string; tool: string; action_type: string; target: string; status: string; reason: string | null; created_at: string; executed_at: string | null; run_id: string | null; exec_run_id: string | null }
export interface ApprovalsView {
  pending: ApprovalItem[];
  /** Pending, still waiting for the lead's check (Zak can decide them anyway). */
  withLead: ApprovalItem[];
  waiting: ApprovalItem[]; decided: ApprovalItem[]; log: GatewayAction[]; staleHours: number;
  /** Names of the agents on these cards that the crew list doesn't know (agents built in the app, leads). */
  names: Record<string, string>;
  /** Departments on the chart, for the tag and the filter. */
  departments: { id: string; name: string }[];
}

/** The approvals queue, approved changes waiting to be applied, recent decisions and the gateway log. Null until the tables exist. */
const AP_COLS = "id, action_id, agent_id, title, reasoning, status, created_at, decided_at, preview, agent_actions(status, reason, tool)";
const AP_REVIEW = "department_id, reviewer_agent_id, review_status, review_note, review_due";
type ApRow = Pick<ApprovalItem, "id" | "action_id" | "agent_id" | "title" | "reasoning" | "status" | "created_at" | "decided_at"> & { preview: unknown; agent_actions: unknown } & Partial<Pick<ApprovalItem, "department_id" | "reviewer_agent_id" | "review_status" | "review_note" | "review_due">>;

export async function getApprovals(): Promise<ApprovalsView | null> {
  await requireSession();
  if (!health().supabase) return null;
  const [ap, log, pol] = await Promise.all([
    // the slice 4 columns, or the older shape until that migration is applied
    db().from("approvals").select(`${AP_COLS}, ${AP_REVIEW}`).order("created_at", { ascending: false }).limit(200)
      .then((r) => (r.error ? db().from("approvals").select(AP_COLS).order("created_at", { ascending: false }).limit(200) : r)),
    db().from("agent_actions").select("id, agent_id, tool, action_type, target, status, reason, created_at, executed_at, run_id, exec_run_id").order("created_at", { ascending: false }).limit(60),
    db().from("policies").select("value_json").eq("key", "approval_expiry_hours").maybeSingle(),
  ]);
  if (ap.error || log.error) return null;
  const org = await loadOrg().catch(() => null);
  const items: ApprovalItem[] = await Promise.all(((ap.data ?? []) as unknown as ApRow[]).map(async (r) => {
    const act = (Array.isArray(r.agent_actions) ? r.agent_actions[0] : r.agent_actions) as { status: string; reason: string | null; tool: string } | null;
    const preview = (r.preview ?? {}) as ApprovalItem["preview"];
    let receipt_url: string | null = null;
    if (preview.receipt_path && r.status === "pending") {
      const { data } = await db().storage.from("receipts").createSignedUrl(preview.receipt_path, 600);
      receipt_url = data?.signedUrl ?? null;
    }
    return { id: r.id, action_id: r.action_id, agent_id: r.agent_id, title: r.title, reasoning: r.reasoning, status: r.status, created_at: r.created_at, decided_at: r.decided_at, preview, receipt_url, action_status: act?.status ?? "?", action_reason: act?.reason ?? null, tool: act?.tool ?? "",
      department_id: r.department_id ?? null, reviewer_agent_id: r.reviewer_agent_id ?? null, review_status: r.review_status ?? null, review_note: r.review_note ?? null, review_due: r.review_due ?? null };
  }));
  return {
    pending: items.filter((i) => i.status === "pending" && i.review_status !== "waiting").reverse(), // oldest first
    withLead: items.filter((i) => i.status === "pending" && i.review_status === "waiting").reverse(),
    waiting: items.filter((i) => i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status)),
    decided: items.filter((i) => i.status !== "pending" && !(i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status))).slice(0, 30),
    log: (log.data ?? []) as GatewayAction[],
    staleHours: Number(pol.data?.value_json) || 72,
    departments: (org?.departments ?? []).map((d) => ({ id: d.id, name: d.name })),
    names: await agentNames([...new Set(items.flatMap((i) => [i.agent_id, i.reviewer_agent_id ?? ""]).filter((id) => id && !BY_ID[id]))]).catch(() => ({})),
  };
}

// ---- Memory (docs/agent-memory.md)

export interface MemoryTab { rows: MemoryRow[]; events: MemoryEvent[]; load: MemoryLoad | null; loads: boolean; /** Linked Notion pages, as a run would read them now. */ pages: PageLoad[]; /** The department the agent sits in, whose rules it loads. */ dept: { id: string; name: string } | null }

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
