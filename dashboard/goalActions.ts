"use server";
// Goal actions (docs/company-mode.md, slice 2). Each checks the login again. Goals need no Controls:
// a goal is what the owner wants, never something an agent may do, and nothing here runs, sends or spends.
import { revalidatePath } from "next/cache";
import { createGoal, editGoal, setGoalState } from "@/core/goals";
import { setJobDone } from "@/core/plans";
import type { GoalState } from "@/core/goal-rules";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string, id?: string): ActionResult & { id?: string } => { revalidatePath("/", "layout"); return { ok: true, text, ...(id ? { id } : {}) }; };
const DEPT = /^[a-z][a-z0-9_]{1,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES: GoalState[] = ["active", "paused", "done", "dropped"];

export interface GoalForm { title: string; measure: string; target: string; dueOn: string }

export async function goalCreate(deptId: string, f: GoalForm): Promise<ActionResult & { id?: string }> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!DEPT.test(String(deptId))) return { ok: false, text: "Pick a department." };
  try { return done("Goal set. Code counts it from now.", await createGoal(deptId, f)); } catch (e) { return fail(e); }
}

/** `_dept` is unused: it keeps the same shape as goalCreate for the form. */
export async function goalEdit(id: string, _dept: string, f: GoalForm): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown goal." };
  try { await editGoal(id, f); return done("Goal saved."); } catch (e) { return fail(e); }
}

export async function goalSetState(id: string, state: GoalState): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id)) || !STATES.includes(state)) return { ok: false, text: "Unknown goal." };
  const words: Record<GoalState, string> = { active: "Goal is back on.", paused: "Goal paused. It stays on the chart, greyed.", done: "Marked done.", dropped: "Goal removed." };
  try { await setGoalState(id, state); return done(words[state]); } catch (e) { return fail(e); }
}

/** A person's job from a head's plan (slice 4): the owner marks it done, or not done. */
export async function planJobDone(planId: string, n: number, isDone: boolean): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(String(planId)) || !Number.isInteger(n)) return { ok: false, text: "Unknown job." };
  try { await setJobDone(planId, n, isDone); return done(isDone ? "Marked done." : "Back on your list."); } catch (e) { return fail(e); }
}
