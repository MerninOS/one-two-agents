"use server";
// Org chart actions (docs/org-chart.md). Each checks the login again. Seats and departments need
// no Controls: the chart decides where an agent sits, never what it can read or do, and nothing
// here runs. Department limits (slice 2) are like the company caps: tightening is always allowed,
// loosening needs DASHBOARD_CONTROLS=on and a confirm.
import { revalidatePath } from "next/cache";
import { db } from "@/core/db";
import { loadCaps } from "@/core/gateway";
import { addDepartmentRule, editMemory, forgetMemory } from "@/core/memory";
import { addDepartment, addSeat, deptBudgetChange, deptEmailChange, editSeat, loadOrg, removeDepartment, removeSeat, renameDepartment, setDeptBudget, setDeptEmailCap, setHolder, setLeadChecks, unseat } from "@/core/org";
import type { ActionResult } from "./actions";
import { BY_ID } from "./crew";
import { requireSession } from "./data";
import { controlsOn } from "./session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

/** One of the crew in code (built or planned) or an agent built in the app. */
async function knownAgent(id: string): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(id)) return false;
  if (BY_ID[id]) return true;
  const { data } = await db().from("agents").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export async function orgAddDepartment(name: string): Promise<ActionResult> {
  await requireSession();
  try { await addDepartment(String(name ?? "")); return done(`${String(name).trim()} is on the chart, with an open head seat.`); } catch (e) { return fail(e); }
}

export async function orgRenameDepartment(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try { await renameDepartment(String(id), String(name ?? "")); return done("Renamed."); } catch (e) { return fail(e); }
}

export async function orgRemoveDepartment(id: string): Promise<ActionResult> {
  await requireSession();
  try { await removeDepartment(String(id)); return done("Department removed."); } catch (e) { return fail(e); }
}

export async function orgAddSeat(parentId: string, title: string, sub: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(String(parentId))) return { ok: false, text: "Unknown seat." };
  try { await addSeat(parentId, String(title ?? ""), String(sub ?? "")); return done("Seat added. It’s open until you build an agent for it."); } catch (e) { return fail(e); }
}

export async function orgEditSeat(id: string, title: string, sub: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown seat." };
  try { await editSeat(id, String(title ?? ""), String(sub ?? "")); return done("Seat saved."); } catch (e) { return fail(e); }
}

export async function orgRemoveSeat(id: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown seat." };
  try { await removeSeat(id); return done("Seat removed."); } catch (e) { return fail(e); }
}

/** Who sits in a seat: "open", "zak" or "agent:<id>". An agent moves from any seat it had. */
export async function orgSetHolder(seatId: string, who: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(String(seatId))) return { ok: false, text: "Unknown seat." };
  const w = String(who ?? "");
  try {
    if (w === "open" || w === "zak") { await setHolder(seatId, w, null); return done(w === "open" ? "The seat is open." : "That seat is yours."); }
    const id = w.startsWith("agent:") ? w.slice(6) : "";
    if (!(await knownAgent(id))) return { ok: false, text: "Unknown agent." };
    await setHolder(seatId, "agent", id);
    return done(`${BY_ID[id]?.name ?? "The agent"} sits there now. Its old seat, if it had one, is open.`);
  } catch (e) { return fail(e); }
}

/** From the builder's step 1: put an agent in a seat, or take it off the chart (null). */
export async function placeAgent(agentId: string, seatId: string | null): Promise<ActionResult> {
  await requireSession();
  if (!(await knownAgent(String(agentId)))) return { ok: false, text: "Unknown agent." };
  try {
    if (seatId == null) { await unseat(agentId); return done("Off the chart. Its seat is open."); }
    if (!UUID.test(String(seatId))) return { ok: false, text: "Unknown seat." };
    await setHolder(seatId, "agent", agentId);
    return done("Placed on the chart.");
  } catch (e) { return fail(e); }
}

// ---- Department limits and rules (slice 2)

const CONTROLS_OFF = "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this.";
const SLUG = /^[a-z][a-z0-9_]{1,39}$/;

/** A blank box means no department limit. */
const limitOf = (v: unknown): number | null => (v === null || v === undefined || String(v).trim() === "" ? null : Number(v));

async function dept(id: string) {
  if (!SLUG.test(id)) throw new Error("Unknown department.");
  const o = await loadOrg();
  const d = o?.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  return d;
}

/** A department's monthly AI budget. Raising or removing it needs Controls on and a confirm. */
export async function orgSetDeptBudget(id: string, value: number | string | null, confirmed = false): Promise<ActionResult> {
  await requireSession();
  try {
    const d = await dept(String(id));
    const next = limitOf(value);
    const ch = deptBudgetChange(d.monthlyBudgetUsd, next);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const from = d.monthlyBudgetUsd == null ? "no budget" : `$${d.monthlyBudgetUsd.toFixed(2)}`;
    const to = next == null ? "no budget" : `$${next.toFixed(2)} a month`;
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${d.name} from ${from} to ${to}.` };
    await setDeptBudget(d.id, next);
    return done(next == null ? `${d.name} has no department budget now. Each agent’s daily budget still applies.` : `${d.name}: ${to}. Its agents check it before every run.`);
  } catch (e) { return fail(e); }
}

/** A department's email cap, never above the company cap. Raising or removing it needs Controls on and a confirm. */
export async function orgSetDeptEmails(id: string, value: number | string | null, confirmed = false): Promise<ActionResult> {
  await requireSession();
  try {
    const d = await dept(String(id));
    const next = limitOf(value);
    const company = (await loadCaps()).max_emails_per_day.value;
    const ch = deptEmailChange(d.maxEmailsPerDay, next, company);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const to = next == null ? `the company cap (${company})` : `${next} a day`;
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${d.name}’s emails up to ${to}.` };
    await setDeptEmailCap(d.id, next, company);
    return done(`${d.name}’s emails: ${to}.`);
  } catch (e) { return fail(e); }
}

export async function orgAddDeptRule(id: string, text: string): Promise<ActionResult> {
  await requireSession();
  try {
    const d = await dept(String(id));
    await addDepartmentRule(d.id, String(text ?? ""));
    return done(`Every agent in ${d.name} follows it from its next run.`);
  } catch (e) { return fail(e); }
}

/** Only a department rule: other memory lines are edited on each agent's Memory tab. */
async function deptRule(ruleId: string) {
  if (!UUID.test(ruleId)) throw new Error("Unknown rule.");
  const { data } = await db().from("agent_memory").select("grp").eq("id", ruleId).maybeSingle();
  if (data?.grp !== "department") throw new Error("That isn’t a department rule.");
}

export async function orgEditDeptRule(ruleId: string, text: string): Promise<ActionResult> {
  await requireSession();
  try { await deptRule(String(ruleId)); await editMemory(ruleId, String(text ?? "")); return done("Rule saved."); } catch (e) { return fail(e); }
}

export async function orgForgetDeptRule(ruleId: string): Promise<ActionResult> {
  await requireSession();
  try { await deptRule(String(ruleId)); await forgetMemory(ruleId); return done("Forgotten. It stays on each agent’s memory timeline."); } catch (e) { return fail(e); }
}

/** "Lead checks drafts first" on or off. Neither way loosens a cap: Zak's tap stays the only approval. */
export async function orgSetLeadChecks(id: string, on: boolean): Promise<ActionResult> {
  await requireSession();
  try {
    const d = await dept(String(id));
    await setLeadChecks(d.id, !!on);
    return done(on ? `${d.name}: drafts go to the agent above them first, for up to a day.` : `${d.name}: drafts come straight to you.`);
  } catch (e) { return fail(e); }
}
