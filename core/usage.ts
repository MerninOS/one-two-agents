import "server-only";
// The usage ledger (docs/usage.md): what the current org spent, read in one place. Rows are written
// by the database from agent_runs (supabase/migrations/20261207090000_usage_ledger.sql), so a run
// can't skip it. Totals are added up here in cents, in code.
import { db } from "@/core/db";

/** Spend per agent since a time, in dollars: each row to the cent, then added up. */
export async function spendByAgent(agentIds: string[], since: string): Promise<Record<string, number>> {
  if (!agentIds.length) return {};
  const { data, error } = await db().from("usage_ledger").select("agent_id, cost_usd").in("agent_id", agentIds).gte("at", since).limit(50000);
  if (error) throw new Error(`the usage ledger: ${error.message}`);
  const cents: Record<string, number> = {};
  for (const r of data ?? []) cents[r.agent_id] = (cents[r.agent_id] ?? 0) + Math.round(Number(r.cost_usd) * 100);
  return Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, v / 100]));
}

/** One agent's spend since a time, in dollars, as stored (the daily budget compares this). */
export async function agentSpend(agentId: string, since: string): Promise<number> {
  const { data, error } = await db().from("usage_ledger").select("cost_usd").eq("agent_id", agentId).gte("at", since).limit(50000);
  if (error) throw new Error(`the usage ledger: ${error.message}`);
  return (data ?? []).reduce((a, r) => a + Number(r.cost_usd), 0);
}
