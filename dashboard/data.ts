import "server-only";
// Everything the Control Room reads. Server only: the service-role client never reaches
// the browser, and every function checks the login first.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { DEFAULT_BUDGET, MEMORY_AGENTS, loadMemory, memoryView, proposedLessons, readPages, type MemoryEvent, type MemoryLoad, type MemoryRow, type PageLoad } from "@/core/memory";
import { BUILT, type IntegrationId } from "./crew";
import { SESSION_COOKIE, validSessionToken } from "./session";

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
  const empty: Floor = { ok: false, now, agents: {}, runs: [], spentToday: {}, health: h, photosWaiting: null, approvalsPending: null, lessonsWaiting: {} };
  if (!h.supabase) return { ...empty, problem: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so there is nothing to show yet." };
  const since = new Date(now - 60 * 864e5).toISOString();
  const [a, r, ph, ap, lessonsWaiting] = await Promise.all([
    db().from("agents").select("id, name, model, schedule, enabled, daily_budget_usd"),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    db().from("expense_docs").select("id", { count: "exact", head: true }).eq("status", "needs_photo"),
    db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    proposedLessons(),
  ]);
  if (a.error || r.error) return { ...empty, problem: `Supabase: ${(a.error ?? r.error)?.message}` };
  const agents = Object.fromEntries((a.data ?? []).map((x) => [x.id, { ...x, daily_budget_usd: Number(x.daily_budget_usd) } as AgentRow]));
  const runs = (r.data ?? []).map(toRun);
  const d0 = budgetDayStart(new Date(now)).getTime();
  const spentToday: Record<string, number> = Object.fromEntries(BUILT.map((b) => [b.id, 0]));
  for (const run of runs) if (Date.parse(run.started_at) >= d0) spentToday[run.agent_id] = (spentToday[run.agent_id] ?? 0) + run.cost_usd;
  return { ok: true, now, agents, runs, spentToday, health: h, photosWaiting: ph.error ? null : ph.count ?? 0, approvalsPending: ap.error ? null : ap.count ?? 0, lessonsWaiting };
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
  preview: { date?: string; merchant?: string; amount_usd?: number; receipt_path?: string | null; category?: string | null; note?: string | null };
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
    db().from("approvals").select("id, action_id, agent_id, title, reasoning, status, created_at, decided_at, preview, agent_actions(status, reason)").order("created_at", { ascending: false }).limit(200),
    db().from("agent_actions").select("id, agent_id, tool, action_type, target, status, reason, created_at, executed_at, run_id, exec_run_id").order("created_at", { ascending: false }).limit(60),
    db().from("policies").select("value_json").eq("key", "approval_expiry_hours").maybeSingle(),
  ]);
  if (ap.error || log.error) return null;
  const items: ApprovalItem[] = await Promise.all((ap.data ?? []).map(async (r) => {
    const act = (Array.isArray(r.agent_actions) ? r.agent_actions[0] : r.agent_actions) as { status: string; reason: string | null } | null;
    const preview = (r.preview ?? {}) as ApprovalItem["preview"];
    let receipt_url: string | null = null;
    if (preview.receipt_path && r.status === "pending") {
      const { data } = await db().storage.from("receipts").createSignedUrl(preview.receipt_path, 600);
      receipt_url = data?.signedUrl ?? null;
    }
    return { id: r.id, action_id: r.action_id, agent_id: r.agent_id, title: r.title, reasoning: r.reasoning, status: r.status, created_at: r.created_at, decided_at: r.decided_at, preview, receipt_url, action_status: act?.status ?? "?", action_reason: act?.reason ?? null };
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
