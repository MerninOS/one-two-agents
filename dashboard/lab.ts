import "server-only";
// Data for the runner's test page (/lab, agent builder slice 1): the agents built in the app,
// their active spec, and their latest preview runs with every step.
import { db } from "@/core/db";
import { loadSpec, type SpecVersion } from "@/core/agent-spec";
import { TOOLS } from "@/core/tools/catalog";
import { env } from "@/core/env";

export interface LabStep {
  idx: number; kind: "model" | "tool" | "stop"; tool: string | null; toolLabel: string | null; input: unknown; output: string | null;
  ok: boolean; numbers: Record<string, number> | null; tokens_in: number; tokens_out: number; cost_usd: number; ms: number;
}
export interface LabRun { id: string; started_at: string; ended_at: string | null; status: string; summary: string | null; error: string | null; cost_usd: number; tokens_in: number; tokens_out: number; steps: LabStep[] }
export interface LabTool { id: string; label: string; detail: string; kind: string; group: string; trusted: boolean; connected: boolean }
export interface LabAgent { id: string; name: string; enabled: boolean; budget: number; spec: SpecVersion | null; specError: string | null; tools: LabTool[]; runs: LabRun[] }

// a tool is Connected when every setting it needs is present (values are never shown)
const SETTING: Record<string, unknown> = {
  SHOPIFY_STORE_DOMAIN: env.shopifyDomain && (env.shopifyAdminToken || (env.shopifyClientId && env.shopifyClientSecret)),
  MERCURY_API_TOKEN: env.mercuryToken, NOTION_TOKEN: env.notionToken,
  SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey,
};

/** Null when the runner migration isn't applied yet. */
export async function getLab(): Promise<{ agents: LabAgent[] } | null> {
  const { data: defs, error } = await db().from("agent_defs").select("agent_id").eq("active", true);
  if (error) return null;
  const ids = [...new Set((defs ?? []).map((d) => d.agent_id as string))];
  if (!ids.length) return { agents: [] };
  const { data: rows } = await db().from("agents").select("id, name, enabled, daily_budget_usd").in("id", ids);
  const agents: LabAgent[] = [];
  for (const a of rows ?? []) {
    let spec: SpecVersion | null = null, specError: string | null = null;
    try { spec = await loadSpec(a.id); } catch (e) { specError = e instanceof Error ? e.message : String(e); }
    const { data: runs } = await db().from("agent_runs").select("id, started_at, ended_at, status, summary, error, cost_usd, tokens_in, tokens_out").eq("agent_id", a.id).order("started_at", { ascending: false }).limit(5);
    const runIds = (runs ?? []).map((r) => r.id);
    const { data: steps } = runIds.length ? await db().from("run_steps").select("run_id, idx, kind, tool, input, output, ok, numbers, tokens_in, tokens_out, cost_usd, ms").in("run_id", runIds).order("idx") : { data: [] };
    agents.push({
      id: a.id, name: a.name, enabled: a.enabled, budget: Number(a.daily_budget_usd), spec, specError,
      tools: (spec?.spec.tools ?? []).map((id) => TOOLS[id]).filter((t) => !!t).map((t) => ({ id: t.id, label: t.label, detail: t.detail, kind: t.kind, group: t.group, trusted: t.trusted, connected: t.needs.every((k) => !!SETTING[k]) })),
      runs: (runs ?? []).map((r) => ({
        ...r, cost_usd: Number(r.cost_usd),
        steps: (steps ?? []).filter((s) => s.run_id === r.id).map((s) => ({ ...s, cost_usd: Number(s.cost_usd), toolLabel: s.tool ? TOOLS[s.tool]?.label ?? s.tool : null })) as LabStep[],
      })),
    });
  }
  return { agents };
}
