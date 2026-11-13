"use server";
// Org chart actions (docs/org-chart.md). Each checks the login again. None needs Controls: the
// chart decides where an agent sits, never what it can read, do or spend, and nothing here runs.
import { revalidatePath } from "next/cache";
import { db } from "@/core/db";
import { addDepartment, addSeat, editSeat, removeDepartment, removeSeat, renameDepartment, setHolder, unseat } from "@/core/org";
import type { ActionResult } from "./actions";
import { BY_ID } from "./crew";
import { requireSession } from "./data";

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
