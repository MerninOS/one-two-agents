import "server-only";
// Goals as the Control Room draws them (docs/company-mode.md, slice 2): plain data for
// components/goals.tsx, built from core/goals.ts. Every number and status comes from code.
import { agentNames, loadOrg, type Org } from "@/core/org";
import { measureOf, STATUS_WORDS, type GoalStatus, type MeasureDef } from "@/core/goal-rules";
import { goalsNow, listGoals, ownMeasureDefs, ownerOf, type GoalNow } from "@/core/goals";
import type { Detail } from "@/core/measures";

export interface GoalView {
  id: string; deptId: string; deptName: string; title: string;
  status: GoalStatus; statusLabel: string;
  line: string; pace: string | null; pct: number | null;
  measure: string | null; how: string | null; needs: string | null;
  target: number | null; dueOn: string | null; paused: boolean;
  owner: string; setOn: string;
  detail: Detail;
}

export function goalView(n: GoalNow, org: Org, names: Record<string, string>, own: readonly MeasureDef[] = []): GoalView {
  const g = n.goal, m = measureOf(g.measure, own), o = ownerOf(org, g.department_id);
  return {
    id: g.id, deptId: g.department_id, deptName: org.departments.find((d) => d.id === g.department_id)?.name ?? g.department_id, title: g.title,
    status: n.progress.status, statusLabel: STATUS_WORDS[n.progress.status], line: n.progress.line, pace: n.progress.pace, pct: n.progress.pct,
    measure: m?.label ?? null, how: m?.how ?? null, needs: m && !m.available ? m.needs ?? null : null,
    target: g.target, dueOn: g.due_on, paused: g.state === "paused",
    owner: o.agentId ? `${names[o.agentId] ?? o.agentId}, ${o.label}` : o.label, setOn: g.created_at,
    detail: n.detail,
  };
}

/** Every active and paused goal with where it stands, by department id. Null when the goals table isn't there. */
export async function goalsByDept(org: Org | null): Promise<Record<string, GoalView[]> | null> {
  if (!org) return {};
  const goals = await listGoals();
  if (goals == null) return null;
  const [now, own] = await Promise.all([goalsNow(goals), ownMeasureDefs()]);
  const heads = org.departments.map((d) => ownerOf(org, d.id).agentId).filter((x): x is string => !!x);
  const names = await agentNames(heads).catch(() => ({} as Record<string, string>));
  const out: Record<string, GoalView[]> = {};
  for (const n of now) (out[n.goal.department_id] ??= []).push(goalView(n, org, names, own));
  return out;
}

/** Departments on the chart, for the new-goal form. */
export async function deptChoices(): Promise<{ id: string; name: string }[]> {
  const org = await loadOrg().catch(() => null);
  return org ? org.departments.map((d) => ({ id: d.id, name: d.name })) : [];
}
