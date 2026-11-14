import "server-only";
// The org chart store (docs/org-chart.md): departments and seats in Supabase. The rules (tree,
// limits, who reports to whom) are in core/org-rules.ts, which the browser can use too.
// Callers check the login and that an agent id is one the Control Room knows.
import { db } from "@/core/db";
import { chicagoDate, offsetOn } from "@/core/time";
import {
  MAX_DEPARTMENTS, MAX_DEPTH, checkerOf, MAX_SEATS, agentsIn, childrenOf, cleanSub, cleanTitle, deptBudgetChange, deptEmailChange, depthOf, deptOf, deptSlug, headOf,
  type Department, type Holder, type Org, type Seat,
} from "@/core/org-rules";

export * from "@/core/org-rules";

interface DeptRow { id: string; name: string; sort: number; monthly_budget_usd: number | string | null; max_emails_per_day: number | null; lead_checks_drafts: boolean | null }
interface SeatRow { id: string; department_id: string | null; parent_id: string | null; title: string; sub: string; holder: Holder; agent_id: string | null; sort: number }

const toDept = (r: DeptRow): Department => ({ id: r.id, name: r.name, sort: r.sort, monthlyBudgetUsd: r.monthly_budget_usd == null ? null : Number(r.monthly_budget_usd), maxEmailsPerDay: r.max_emails_per_day, leadChecksDrafts: !!r.lead_checks_drafts });
const toSeat = (r: SeatRow): Seat => ({ id: r.id, departmentId: r.department_id, parentId: r.parent_id, title: r.title, sub: r.sub ?? "", holder: r.holder, agentId: r.agent_id, sort: r.sort });

/** The chart. Null when the org chart migration isn't applied yet. */
export async function loadOrg(): Promise<Org | null> {
  const [d, s] = await Promise.all([
    // lead_checks_drafts is slice 4; until that migration is applied the chart loads without it (off)
    db().from("departments").select("id, name, sort, monthly_budget_usd, max_emails_per_day, lead_checks_drafts").order("sort")
      .then((r) => (r.error ? db().from("departments").select("id, name, sort, monthly_budget_usd, max_emails_per_day").order("sort") : r)),
    db().from("seats").select("id, department_id, parent_id, title, sub, holder, agent_id, sort").order("sort"),
  ]);
  if (d.error || s.error) return null;
  return { departments: ((d.data ?? []) as DeptRow[]).map(toDept), seats: ((s.data ?? []) as SeatRow[]).map(toSeat) };
}

async function mustLoad(): Promise<Org> {
  const o = await loadOrg();
  if (!o) throw new Error("The org chart tables aren’t up to date: apply the org chart migrations (20261115090000_org_chart.sql, 20261116090000_department_budgets.sql).");
  return o;
}

const mustSeat = (o: Org, id: string) => {
  const s = o.seats.find((x) => x.id === id);
  if (!s) throw new Error("That seat isn’t on the chart any more.");
  return s;
};

/** A new department with an open head seat. Returns its id. */
export async function addDepartment(name: string): Promise<string> {
  const o = await mustLoad();
  const n = cleanTitle(name);
  if (!n) throw new Error("Give the department a name.");
  if (o.departments.length >= MAX_DEPARTMENTS) throw new Error(`A chart holds ${MAX_DEPARTMENTS} departments at most.`);
  if (o.seats.length >= MAX_SEATS) throw new Error(`A chart holds ${MAX_SEATS} seats at most.`);
  if (o.departments.some((d) => d.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a ${n} department.`);
  let id = deptSlug(n);
  for (let i = 2; o.departments.some((d) => d.id === id); i++) id = `${deptSlug(n).slice(0, 36)}_${i}`;
  const sort = Math.max(0, ...o.departments.map((d) => d.sort)) + 1;
  const a = await db().from("departments").insert({ id, name: n, sort });
  if (a.error) throw new Error(a.error.message);
  const b = await db().from("seats").insert({ department_id: id, parent_id: null, title: `Head of ${n.toLowerCase()}`.slice(0, 60), sub: "", holder: "open", sort: 0 });
  if (b.error) { await db().from("departments").delete().eq("id", id); throw new Error(b.error.message); }
  return id;
}

export async function renameDepartment(id: string, name: string) {
  const o = await mustLoad();
  const n = cleanTitle(name);
  if (!n) throw new Error("Give the department a name.");
  if (!o.departments.some((d) => d.id === id)) throw new Error("That department isn’t on the chart any more.");
  if (o.departments.some((d) => d.id !== id && d.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a ${n} department.`);
  const { error } = await db().from("departments").update({ name: n }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Only a department where nobody sits: every seat open. Its seats go with it. */
export async function removeDepartment(id: string) {
  const o = await mustLoad();
  const d = o.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  const seats = o.seats.filter((s) => s.departmentId === id);
  const held = seats.filter((s) => s.holder !== "open");
  if (held.length) throw new Error(`Move ${held.map((s) => `“${s.title}”`).join(", ")} out of ${d.name} first: only a department with every seat open can be removed.`);
  // its rules are kept for the timeline, marked forgotten (nothing in agent_memory is deleted)
  const { data: rules } = await db().from("agent_memory").select("id, text").eq("grp", "department").eq("department_id", id).eq("state", "kept");
  for (const r of rules ?? []) {
    await db().from("agent_memory").update({ state: "forgotten", updated_at: new Date().toISOString() }).eq("id", r.id);
    await db().from("memory_events").insert({ memory_id: r.id, agent_id: null, department_id: id, kind: "forgotten", before: r.text, after: null, by: `zak (control room), ${d.name} removed` });
  }
  // deepest first, so no seat is removed while another still sits under it
  const order = [...seats].sort((a, b) => depthOf(o, b) - depthOf(o, a));
  for (const s of order) {
    const { error } = await db().from("seats").delete().eq("id", s.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await db().from("departments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** A new open seat under another seat in a department. Returns its id. */
export async function addSeat(parentId: string, title: string, sub: string): Promise<string> {
  const o = await mustLoad();
  const parent = mustSeat(o, parentId);
  if (parent.departmentId == null) throw new Error("Seats go inside a department. Add a department for a new head.");
  const t = cleanTitle(title);
  if (!t) throw new Error("Give the seat a name.");
  if (o.seats.length >= MAX_SEATS) throw new Error(`A chart holds ${MAX_SEATS} seats at most.`);
  if (depthOf(o, parent) + 1 > MAX_DEPTH) throw new Error(`A department goes ${MAX_DEPTH} levels deep at most.`);
  const sort = Math.max(0, ...childrenOf(o, parentId).map((s) => s.sort)) + 1;
  const { data, error } = await db().from("seats").insert({ department_id: parent.departmentId, parent_id: parentId, title: t, sub: cleanSub(sub), holder: "open", sort }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function editSeat(id: string, title: string, sub: string) {
  const o = await mustLoad();
  mustSeat(o, id);
  const t = cleanTitle(title);
  if (!t) throw new Error("Give the seat a name.");
  const { error } = await db().from("seats").update({ title: t, sub: cleanSub(sub), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Only an open seat with nothing under it. A head goes with its department. */
export async function removeSeat(id: string) {
  const o = await mustLoad();
  const s = mustSeat(o, id);
  if (s.departmentId == null) throw new Error("The company seat stays.");
  if (headOf(o, s.departmentId)?.id === id) throw new Error("A department keeps its head seat. Remove the department instead.");
  if (s.holder !== "open") throw new Error("Move whoever sits there out first.");
  if (childrenOf(o, id).length) throw new Error("Remove the seats under it first.");
  const { error } = await db().from("seats").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Who sits in a seat. An agent moves: its old seat opens. The caller has checked the agent id is
 * one the Control Room knows.
 */
export async function setHolder(seatId: string, holder: Holder, agentId: string | null) {
  const o = await mustLoad();
  const s = mustSeat(o, seatId);
  if (holder === "agent" && !agentId) throw new Error("Pick an agent.");
  const now = new Date().toISOString();
  if (holder === "agent") {
    const was = o.seats.find((x) => x.agentId === agentId && x.id !== seatId);
    if (was) {
      const { error } = await db().from("seats").update({ holder: "open", agent_id: null, updated_at: now }).eq("id", was.id);
      if (error) throw new Error(error.message);
    }
  }
  const { error } = await db().from("seats").update({ holder, agent_id: holder === "agent" ? agentId : null, updated_at: now }).eq("id", s.id);
  if (error) throw new Error(error.message);
}

/** Takes an agent off the chart: its seat opens. */
export async function unseat(agentId: string) {
  const { error } = await db().from("seats").update({ holder: "open", agent_id: null, updated_at: new Date().toISOString() }).eq("agent_id", agentId);
  if (error) throw new Error(error.message);
}

// ---- Teams (slice 3)

/** Agents that exist (rows in agents), as opposed to planned ones on the chart. */
export async function liveAgentIds(): Promise<Set<string>> {
  const { data, error } = await db().from("agents").select("id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.id as string));
}

/** Each agent's name from its active spec, or its id. */
export async function agentNames(agentIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = Object.fromEntries(agentIds.map((id) => [id, id]));
  if (!agentIds.length) return out;
  const { data } = await db().from("agent_defs").select("agent_id, spec").in("agent_id", agentIds).eq("active", true);
  for (const r of data ?? []) { const n = (r.spec as { name?: unknown } | null)?.name; if (typeof n === "string" && n.trim()) out[r.agent_id] = n.trim().slice(0, 60); }
  return out;
}

export interface RunStats { runs: number; ok: number; failed: number; skipped: number; costUsd: number; lastError: string | null }

/** How each agent's runs went since a time (tries from the builder left out). Counted and added up in code. */
export async function runStats(agentIds: string[], since: string): Promise<Record<string, RunStats>> {
  const out: Record<string, RunStats> = Object.fromEntries(agentIds.map((id) => [id, { runs: 0, ok: 0, failed: 0, skipped: 0, costUsd: 0, lastError: null }]));
  if (!agentIds.length) return out;
  const { data, error } = await db().from("agent_runs").select("agent_id, status, cost_usd, error, started_at").in("agent_id", agentIds).gte("started_at", since).neq("trigger", "preview").order("started_at").limit(2000);
  if (error) throw new Error(error.message);
  const cents: Record<string, number> = {};
  for (const r of data ?? []) {
    const s = out[r.agent_id];
    if (!s) continue;
    s.runs++;
    if (r.status === "ok") s.ok++; else if (r.status === "failed") { s.failed++; s.lastError = (r.error ?? "").slice(0, 200) || "no error recorded"; } else if (r.status === "skipped") s.skipped++;
    cents[r.agent_id] = (cents[r.agent_id] ?? 0) + Math.round(Number(r.cost_usd) * 100);
  }
  for (const id of agentIds) out[id].costUsd = (cents[id] ?? 0) / 100;
  return out;
}

/** The latest finished saved output of each agent (core/runner.ts writes agent_outputs). Words are the agent's, so untrusted. */
export async function latestOutputs(agentIds: string[]): Promise<Record<string, { name: string; summary: string; numbers: { label: string; value: number }[]; at: string }>> {
  if (!agentIds.length) return {};
  const { data, error } = await db().from("agent_outputs").select("agent_id, name, summary, numbers, created_at").in("agent_id", agentIds).eq("finished", true).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  const out: Record<string, { name: string; summary: string; numbers: { label: string; value: number }[]; at: string }> = {};
  for (const r of data ?? []) {
    if (out[r.agent_id]) continue;
    const nums = (Array.isArray(r.numbers) ? r.numbers : []) as { label: string; value: number }[];
    out[r.agent_id] = { name: r.name, summary: String(r.summary ?? "").slice(0, 800), numbers: nums.filter((n) => Number.isFinite(n.value)).slice(0, 12), at: r.created_at };
  }
  return out;
}

// ---- Department limits (slice 2)

/** Midnight at the start of this Chicago calendar month, as an ISO time. */
export function chicagoMonthStart(now = new Date()) {
  const first = `${chicagoDate(0, now).slice(0, 8)}01`;
  return new Date(`${first}T00:00:00${offsetOn(first)}`).toISOString();
}
/** "2026-11": this Chicago calendar month. */
export const chicagoMonth = (now = new Date()) => chicagoDate(0, now).slice(0, 7);

/** AI spend this Chicago month per agent, from agent_runs (cost computed by the runner, added up here in code). */
export async function monthSpendByAgent(agentIds: string[], now = new Date()): Promise<Record<string, number>> {
  if (!agentIds.length) return {};
  const { data, error } = await db().from("agent_runs").select("agent_id, cost_usd").in("agent_id", agentIds).gte("started_at", chicagoMonthStart(now)).limit(20000);
  if (error) throw new Error(error.message);
  const cents: Record<string, number> = {};
  for (const r of data ?? []) cents[r.agent_id] = (cents[r.agent_id] ?? 0) + Math.round(Number(r.cost_usd) * 100);
  return Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, v / 100]));
}

/**
 * The department an agent sits in, with what its agents spent this month. Null when the agent
 * isn't in a department, or the org chart tables aren't there.
 */
export async function agentDepartment(agentId: string, opts: { spend?: boolean } = {}): Promise<{ dept: Department; spentUsd: number } | null> {
  const o = await loadOrg();
  const d = o ? deptOf(o, agentId) : null;
  if (!o || !d) return null;
  if (!opts.spend) return { dept: d, spentUsd: 0 };
  const ids = agentsIn(o, d.id);
  const by = await monthSpendByAgent(ids);
  return { dept: d, spentUsd: ids.reduce((s, id) => s + Math.round((by[id] ?? 0) * 100), 0) / 100 };
}

/**
 * Marks that Zak was told this month that the department is at its budget. True only for the
 * first caller this month, so a department sends one alert a month however many runs it skips.
 */
export async function claimBudgetAlert(deptId: string, now = new Date()): Promise<boolean> {
  const month = chicagoMonth(now);
  const { data, error } = await db().from("departments").update({ budget_alerted: month }).eq("id", deptId).or(`budget_alerted.is.null,budget_alerted.neq.${month}`).select("id");
  return !error && !!data?.length;
}

/** Sets a department's monthly budget (null: none). The caller checks Controls and the confirm for a looser one. */
export async function setDeptBudget(id: string, next: number | null) {
  const o = await mustLoad();
  const d = o.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  const ch = deptBudgetChange(d.monthlyBudgetUsd, next);
  if ("refuse" in ch) throw new Error(ch.refuse);
  // a new budget gets a fresh alert if it is reached again this month
  const { error } = await db().from("departments").update({ monthly_budget_usd: next, budget_alerted: null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Sets a department's email cap (null: the company cap), never above the company cap. */
export async function setDeptEmailCap(id: string, next: number | null, companyCap: number) {
  const o = await mustLoad();
  const d = o.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  const ch = deptEmailChange(d.maxEmailsPerDay, next, companyCap);
  if ("refuse" in ch) throw new Error(ch.refuse);
  const { error } = await db().from("departments").update({ max_emails_per_day: next }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Turns "Lead checks drafts first" on or off for a department. Either way Zak's tap is the only approval. */
export async function setLeadChecks(id: string, on: boolean) {
  const o = await mustLoad();
  if (!o.departments.some((x) => x.id === id)) throw new Error("That department isn’t on the chart any more.");
  const { error } = await db().from("departments").update({ lead_checks_drafts: on }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Who checks this agent's next draft first, read fresh from the chart; null when nobody does (or the chart can't be read). */
export async function draftChecker(agentId: string): Promise<{ reviewer: string; departmentId: string } | null> {
  const o = await loadOrg().catch(() => null);
  if (!o) return null;
  const live = await liveAgentIds().catch(() => new Set<string>());
  const { data } = await db().from("agent_defs").select("agent_id").eq("active", true).contains("spec", { tools: ["check_team_draft"] });
  return checkerOf(o, agentId, live, new Set((data ?? []).map((r) => r.agent_id as string)));
}

/** The department an agent's draft is tagged with on Approvals: the one its seat is in now. */
export async function draftDepartment(agentId: string): Promise<string | null> {
  const o = await loadOrg().catch(() => null);
  return o ? deptOf(o, agentId)?.id ?? null : null;
}
