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
  const run = withRun(agentId, "manual", (runId) => { markStarted(); return AGENTS[agentId].job({ runId }); })
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
