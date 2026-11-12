"use server";
// Control Room actions. Each one checks the login again. Anything that can spend money
// or wake an agent also needs DASHBOARD_CONTROLS=on; stopping things never does.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { AGENTS } from "@/agents/registry";
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { discardLesson, editMemory, forgetMemory, keepLesson, proposeLesson, teach as teachMemory, type Keep } from "@/core/memory";
import { applyApproved, decide, loadCaps, queueBookkeeperProposals, retry, writeBlocker } from "@/core/gateway";
import { CAPS, capChange, fmtCap, type CapKey } from "@/core/gateway/policy";
import { MENUS } from "@/agents/menus";
import { EFFORTS, MAX_INSTRUCTIONS, fromDraft, listVersions, loadSetup, loosening, notionTarget, rollBack, sameSetup, saveVersion, type AgentMenu, type Setup, type SetupDraft, type SetupPreview } from "@/core/setup";
import { missingProps, notionPlace, notionSearch } from "@/integrations/notion";
import { env } from "@/core/env";
import { priceOf } from "@/integrations/anthropic";
import { approvalDecided, startStep } from "@/core/chain";
import { activateFlow, flowLooser, flowProblems, listFlowVersions, loadFlow, saveFlowVersion, type Flow } from "@/core/flow";
import { ANNOTATE } from "@/core/gateway";
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
  const run = withRun(agentId, "manual", (runId, memory, setup) => { markStarted(); return AGENTS[agentId].job({ runId, memory, setup }); })
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
  if (!(Number.isFinite(value) && value >= 0 && value <= 50)) return { ok: false, text: "Pick a budget between $0 and $50 a day. $50 is the ceiling in code." };
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

/** This deployment's own address, for a chain step's request to /api/agents. */
async function selfOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : env.dashboardUrl ?? "";
}

/** Chains that start when an approval is decided (core/flow.ts). Runs after the answer, never blocks it. */
async function fireApprovalChains(decision: "approve" | "reject") {
  const origin = await selfOrigin();
  if (!origin) return;
  after(async () => {
    try {
      const flow = await loadFlow(Object.keys(AGENTS));
      const started = await approvalDecided(origin, flow.flow, ANNOTATE, decision);
      if (started.length) console.log(`[chains] approval ${decision} started ${started.join(", ")}`);
    } catch (e) { console.error("[chains] approval", e); }
  });
}

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
    await fireApprovalChains("approve");
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
    await fireApprovalChains("reject");
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
    if (actionIds.length) await fireApprovalChains("approve");
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
    const how = keepAs === "crew" ? "Every agent will load it from its next run." : keepAs === "standing_order" ? `${name} follows it from the next run${link ? " and reads the linked page each time. Share that page with the agents’ Notion integration in Notion if you haven’t" : ""}.` : forget === "next_run" ? `${name} reads it on the next run, then forgets it.` : forget === "days_30" ? `${name} keeps it for 30 days.` : `${name} keeps it until you forget it.`;
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

// ---- Agent setup (docs/agent-setup.md): the Thinking editor on the Setup tab

/** $ per output token; a model without a price counts as the most expensive, so it always needs a confirm. */
const outPrice = (m: string) => priceOf(m)?.out ?? Infinity;

/** A draft from the browser, checked field by field before it goes anywhere near the menu. */
function cleanDraft(d: unknown): SetupDraft | null {
  const x = (d ?? {}) as Record<string, unknown>;
  if (typeof x.model !== "string" || !EFFORTS.includes(x.effort as Setup["effort"]) || typeof x.instructions !== "string") return null;
  if (x.fallback !== null && typeof x.fallback !== "string") return null;
  if (x.instructions.length > MAX_INSTRUCTIONS) return null;
  const list = (v: unknown) => (Array.isArray(v) && v.length <= 50 && v.every((s) => typeof s === "string") ? (v as string[]) : null);
  const numbers = x.numbers && typeof x.numbers === "object" && !Array.isArray(x.numbers) ? x.numbers as Record<string, unknown> : null;
  const readsOff = list(x.readsOff), outputsOff = list(x.outputsOff), sections = list(x.sections);
  if (!numbers || !Object.values(numbers).every((n) => typeof n === "number") || !readsOff || !outputsOff || !sections) return null;
  const notion = x.notion == null ? null : notionTarget(x.notion);
  if (x.notion != null && !notion) return null;
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : v == null ? {} : null);
  const moreRaw = rec(x.more), choicesRaw = rec(x.choices);
  if (!moreRaw || !choicesRaw || Object.keys(moreRaw).length > 10 || Object.keys(choicesRaw).length > 10) return null;
  const more: SetupDraft["more"] = {};
  for (const [k, v] of Object.entries(moreRaw)) {
    const c = rec(v);
    if (!c || typeof c.model !== "string" || !EFFORTS.includes(c.effort as Setup["effort"]) || (c.fallback != null && typeof c.fallback !== "string")) return null;
    more[k] = { model: c.model, effort: c.effort as Setup["effort"], fallback: (c.fallback as string | null) || null };
  }
  const choices: SetupDraft["choices"] = {};
  for (const [k, v] of Object.entries(choicesRaw)) { const l = list(v); if (!l) return null; choices[k] = l; }
  return { model: x.model, effort: x.effort as Setup["effort"], fallback: (x.fallback as string | null) || null, instructions: x.instructions, more, numbers: numbers as Record<string, number>, choices, readsOff, outputsOff, sections, notion };
}

/**
 * A Notion target the draft picks, checked live: the integration must see it, and a database
 * must have every property the agent writes. Null when it is fine (or unchanged).
 */
async function notionProblem(menu: AgentMenu, now: Setup, next: Setup): Promise<string | null> {
  if (!next.notion || next.notion.id === now.notion?.id || !menu.notion) return null;
  try {
    const got = await notionPlace(next.notion.kind, next.notion.id);
    const miss = got.kind === "database" ? missingProps(got.props, menu.notion.dbProps) : [];
    return miss.length ? `“${got.title}” is missing ${miss.join(", ")}, so the row would be rejected.` : null;
  } catch (e) { return `The Notion integration can’t open that ${next.notion.kind}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`; }
}

/** The agent's menu and active setup. The table must be readable: nothing is saved over a setup that can't be seen. */
async function editable(agentId: string) {
  const menu = MENUS[agentId];
  if (!menu || !known(agentId)) throw new Error("This agent has no menu yet, so its setup can’t be edited here.");
  return { menu, now: await loadSetup(menu) };
}

/**
 * Preview: the agent's real output for a draft, from real facts and memory, with nothing
 * written or sent. One model call, logged as a run with trigger "preview" so its cost counts
 * against today's budget. Allowed while the agent is off duty; needs DASHBOARD_CONTROLS=on.
 */
export async function previewSetup(agentId: string, draft: unknown): Promise<ActionResult & { preview?: SetupPreview }> {
  await requireSession();
  const d = cleanDraft(draft);
  if (!d) return { ok: false, text: "That draft isn’t complete." };
  try {
    const { menu, now } = await editable(agentId);
    const preview = AGENTS[agentId].preview;
    const next = fromDraft(menu, now, d);
    if (next.problems.length) return { ok: false, text: `The draft asks for something the menu doesn’t offer: ${next.problems.join("; ")}.` };
    // Rowan's and Quinn's real output costs a real run, so their preview is the free dry run with the draft:
    // real reads, no model, nothing written, not logged (the same as the Dry run button)
    if (!preview) {
      const r = await AGENTS[agentId].job({ dryRun: true, setup: next });
      return { ok: r.status === "ok", text: r.summary.replace(/setup v\d+/, "this draft").replace("built-in setup", "this draft") };
    }
    if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} A preview makes one real model call.` };
    let got: SetupPreview | null = null;
    const res = await withRun(agentId, "preview", async () => {
      const p = await preview(next);
      got = p;
      return { status: "ok", summary: `Preview of an unsaved setup (${next.model}, effort ${next.effort}). Nothing written or sent. Answered by ${p.servedBy}; a real run would send it to ${p.sendsTo}.`, tokensIn: p.tokensIn, tokensOut: p.tokensOut, costUsd: p.costUsd };
    });
    revalidatePath("/", "layout");
    if (!got) return { ok: false, text: res.summary };
    return { ok: true, text: res.summary, preview: got };
  } catch (e) { return fail(e); }
}

/** Saves the draft as a new version and makes it active. Costlier choices need a confirm and DASHBOARD_CONTROLS=on. */
export async function saveSetupVersion(agentId: string, draft: unknown, note: string, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  const d = cleanDraft(draft);
  if (!d) return { ok: false, text: "That draft isn’t complete." };
  const why = note.trim().slice(0, 300);
  if (!why) return { ok: false, text: "Add a short note saying why, so the version list makes sense later." };
  try {
    const { menu, now } = await editable(agentId);
    const next = fromDraft(menu, now, d);
    if (next.problems.length) return { ok: false, text: `Not saved: ${next.problems.join("; ")}.` };
    if (sameSetup(next, now)) return { ok: false, text: "Nothing changed from the active setup." };
    const target = await notionProblem(menu, now, next);
    if (target) return { ok: false, text: `Not saved. ${target}` };
    const costlier = loosening(menu, now, next, outPrice);
    if (costlier.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} This change costs more: ${costlier.join("; ")}.` };
    if (costlier.length && !confirmed) return { ok: false, text: `Confirm first: ${costlier.join("; ")}.` };
    const v = await saveVersion(menu, now, d, why, "zak (control room)");
    revalidatePath("/", "layout");
    return { ok: true, text: `Saved as v${v}. ${BY_ID[agentId].name}’s next run uses it.` };
  } catch (e) { return fail(e); }
}

/** Makes an earlier version active again. Rolling back to a costlier version needs the same confirm as saving one. */
export async function rollBackSetup(agentId: string, version: number, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const { menu, now } = await editable(agentId);
    const target = (await listVersions(menu)).find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no v${version}.` };
    const costlier = loosening(menu, now, target.setup, outPrice);
    if (costlier.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} v${version} costs more: ${costlier.join("; ")}.` };
    if (costlier.length && !confirmed) return { ok: false, text: `Confirm first: ${costlier.join("; ")}.` };
    await rollBack(menu, now, version);
    revalidatePath("/", "layout");
    return { ok: true, text: `v${version} is active again. ${BY_ID[agentId].name}’s next run uses it.` };
  } catch (e) { return fail(e); }
}

/**
 * Pages and databases the Notion integration can see, for the Writes box's target picker.
 * Read only. A database that lacks a property the agent writes is listed with what is missing
 * and can't be picked.
 */
export async function findNotionTargets(agentId: string, query: string): Promise<ActionResult & { places?: { kind: "database" | "page"; id: string; title: string; url: string; missing: string[] }[] }> {
  await requireSession();
  const menu = MENUS[agentId];
  if (!menu?.notion || !known(agentId)) return { ok: false, text: "This agent has no Notion output." };
  if (!env.notionToken) return { ok: false, text: "NOTION_TOKEN isn’t set in Vercel, so there is nothing to search." };
  try {
    const found = await notionSearch(String(query ?? "").trim());
    // Rowan and Quinn write a new page each run, so only pages can be picked for them
    const places = found.filter((p) => !menu.notion!.pageOnly || p.kind === "page").map((p) => ({ kind: p.kind, id: p.id, title: p.title, url: p.url, missing: p.kind === "database" ? missingProps(p.props, menu.notion!.dbProps) : [] }));
    return { ok: true, text: places.length ? `${places.length} found.` : "Nothing found. Share the page or database with the Notion integration first.", places };
  } catch (e) { return fail(e); }
}

// ---- Crew flow (docs/agent-setup.md, slice 5): chains of agents on the Crew canvas

/** A flow from the browser, checked against the palette before anything is saved or run. */
function cleanFlow(f: unknown): { flow: Flow } | { problems: string[] } {
  const problems = flowProblems(f, Object.keys(AGENTS));
  return problems.length ? { problems } : { flow: f as Flow };
}

/**
 * Saves the crew flow as a new version. A chain that starts running on its own (or gains an
 * agent) needs a confirm and DASHBOARD_CONTROLS=on. Saving never turns an agent on: each run
 * still goes through withRun, and an agent that is off duty is skipped.
 */
export async function saveCrewFlow(flow: unknown, note: string, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  const why = String(note ?? "").trim().slice(0, 300);
  if (!why) return { ok: false, text: "Add a short note saying why, so the version list makes sense later." };
  const got = cleanFlow(flow);
  if ("problems" in got) return { ok: false, text: `Not saved: ${got.problems.slice(0, 5).join(" ")}` };
  try {
    const now = await loadFlow(Object.keys(AGENTS));
    if (JSON.stringify(now.flow) === JSON.stringify(got.flow)) return { ok: false, text: "Nothing changed from the saved flow." };
    const looser = flowLooser(now.flow, got.flow);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    const v = await saveFlowVersion(got.flow, why, "zak (control room)", now.version);
    revalidatePath("/", "layout");
    return { ok: true, text: `Saved as flow v${v}.${got.flow.chains.some((c) => c.on) ? " Chains that are on start at their next time; agents that are off duty are skipped." : " Every chain is off, so nothing runs on its own."}` };
  } catch (e) { return fail(e); }
}

export async function rollBackFlow(version: number, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const agents = Object.keys(AGENTS);
    const [now, all] = await Promise.all([loadFlow(agents), listFlowVersions(agents)]);
    const target = all.find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no flow v${version}.` };
    if (target.version === now.version) return { ok: false, text: `v${version} is already active.` };
    const looser = flowLooser(now.flow, target.flow);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    await activateFlow(version, now.version);
    revalidatePath("/", "layout");
    return { ok: true, text: `Flow v${version} is active again.` };
  } catch (e) { return fail(e); }
}

/**
 * The Run chain button: starts a saved chain now, even while it is off (like the Run button on a
 * profile). Real runs, so DASHBOARD_CONTROLS=on; each agent still needs to be on duty.
 */
export async function runChainNow(key: string): Promise<ActionResult> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  try {
    const flow = await loadFlow(Object.keys(AGENTS));
    const c = flow.flow.chains.find((x) => x.key === key);
    if (!c) return { ok: false, text: "That chain isn’t in the saved flow. Save first." };
    const origin = await selfOrigin();
    if (!origin) return { ok: false, text: "Can’t work out this app’s address to start the chain." };
    const chainId = crypto.randomUUID();
    after(() => startStep(origin, c, { chainId, key: c.key, step: 0, manual: true }));
    revalidatePath("/", "layout");
    return { ok: true, text: `${c.name} started: ${c.steps.map((s) => BY_ID[s.agent]?.name ?? s.agent).join(", then ")}. An agent that is off duty is skipped and the chain stops there. The run log shows each step.` };
  } catch (e) { return fail(e); }
}

export interface ChainPreviewStep { agent: string; name: string; summary: string; next: string }

/**
 * Preview a chain from the canvas (saved or not): each step's dry run in order (real data, no
 * writes, no model, no cost, nothing logged), and what the chain would do after it. A dry run
 * reports no numbers, so a check is shown as not tested.
 */
export async function previewChain(flow: unknown, key: string): Promise<ActionResult & { steps?: ChainPreviewStep[] }> {
  await requireSession();
  const got = cleanFlow(flow);
  if ("problems" in got) return { ok: false, text: got.problems.slice(0, 5).join(" ") };
  const c = got.flow.chains.find((x) => x.key === key);
  if (!c) return { ok: false, text: "Unknown chain." };
  const steps: ChainPreviewStep[] = [];
  for (let k = 0; k < c.steps.length; k++) {
    const s = c.steps[k], name = BY_ID[s.agent]?.name ?? s.agent;
    let summary: string, status: "ok" | "failed" = "ok";
    try { summary = (await AGENTS[s.agent].job({ dryRun: true })).summary; }
    catch (e) { status = "failed"; summary = `Dry run failed: ${e instanceof Error ? e.message : String(e)}`; }
    const nxt = c.steps[k + 1];
    let next = "End of the chain.";
    if (nxt) {
      const nn = BY_ID[nxt.agent]?.name ?? nxt.agent;
      const when = nxt.when ?? "ok";
      const goes = when === "any" || (when === "ok" ? status === "ok" : status === "failed");
      next = !goes ? `${nn} would not run (${when === "ok" ? "only after a step that worked" : "only after a failure"}).`
        : `${nn} would run next${nxt.days === "weekdays" ? " on weekdays" : ""}${nxt.notBefore ? `, not before ${nxt.notBefore}` : ""}${nxt.check ? `, if ${nxt.check.metric} ${nxt.check.op} ${nxt.check.value} (a dry run reports no numbers, so not tested)` : ""}${nxt.passAlong ? `, with ${name}’s summary passed along` : ""}.`;
      if (!goes) { steps.push({ agent: s.agent, name, summary, next }); break; }
    }
    steps.push({ agent: s.agent, name, summary, next });
  }
  return { ok: true, text: `Previewed ${c.name}: ${steps.length} step${steps.length === 1 ? "" : "s"}. Nothing was written or sent.`, steps };
}

// ---- Caps, vendors and suppressed addresses (Guardrails box and Settings). Agents never call
// these: only a signed-in Zak. Tightening is always allowed; loosening needs a confirm and
// DASHBOARD_CONTROLS=on, and never passes the limit in code (CAPS in core/gateway/policy.ts).

export async function setCap(key: string, value: number, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  try {
    const caps = await loadCaps();
    const now = caps[key as CapKey]?.value;
    if (now === undefined) return { ok: false, text: `Unknown cap ${key}.` };
    const v = Number(value);
    const ch = capChange(key, now, v);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${CAPS[key as CapKey].label} from ${fmtCap(key as CapKey, now)} to ${fmtCap(key as CapKey, v)}.` };
    const { error } = await db().from("policies").upsert({ key, value_json: v, updated_at: new Date().toISOString() });
    if (error) return fail(error.message);
    await db().from("policy_log").insert({ key, old_value: caps[key as CapKey].raw ?? null, new_value: v, changed_by: "zak (control room)" });
    revalidatePath("/", "layout");
    return { ok: true, text: `${CAPS[key as CapKey].label}: ${fmtCap(key as CapKey, v)}. The gateway uses it from the next check.` };
  } catch (e) { return fail(e); }
}

const KINDS = ["importer", "packaging", "other"] as const;

/** Adds a payee. Only here, only Zak, DASHBOARD_CONTROLS=on. A first payment to a vendor always waits for approval. */
export async function addVendor(form: { name: string; kind: string; mercuryRecipientId: string; contactEmail: string }): Promise<ActionResult> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const name = String(form.name ?? "").trim(), kind = KINDS.includes(form.kind as (typeof KINDS)[number]) ? form.kind : "other";
  const rid = String(form.mercuryRecipientId ?? "").trim(), email = String(form.contactEmail ?? "").trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, text: "Give the vendor a name (up to 120 characters)." };
  if (rid && !/^[0-9a-f-]{36}$/i.test(rid)) return { ok: false, text: "The Mercury recipient id is the long id from Mercury (Payments, Recipients). Leave it empty if the recipient isn’t in Mercury yet." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That contact email doesn’t look right." };
  const { error } = await db().from("vendors").insert({ name, kind, mercury_recipient_id: rid || null, contact_email: email || null, added_by: "zak (control room)" });
  if (error) return fail(error.code === "23505" ? "That Mercury recipient is already a vendor." : error.message);
  revalidatePath("/settings");
  return { ok: true, text: `${name} added to vendors.${rid ? "" : " Add its Mercury recipient id before anything can be paid to it."}` };
}

/** Stops all email to an address. Always allowed: it only takes power away. */
export async function suppressEmail(address: string, reason: string): Promise<ActionResult> {
  await requireSession();
  const email = String(address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That isn’t an email address." };
  const { error } = await db().from("email_suppressions").upsert({ email, reason: String(reason ?? "").trim().slice(0, 200) || "Added by Zak", source: "zak" });
  if (error) return fail(error.message);
  revalidatePath("/settings");
  return { ok: true, text: `No agent will email ${email}.` };
}
