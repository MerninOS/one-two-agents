import "server-only";
// Everything the Control Room reads. Server only: the service-role client never reaches
// the browser, and every function checks the login first.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/core/db";
import { env } from "@/core/env";
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
}

const RUN_COLS = "id, agent_id, trigger, started_at, ended_at, status, tokens_in, tokens_out, cost_usd, summary, error";
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
  const empty: Floor = { ok: false, now, agents: {}, runs: [], spentToday: {}, health: h, photosWaiting: null };
  if (!h.supabase) return { ...empty, problem: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so there is nothing to show yet." };
  const since = new Date(now - 60 * 864e5).toISOString();
  const [a, r, ph] = await Promise.all([
    db().from("agents").select("id, name, model, schedule, enabled, daily_budget_usd"),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    db().from("expense_docs").select("id", { count: "exact", head: true }).eq("status", "needs_photo"),
  ]);
  if (a.error || r.error) return { ...empty, problem: `Supabase: ${(a.error ?? r.error)?.message}` };
  const agents = Object.fromEntries((a.data ?? []).map((x) => [x.id, { ...x, daily_budget_usd: Number(x.daily_budget_usd) } as AgentRow]));
  const runs = (r.data ?? []).map(toRun);
  const d0 = budgetDayStart(new Date(now)).getTime();
  const spentToday: Record<string, number> = Object.fromEntries(BUILT.map((b) => [b.id, 0]));
  for (const run of runs) if (Date.parse(run.started_at) >= d0) spentToday[run.agent_id] = (spentToday[run.agent_id] ?? 0) + run.cost_usd;
  return { ok: true, now, agents, runs, spentToday, health: h, photosWaiting: ph.error ? null : ph.count ?? 0 };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRun(id: string): Promise<Run | null> {
  await requireSession();
  if (!UUID.test(id) || !health().supabase) return null;
  const { data } = await db().from("agent_runs").select(RUN_COLS).eq("id", id).maybeSingle();
  return data ? toRun(data) : null;
}

export interface Pipeline { stages: Record<string, number>; total: number; domains: string[] }

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
