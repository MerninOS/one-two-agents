"use server";
// Control Room actions. Each one checks the login again. Anything that can spend money
// or wake an agent also needs DASHBOARD_CONTROLS=on; stopping things never does.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

/** A real run, logged in agent_runs as manual. withRun still skips it when the agent is off duty or over budget. */
export async function realRun(agentId: string): Promise<ActionResult> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  if (!known(agentId)) return { ok: false, text: "Unknown agent." };
  try {
    const res = await withRun(agentId, "manual", (runId) => AGENTS[agentId].job({ runId }));
    revalidatePath("/", "layout");
    return { ok: res.status === "ok", text: `${BY_ID[agentId].name}: ${res.status === "skipped" ? "skipped, " : ""}${res.summary}` };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
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
