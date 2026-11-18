import "server-only";
// Plans store (docs/company-mode.md, slice 4). A head plans its department's week with the Plan
// and review tool: its run's result is the plan's words and each line it hands in names a
// teammate (a 7-day focus note), an open seat, or the owner (a person's job). A run that hands in no
// lines while this week's plan exists is the review. Who a line names is matched against the chart
// in code; a plan grants nothing, and nothing here runs, sends or spends.
import { db } from "@/core/db";
import { setFocus } from "@/core/memory";
import { agentNames, below, liveAgentIds, loadOrg, seatOf, type Org } from "@/core/org";
import { chicagoDate } from "@/core/time";
import { FOCUS_DAYS, addDays, focusText, openJobs, planItems, runMode, weekOf, type PlanItem } from "@/core/plan-rules";

export interface Plan {
  id: string; department_id: string; head_agent: string | null; week_of: string; summary: string | null; items: PlanItem[];
  run_id: string | null; review: string | null; review_run_id: string | null; reviewed_at: string | null; created_at: string; updated_at: string;
}
export const PLANS_MISSING = "The plans table isn’t in Supabase yet: apply the migration 20261123090000_plans.sql.";
const COLS = "id, department_id, head_agent, week_of, summary, items, run_id, review, review_run_id, reviewed_at, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (m: string) => (/plans/.test(m) ? PLANS_MISSING : m);
const clip = (s: string, n: number) => s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

/** The head's department, team (live agents under its seat) and open seats, from the chart. */
async function reachOf(org: Org, agentId: string) {
  const seat = seatOf(org, agentId);
  if (!seat || seat.parentId != null) throw new Error("only a department head plans its department's week");
  if (!seat.departmentId) throw new Error("the company seat doesn't plan a department; heads do");
  const live = await liveAgentIds();
  const under = below(org, seat.id);
  const ids = under.filter((s) => s.holder === "agent" && s.agentId && live.has(s.agentId)).map((s) => s.agentId as string);
  const names = await agentNames([...ids, agentId]);
  return {
    deptId: seat.departmentId,
    head: names[agentId] ?? agentId,
    team: ids.map((id) => ({ id, name: names[id] ?? id })),
    openSeats: org.seats.filter((s) => s.departmentId === seat.departmentId && s.holder === "open").map((s) => ({ id: s.id, title: s.title })),
  };
}

export async function getPlan(deptId: string, week: string): Promise<Plan | null> {
  const { data, error } = await db().from("plans").select(COLS).eq("department_id", deptId).eq("week_of", week).maybeSingle();
  if (error) throw new Error(missing(error.message));
  return (data as Plan) ?? null;
}

/** The latest plans for a department, newest week first. Null when the table isn't there. */
export async function recentPlans(deptId: string, limit = 2): Promise<Plan[] | null> {
  const { data, error } = await db().from("plans").select(COLS).eq("department_id", deptId).order("week_of", { ascending: false }).limit(limit);
  return error ? null : (data ?? []) as Plan[];
}

/**
 * Saves the week's plan from a head's run: its result as the words, its lines as items. A teammate's
 * line becomes a 7-day focus note. Planning again in the same week replaces the plan.
 */
export async function savePlan(headId: string, runId: string | null, summary: string, lines: { title: string; who: string; words: string }[]): Promise<string> {
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const r = await reachOf(org, headId);
  const week = weekOf(chicagoDate(0));
  const { items, dropped } = planItems(lines, r);
  if (!items.length) throw new Error(`no line named anyone it can reach (${dropped.join("; ")})`);
  const until = addDays(chicagoDate(0), FOCUS_DAYS);
  let focused = 0;
  for (const it of items.filter((i) => i.kind === "agent")) {
    try { it.memoryId = await setFocus(it.agentId!, focusText(r.head, until, it.words), r.head, `plan:${week}:${r.deptId}`, FOCUS_DAYS); focused++; }
    catch (e) { dropped.push(`${it.who}'s focus wasn't saved: ${e instanceof Error ? e.message : e}`); }
  }
  const { error } = await db().from("plans").upsert({
    department_id: r.deptId, head_agent: headId, week_of: week, summary: clip(summary, 2000) || null, items, run_id: runId, updated_at: new Date().toISOString(),
  }, { onConflict: "department_id,week_of" });
  if (error) throw new Error(missing(error.message));
  const jobs = items.filter((i) => i.kind === "owner").length;
  return `plan for the week of ${week}: ${items.length} line${items.length === 1 ? "" : "s"}, ${focused} focus note${focused === 1 ? "" : "s"}, ${jobs} job${jobs === 1 ? "" : "s"} for the owner${dropped.length ? `; left out: ${dropped.join("; ")}` : ""}`;
}

/** Saves a head's review of its team on this week's plan. With no plan yet, the words become the plan. */
export async function saveReview(headId: string, runId: string | null, words: string): Promise<string> {
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const r = await reachOf(org, headId);
  const week = weekOf(chicagoDate(0));
  const text = clip(words, 2000);
  if (!text) return "nothing to save";
  const plan = await getPlan(r.deptId, week);
  if (!plan) {
    const { error } = await db().from("plans").insert({ department_id: r.deptId, head_agent: headId, week_of: week, summary: text, items: [], run_id: runId });
    if (error) throw new Error(missing(error.message));
    return `no plan this week yet, so its words are the plan for the week of ${week} (no lines)`;
  }
  const { error } = await db().from("plans").update({ review: text, review_run_id: runId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", plan.id);
  if (error) throw new Error(missing(error.message));
  return `review saved on the week of ${week}`;
}

/** The owner marks a person's job from a plan done (or not done). */
export async function setJobDone(planId: string, n: number, done: boolean): Promise<void> {
  if (!UUID.test(planId)) throw new Error("Unknown plan.");
  const { data, error } = await db().from("plans").select("items").eq("id", planId).maybeSingle();
  if (error || !data) throw new Error("That plan is gone.");
  const items = (data.items ?? []) as PlanItem[];
  const it = items.find((i) => i.n === n && i.kind === "owner");
  if (!it) throw new Error("That job isn't on the plan.");
  if (done) it.doneAt = new Date().toISOString(); else delete it.doneAt;
  const { error: e2 } = await db().from("plans").update({ items, updated_at: new Date().toISOString() }).eq("id", planId);
  if (e2) throw new Error(e2.message);
}

/** The This week tool: the department's plan for this week (if any), and whether this run plans or reviews. */
export async function weekView(agentId: string) {
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const r = await reachOf(org, agentId);
  const today = chicagoDate(0), week = weekOf(today);
  const plan = await getPlan(r.deptId, week);
  const mode = runMode(!!plan);
  return {
    data: {
      today, weekOf: week, weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      thisRun: mode === "plan"
        ? "There is no plan for this week yet: plan it. Hand in one line per job with Plan and review (who: a teammate under you, an open seat, or the owner), and write the plan in your result."
        : "This week's plan exists: review it. Hand in no lines; your result is the review of how your team did against the plan.",
      team: r.team.map((t) => t.name),
      openSeats: r.openSeats.map((s) => s.title),
      plan: plan ? { words: plan.summary, lines: plan.items.map((i) => ({ title: i.title, who: i.who, words: i.words, done: i.kind === "owner" ? !!i.doneAt : undefined })), review: plan.review } : null,
    },
    numbers: { plan_lines: plan?.items.length ?? 0, jobs_for_owner_open: plan ? openJobs(plan.items).length : 0 },
  };
}

/** Jobs from this week's plans that the owner hasn't marked done, for Needs you, with the department's goal page to open. Empty when the table isn't there. */
export async function openJobsThisWeek(): Promise<{ planId: string; head: string | null; title: string; href: string }[]> {
  const { data, error } = await db().from("plans").select("id, department_id, head_agent, items").eq("week_of", weekOf(chicagoDate(0)));
  if (error || !data?.length) return [];
  const { data: goals } = await db().from("goals").select("id, department_id").in("department_id", data.map((p) => p.department_id)).in("state", ["active", "paused"]).order("created_at");
  const goalOf = (dept: string) => (goals ?? []).find((g) => g.department_id === dept)?.id as string | undefined;
  return data.flatMap((p) => openJobs((p.items ?? []) as PlanItem[]).map((i) => {
    const goal = goalOf(p.department_id as string);
    return { planId: p.id as string, head: p.head_agent as string | null, title: i.title, href: goal ? `/goals/${goal}` : "/crew" };
  }));
}
