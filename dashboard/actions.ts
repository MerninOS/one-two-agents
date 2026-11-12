"use server";
// Control Room actions. Each one checks the login again. Anything that can spend money
// or wake an agent also needs DASHBOARD_CONTROLS=on; stopping things never does.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { AGENTS } from "@/agents/registry";
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { discardLesson, editMemory, forgetMemory, keepLesson, proposeLesson, teach as teachMemory, type Keep } from "@/core/memory";
import { applyApproved, decide, queueBookkeeperProposals, retry, writeBlocker } from "@/core/gateway";
import { BUILT, BY_ID } from "./crew";
import { requireSession } from "./data";
import { SESSION_COOKIE, SESSION_DAYS, checkPassword, controlsOn, newSessionToken } from "./session";

export interface ActionResult { ok: boolean; text: string }

const CONTROLS_OFF = "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this.";
const known = (id: string) => !!AGENTS[id] && !!BY_ID[id];
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });

export async function login(_: { error?: string } | undefined, form: FormData) {
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  if (!checkPassword(password)) return { error: process.env.DASHBOARD_PASSWORD ? "That password doesn’t match." : "DASHBOARD_PASSWORD isn’t set, so nobody can sign in yet." };
  (await cookies()).set(SESSION_COOKIE, newSessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  // only same-site paths
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** Reads real data, writes nothing, calls no model, logs nothing. */
export async function dryRun(agentId: string): Promise<ActionResult> {
  await requireSession();
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  try {
    const res = await AGENTS[agentId].job({ dryRun: true });
    return { ok: true, text: res.summary };
  } catch (e) { return fail(e); }
}

/**
 * A real run, logged in agent_runs as manual. withRun still skips it when the agent is off duty or over budget.
 * The run keeps going in the background (after()), so this returns as soon as its row is written and the
 * dashboard stays usable; the layout polls until the row finishes. A skip or a failure to start comes back at once.
 */
export async function realRun(agentId: string): Promise<ActionResult> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  const name = BY_ID[agentId].name;
  // one at a time: a row still "running" inside the 6 minute window means a run is going
  const { data: going } = await db().from("agent_runs").select("id").eq("agent_id", agentId).eq("status", "running").gte("started_at", new Date(Date.now() - 6 * 6e4).toISOString()).limit(1);
  if (going?.length) return { ok: false, text: `${name} is already working. Wait for that run to finish.` };

  let markStarted: () => void = () => {};
  const started = new Promise<null>((resolve) => { markStarted = () => resolve(null); });
  const run = withRun(agentId, "manual", (runId, memory) => { markStarted(); return AGENTS[agentId].job({ runId, memory }); })
    .then((res) => ({ res }), (err: unknown) => { console.error(`[control-room] ${agentId} run failed`, err); return { err }; });
  after(run);
  const first = await Promise.race([started, run]);
  revalidatePath("/", "layout");
  if (first === null) return { ok: true, text: `${name} is working. Keep using the app; ${name} pulses until the run is done.` };
  if ("err" in first) return fail(first.err);
  return { ok: first.res.status === "ok", text: `${name}: ${first.res.status === "skipped" ? "skipped, " : ""}${first.res.summary}` };
}

export async function setEnabled(agentId: string, on: boolean): Promise<ActionResult> {
  await requireSession();
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  if (on && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const { error } = await db().from("agents").update({ enabled: on }).eq("id", agentId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  const name = BY_ID[agentId].name;
  return { ok: true, text: on ? `${name} is back on the crew.` : `${name} is off duty. Every run is skipped at $0.` };
}

export async function pauseAll(): Promise<ActionResult> {
  await requireSession();
  const { error } = await db().from("agents").update({ enabled: false }).in("id", BUILT.map((a) => a.id));
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, text: "Every agent is off duty." };
}

export async function setBudget(agentId: string, value: number): Promise<ActionResult> {
  await requireSession();
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  if (!(Number.isFinite(value) && value >= 0 && value <= 50)) return { ok: false, text: "Pick a budget between $0 and $50 a day." };
  const { data: cur, error: e1 } = await db().from("agents").select("daily_budget_usd").eq("id", agentId).single();
  if (e1) return fail(e1.message);
  // lowering a budget only stops spend, so it's always allowed
  if (value > Number(cur.daily_budget_usd) && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const v = Math.round(value * 100) / 100;
  const { error } = await db().from("agents").update({ daily_budget_usd: v }).eq("id", agentId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, text: `Budget saved: $${v.toFixed(2)} a day.` };
}

// ---- Approvals. Deciding only records Zak's choice. Writing the approved change to Mercury
// also needs DASHBOARD_CONTROLS=on and MERCURY_WRITE_TOKEN, and the agent on duty (withRun).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BY = "zak (control room)";

/** Why approved changes can't go to Mercury from here right now, or null. */
const applyBlocker = () => (!controlsOn() ? "Approved, not applied yet: DASHBOARD_CONTROLS is off." : writeBlocker());

async function applyNow(ids?: string[]): Promise<ActionResult> {
  const blocked = applyBlocker();
  if (blocked) return { ok: true, text: blocked.startsWith("Approved") ? blocked : `Approved, not applied yet: ${blocked}` };
  return applyApproved(ids);
}

export async function approve(approvalId: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  try {
    const actionId = await decide(approvalId, "approve", BY);
    if (!actionId) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    const res = await applyNow([actionId]);
    revalidatePath("/", "layout");
    return res;
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/**
 * Rejects an approval. A reason (Zak's own words) also proposes a lesson for the agent, which waits on
 * its Memory tab until he keeps it. No model call: the lesson is his sentence.
 */
export async function reject(approvalId: string, reason?: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  try {
    const actionId = await decide(approvalId, "reject", BY, why || undefined);
    if (!actionId) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    let lesson = "";
    if (why) {
      try {
        const { data: ap } = await db().from("approvals").select("agent_id, title").eq("id", approvalId).single();
        if (ap && await proposeLesson(ap.agent_id, approvalId, ap.title, why)) lesson = ` A lesson is waiting on ${BY_ID[ap.agent_id]?.name ?? "the agent"}’s Memory tab for your Keep.`;
      } catch (e) { lesson = ` The lesson couldn’t be saved: ${e instanceof Error ? e.message : String(e)}.`; }
    }
    revalidatePath("/", "layout");
    return { ok: true, text: `Rejected. Quinn won’t propose this change again.${lesson}` };
  } catch (e) { return fail(e); }
}

export async function approveAll(approvalIds: string[]): Promise<ActionResult> {
  await requireSession();
  const ids = approvalIds.filter((i) => UUID.test(i)).slice(0, 200);
  try {
    const actionIds: string[] = [];
    for (const id of ids) { const a = await decide(id, "approve", BY); if (a) actionIds.push(a); }
    const res = actionIds.length ? await applyNow(actionIds) : { ok: false, text: "Nothing left to approve." };
    revalidatePath("/", "layout");
    return actionIds.length ? { ok: res.ok, text: `Approved ${actionIds.length}. ${res.text}` } : res;
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/** Applies everything approved that is still waiting (also after a failure was put back with Retry). */
export async function applyWaiting(): Promise<ActionResult> {
  await requireSession();
  try { const res = await applyNow(); revalidatePath("/", "layout"); return res; } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

export async function retryAction(actionId: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(actionId)) return { ok: false, text: "Unknown action." };
  try {
    const back = await retry(actionId);
    if (!back) return { ok: false, text: "Only a failed change can be retried." };
    const res = await applyNow([actionId]);
    revalidatePath("/", "layout");
    return res;
  } catch (e) { return fail(e); }
}

/** Turns Quinn's saved proposals into approvals. Writes only Supabase, never Mercury. */
export async function queueQuinn(): Promise<ActionResult> {
  await requireSession();
  try {
    const r = await queueBookkeeperProposals(null);
    revalidatePath("/", "layout");
    return { ok: true, text: r.queued || r.refused ? `${r.queued} new approval${r.queued === 1 ? "" : "s"} from Quinn${r.refused ? `, ${r.refused} refused by the gateway (see the log)` : ""}.` : "No new proposals from Quinn." };
  } catch (e) { return fail(e); }
}

// ---- Memory. Teaching, editing and forgetting spend nothing and wake nothing, so they need only the login.

const KEEP_AS = ["note", "standing_order", "crew"] as const;
const FORGET: Keep[] = ["next_run", "days_30", "always"];

export async function teach(agentId: string, text: string, keepAs: string, forget: string, notionLink = ""): Promise<ActionResult> {
  await requireSession();
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  if (!KEEP_AS.includes(keepAs as (typeof KEEP_AS)[number]) || !FORGET.includes(forget as Keep)) return { ok: false, text: "Pick how long to keep it." };
  try {
    const link = keepAs === "standing_order" ? String(notionLink ?? "").slice(0, 500) : "";
    await teachMemory({ agentId, text: String(text), keepAs: keepAs as (typeof KEEP_AS)[number], forget: forget as Keep, notionLink: link });
    revalidatePath("/", "layout");
    const name = BY_ID[agentId].name;
    const how = keepAs === "crew" ? "Every agent will load it from its next run." : keepAs === "standing_order" ? `${name} follows it from the next run${link ? " and reads the linked page each time. Share that page with the One Two Agents integration in Notion if you haven’t" : ""}.` : forget === "next_run" ? `${name} reads it on the next run, then forgets it.` : forget === "days_30" ? `${name} keeps it for 30 days.` : `${name} keeps it until you forget it.`;
    return { ok: true, text: `Saved. ${how}` };
  } catch (e) { return fail(e); }
}

export async function editMemoryLine(memoryId: string, text: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await editMemory(memoryId, String(text)); revalidatePath("/", "layout"); return { ok: true, text: "Saved. The old words are in the timeline." }; } catch (e) { return fail(e); }
}

export async function forgetMemoryLine(memoryId: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await forgetMemory(memoryId); revalidatePath("/", "layout"); return { ok: true, text: "Forgotten. It won’t be loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function keepLessonLine(memoryId: string, forCrew: boolean): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await keepLesson(memoryId, !!forCrew); revalidatePath("/", "layout"); return { ok: true, text: forCrew ? "Kept for the whole crew." : "Kept. It’s loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function discardLessonLine(memoryId: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await discardLesson(memoryId); revalidatePath("/", "layout"); return { ok: true, text: "Discarded. The timeline keeps a record of it." }; } catch (e) { return fail(e); }
}
