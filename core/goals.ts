import "server-only";
// Goals store (docs/company-mode.md, slice 2): a department's goals in Supabase, each with a measure
// from the list in code. The rules (what a goal may hold, pace, status) are in core/goal-rules.ts;
// the counting is in core/measures.ts. Callers check the login. A goal decides nothing an agent may
// do: it is what the owner wants, read by heads (goal_progress) and shown on Crew, the home page and its own page.
import { db } from "@/core/db";
import { chicagoDate } from "@/core/time";
import { MAX_GOALS_PER_DEPT, measureOf, planGoal, progress, STATUS_WORDS, type GoalInput, type GoalRow, type GoalState, type Progress } from "@/core/goal-rules";
import { readMeasures, type Detail } from "@/core/measures";
import { headOf, loadOrg, seatOf, type Org } from "@/core/org";

export interface Goal extends GoalRow { id: string; department_id: string; title: string; created_at: string; updated_at: string }
export interface GoalNow { goal: Goal; progress: Progress; detail: Detail }

const COLS = "id, department_id, title, measure, target, start_value, due_on, state, paced_from, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toGoal = (r: Record<string, unknown>): Goal => ({
  ...(r as unknown as Goal),
  target: r.target == null ? null : Number(r.target), start_value: r.start_value == null ? null : Number(r.start_value),
});
export const GOALS_MISSING = "The goals table isn’t in Supabase yet: apply the migration 20261121090000_goals.sql.";

/** Active and paused goals (done and dropped ones are history), oldest first. Null when the table isn't there. */
export async function listGoals(deptIds?: readonly string[]): Promise<Goal[] | null> {
  let q = db().from("goals").select(COLS).in("state", ["active", "paused"]).order("created_at");
  if (deptIds) q = q.in("department_id", [...deptIds]);
  const { data, error } = await q.limit(100);
  return error ? null : (data ?? []).map(toGoal);
}

export async function getGoal(id: string): Promise<Goal | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db().from("goals").select(COLS).eq("id", id).maybeSingle();
  return error || !data ? null : toGoal(data);
}

/** Each goal with its measure read once and its pace worked out in code. */
export async function goalsNow(goals: Goal[], now = new Date()): Promise<GoalNow[]> {
  const reads = await readMeasures(goals.map((g) => g.measure), now);
  const today = chicagoDate(0, now);
  return goals.map((g) => ({ goal: g, progress: progress(g, g.measure ? reads[g.measure]?.reading ?? null : null, today), detail: g.measure ? reads[g.measure]?.detail ?? null : null }));
}

/** Where a total measure stands now, so pace counts from the day the goal was set. Null when it can't be read. */
async function startOf(measure: string | null): Promise<number | null> {
  const m = measureOf(measure);
  if (!m?.available || m.shape !== "total") return null;
  const r = (await readMeasures([m.key]))[m.key]?.reading;
  return r && "value" in r ? r.value : null;
}

export async function createGoal(deptId: string, input: GoalInput): Promise<string> {
  const org = await loadOrg();
  if (!org?.departments.some((d) => d.id === deptId)) throw new Error("That department isn’t on the chart.");
  const got = planGoal(input, chicagoDate(0));
  if ("error" in got) throw new Error(got.error);
  const open = await listGoals([deptId]);
  if (open == null) throw new Error(GOALS_MISSING);
  if (open.length >= MAX_GOALS_PER_DEPT) throw new Error(`A department holds ${MAX_GOALS_PER_DEPT} goals at most. Mark one done or remove it first.`);
  const p = got.plan;
  const { data, error } = await db().from("goals").insert({
    department_id: deptId, title: p.title, measure: p.measure, target: p.target, due_on: p.dueOn, start_value: await startOf(p.measure),
  }).select("id").single();
  if (error) throw new Error(/goals/.test(error.message) ? GOALS_MISSING : error.message);
  return data.id as string;
}

/** Changes the words, measure, target or date. A new measure starts its pace again from today. */
export async function editGoal(id: string, input: GoalInput): Promise<void> {
  const g = await getGoal(id);
  if (!g || g.state === "dropped") throw new Error("That goal isn’t there any more.");
  const got = planGoal(input, chicagoDate(0));
  if ("error" in got) throw new Error(got.error);
  const p = got.plan;
  const fresh = p.measure !== g.measure;
  const { error } = await db().from("goals").update({
    title: p.title, measure: p.measure, target: p.target, due_on: p.dueOn, updated_at: new Date().toISOString(),
    ...(fresh ? { start_value: await startOf(p.measure), paced_from: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

const NEXT: Record<GoalState, GoalState[]> = { active: ["paused", "done", "dropped"], paused: ["active", "done", "dropped"], done: ["active"], dropped: [] };
export async function setGoalState(id: string, state: GoalState): Promise<void> {
  const g = await getGoal(id);
  if (!g) throw new Error("That goal isn’t there any more.");
  if (!NEXT[g.state].includes(state)) throw new Error(`A ${g.state} goal can’t become ${state}.`);
  if (state === "active" && g.state === "done") {
    const open = await listGoals([g.department_id]);
    if ((open?.length ?? 0) >= MAX_GOALS_PER_DEPT) throw new Error(`A department holds ${MAX_GOALS_PER_DEPT} goals at most.`);
  }
  const { error } = await db().from("goals").update({ state, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Who owns a department's goals: the agent (or the owner) in its head seat. */
export function ownerOf(org: Org, deptId: string): { agentId: string | null; label: string } {
  const h = headOf(org, deptId);
  if (h?.holder === "agent" && h.agentId) return { agentId: h.agentId, label: h.title };
  if (h?.holder === "owner") return { agentId: null, label: "you" };
  return { agentId: null, label: "an open head seat" };
}

/**
 * The goal_progress tool (core/tools/catalog.ts): the goals of the agent's own department, or of
 * every department for the company seat, read from the chart in code. Numbers are code's.
 */
export async function goalProgress(agentId: string) {
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const seat = seatOf(org, agentId);
  if (!seat) throw new Error("This agent isn't on the org chart, so it has no department goals. Put it in a seat in builder step 1.");
  const depts = seat.departmentId ? org.departments.filter((d) => d.id === seat.departmentId) : org.departments;
  const goals = await listGoals(depts.map((d) => d.id));
  if (goals == null) throw new Error(GOALS_MISSING);
  const rows = await goalsNow(goals);
  const numbers: Record<string, number> = { goals: rows.length };
  const data = rows.map(({ goal: g, progress: p, detail }, i) => {
    const k = `g${i + 1}`, m = measureOf(g.measure);
    if (p.value != null) numbers[`${k}_value`] = p.value;
    if (g.target != null) numbers[`${k}_target`] = g.target;
    if (detail && "funnel" in detail) for (const [s, n] of Object.entries(detail.funnel)) numbers[`${k}_${s}`] = n;
    return {
      key: k, department: depts.find((d) => d.id === g.department_id)?.name ?? g.department_id, goal: g.title,
      measure: m ? m.label : null, measuredHow: m?.how ?? null, status: STATUS_WORDS[p.status], progress: p.line, pace: p.pace,
      dueOn: g.due_on, paused: g.state === "paused",
      ...(detail && "lots" in detail ? { lots: detail.lots } : {}),
    };
  });
  numbers.goals_behind = rows.filter((r) => r.progress.status === "behind" || r.progress.status === "missed").length;
  return { data: { scope: seat.departmentId ? "your department" : "every department", goals: data, note: data.length ? undefined : "No goals set yet. The owner sets them on Crew." }, numbers };
}
