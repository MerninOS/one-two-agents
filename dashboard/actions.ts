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
import { applyApproved, decide, loadCaps, queueBookkeeperProposals, retry } from "@/core/gateway";
import { CAPS, capChange, fmtCap, type CapKey } from "@/core/gateway/policy";
import { env } from "@/core/env";
import { approvalDecided, startStep } from "@/core/chain";
import { activateFlow, flowLooser, flowProblems, listFlowVersions, loadFlow, saveFlowVersion, type Flow } from "@/core/flow";
import { ANNOTATE } from "@/core/gateway";
import { BUDGET_CEILING, activateSpecVersion, createBuiltAgent, draftOf, listSpecVersions, loadSpec, readSpec, saveSpecVersion, specLooser, type AgentSpec } from "@/core/agent-spec";
import { dryRunTools, runExplore, type PlaybookStep } from "@/core/runner";
import { TOOLS } from "@/core/tools/catalog";
import { lastTry } from "./builder";
import { activePlaybook, afterRun, approvePlaybook, holdAfterRejection, listPlaybooks, pendingPlaybook } from "@/core/playbook";
import { loadMemory } from "@/core/memory";
import { BY_ID } from "./crew";
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
  // every agent, including ones built in the app (agent_defs), not only the crew in code
  const { error } = await db().from("agents").update({ enabled: false }).eq("enabled", true);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, text: "Every agent is off duty." };
}

// ---- Approvals. Deciding only records Zak's choice. Writing the approved change to Mercury
// also needs DASHBOARD_CONTROLS=on and MERCURY_WRITE_TOKEN, and the agent on duty (withRun).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BY = "zak (control room)";

/** Why approved actions can't be applied from here at all right now, or null. Each kind's own blocker (Mercury token, Gmail) is the gateway's to say. */
const applyBlocker = () => (!controlsOn() ? "Approved, not applied yet: DASHBOARD_CONTROLS is off." : null);

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
    // an agent on a playbook that proposed this goes back to needing approval for its next playbook
    try {
      const { data: ap } = await db().from("approvals").select("agent_id, title").eq("id", approvalId).single();
      if (ap && await holdAfterRejection(ap.agent_id, ap.title)) lesson += " Its next playbook will wait for your approval.";
    } catch { /* no playbook tables yet */ }
    revalidatePath("/", "layout");
    return { ok: true, text: `Rejected.${lesson}` };
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
    return { ok: true, text: `${c.name} started: ${c.steps.map((s) => BY_ID[s.agent]?.name ?? s.agent).join(", then ")}. An agent that is off duty is skipped and the chain stops there. Runs shows each step.` };
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

// ---- Caps, vendors and suppressed addresses (Settings). Agents never call
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

// ---- Agent builder (docs/agent-builder.md, docs/builder-flow.md). An agent built in the app is a
// versioned spec that picks from the tool list and models in code. Saving adds a draft, which
// spends nothing and changes nothing that runs, so it needs only the login. Try it is a real run of
// the draft that sends and saves nothing: it needs DASHBOARD_CONTROLS=on and counts against the
// agent's daily budget, even off duty. Go live makes the draft the version that runs, only after a
// try of that version where every step worked, with Controls on and a confirm for anything that
// lets it do or spend more. Going back to an earlier version is one tap, with the same confirm.
// The tool check is free. Being on or off duty is never changed here.


/** The active spec of an agent built in the app. Throws when the agent wasn't built here. */
async function builtAgent(agentId: string) {
  if (typeof agentId !== "string" || !/^[a-z0-9_]{1,60}$/.test(agentId)) throw new Error("Unknown agent.");
  const { data, error } = await db().from("agent_defs").select("version").eq("agent_id", agentId).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That agent wasn’t built in the app, so the builder can’t change it.");
  return loadSpec(agentId);
}

/** A draft from the builder, checked against code. Problems refuse it; nothing is clamped. */
function checkedDraft(draft: unknown, agentId: string): { spec: AgentSpec } | { error: string } {
  const { spec, problems } = readSpec(draft, agentId);
  return problems.length ? { error: `This draft asks for something code doesn’t offer: ${problems.join("; ")}.` } : { spec };
}

/**
 * Creates a new agent, off duty, from the builder flow's draft (docs/builder-flow.md, slice 2). The
 * draft is checked against code like any save; a new agent has no gateway actions, since the
 * gateway names the agents that may ask for each one.
 */
export async function createBuilt(draft: unknown): Promise<ActionResult & { id?: string }> {
  await requireSession();
  try {
    const { spec, problems } = readSpec(draft);
    if (problems.length) return { ok: false, text: `Not created. This draft asks for something code doesn’t offer: ${problems.join("; ")}.` };
    if (spec.tools.some((t) => TOOLS[t]?.kind === "action")) return { ok: false, text: "Not created. A new agent can’t ask for actions: code names which agents may." };
    const id = await createBuiltAgent(spec, BY);
    revalidatePath("/", "layout");
    return { ok: true, text: `${spec.name} is saved as v1, off duty.`, id };
  } catch (e) { return fail(e); }
}

/** Saves the flow's draft as the next version, a draft: today's version keeps running until Go live. */
export async function saveSpec(agentId: string, draft: unknown, note: string): Promise<ActionResult> {
  await requireSession();
  const why = String(note ?? "").trim().slice(0, 300) || "Edited in the builder";
  try {
    await builtAgent(agentId);
    const got = checkedDraft(draft, agentId);
    if ("error" in got) return { ok: false, text: `Not saved. ${got.error}` };
    const versions = await listSpecVersions(agentId);
    const base = draftOf(versions) ?? versions.find((v) => v.active);
    if (base && JSON.stringify(base.spec) === JSON.stringify(got.spec)) return { ok: false, text: `Nothing changed from v${base.version}.` };
    const v = await saveSpecVersion(agentId, got.spec, why, BY);
    revalidatePath("/", "layout");
    return { ok: true, text: `Saved as draft v${v}. Try it, then go live; what runs today hasn’t changed.` };
  } catch (e) { return fail(e); }
}

/** Goes back to an earlier version in one tap. Anything that lets it do or spend more needs Controls on and a confirm. */
export async function goBack(agentId: string, version: number, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const now = await builtAgent(agentId);
    const target = (await listSpecVersions(agentId)).find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no v${version}.` };
    if (now && version >= now.version) return { ok: false, text: `v${version} is newer than the live v${now.version}: try it, then go live.` };
    if (target.problems.length) return { ok: false, text: `v${version} asks for something code no longer offers: ${target.problems.join("; ")}.` };
    const looser = specLooser(now?.spec ?? null, target.spec);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} v${version} lets a run do or spend more: ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    await activateSpecVersion(agentId, version);
    revalidatePath("/", "layout");
    return { ok: true, text: `Back on v${version}. The next run uses it.` };
  } catch (e) { return fail(e); }
}

/** A built agent's daily budget. Lowering is always allowed; raising needs DASHBOARD_CONTROLS=on. */
export async function setBuiltBudget(agentId: string, value: number): Promise<ActionResult> {
  await requireSession();
  if (!(Number.isFinite(value) && value >= 0 && value <= BUDGET_CEILING)) return { ok: false, text: `Pick a budget between $0 and $${BUDGET_CEILING} a day. $${BUDGET_CEILING} is the ceiling in code.` };
  try {
    await builtAgent(agentId);
    const { data: cur, error: e1 } = await db().from("agents").select("daily_budget_usd").eq("id", agentId).single();
    if (e1) return fail(e1.message);
    if (value > Number(cur.daily_budget_usd) && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const v = Math.round(value * 100) / 100;
    const { error } = await db().from("agents").update({ daily_budget_usd: v }).eq("id", agentId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, text: `Budget saved: $${v.toFixed(2)} a day.` };
  } catch (e) { return fail(e); }
}

/** Adds a standing order for a built agent: the same memory store as the Memory tab. */
export async function addStandard(agentId: string, text: string, notionLink = ""): Promise<ActionResult> {
  await requireSession();
  try {
    await builtAgent(agentId);
    const link = String(notionLink ?? "").slice(0, 500);
    await teachMemory({ agentId, text: String(text ?? ""), keepAs: "standing_order", forget: "always", notionLink: link });
    revalidatePath("/", "layout");
    return { ok: true, text: `Saved. It’s loaded on every run from the next one${link ? ", with the linked page read fresh each time" : ""}.` };
  } catch (e) { return fail(e); }
}

/** Runs every tool the draft (or the saved spec) grants once with default inputs. No model, nothing written, not logged. */
export async function dryRunBuilt(agentId: string, draft?: unknown): Promise<ActionResult> {
  await requireSession();
  try {
    const now = await builtAgent(agentId);
    let spec = now?.spec;
    if (draft !== undefined) { const g = checkedDraft(draft, agentId); if ("error" in g) return { ok: false, text: g.error }; spec = g.spec; }
    if (!spec) return { ok: false, text: "That agent has no saved spec." };
    const rows = await dryRunTools(spec, agentId);
    const bad = rows.filter((r) => !r.ok);
    return { ok: !bad.length, text: rows.map((r) => `${r.ok ? "OK" : "FAILED"} ${r.label}: ${r.note}`).join(" · ") || "No tools ticked." };
  } catch (e) { return fail(e); }
}

/**
 * Try it (step 5): one real run of the draft (or the live version when there is no draft) on
 * today's data, logged with trigger "preview" and its spec version, its steps saved as they happen
 * so the map can play it. It sends nothing, queues nothing and saves no output for other agents.
 * It follows the approved routine unless `fresh` asks the model to pick its own calls; afterwards
 * code drafts or updates the routine (core/playbook.ts), which Go live approves.
 */
export async function tryBuilt(agentId: string, fresh = false): Promise<ActionResult & { runId?: string }> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} A try makes real model calls.` };
  try {
    await builtAgent(agentId);
    const versions = await listSpecVersions(agentId);
    const target = draftOf(versions) ?? versions.find((v) => v.active);
    if (!target) return { ok: false, text: "That agent has no saved version." };
    if (target.problems.length) return { ok: false, text: `v${target.version} asks for something code doesn’t offer: ${target.problems.join("; ")}.` };
    let block = "";
    try { block = (await loadMemory(agentId)).block; } catch { /* a try without memory is fine */ }
    let playbook: { version: number; steps: PlaybookStep[] } | undefined;
    if (!fresh) { try { const a = activePlaybook(await listPlaybooks(agentId)); if (a) playbook = { version: a.version, steps: a.steps }; } catch { /* no playbook table yet: explore */ } }
    let got: Awaited<ReturnType<typeof runExplore>> | null = null;
    let rid: string | null = null;
    const res = await withRun(agentId, "preview", async (runId) => {
      rid = runId;
      const r = await runExplore(target.spec, { agentId, runId, memoryBlock: block, playbook, trying: true });
      got = r;
      return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: { ...r.metrics, spec_version: target.version } };
    });
    let note = "";
    if (got) { try { note = ` ${await afterRun(agentId, rid, got)}`; } catch (e) { note = ` (Routine not updated: ${e instanceof Error ? e.message : String(e)})`; } }
    revalidatePath("/", "layout");
    return { ok: res.status === "ok", text: `Try of v${target.version} done ($${(res.costUsd ?? 0).toFixed(4)}).${note}`, runId: rid ?? undefined };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/**
 * Go live (step 6): makes a version the one that runs, only after its latest try worked on every
 * step. It approves the routine that try drafted (with the steps Zak kept). On or off duty,
 * schedules and chains don't change.
 */
export async function goLive(agentId: string, version: number, keep: number[] | null, confirmed: boolean): Promise<ActionResult> {
  await requireSession();
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} Going live changes what runs.` };
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const now = await builtAgent(agentId);
    const target = (await listSpecVersions(agentId)).find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no v${version}.` };
    if (target.problems.length) return { ok: false, text: `v${version} asks for something code no longer offers: ${target.problems.join("; ")}.` };
    const t = await lastTry(agentId, version);
    if (!t) return { ok: false, text: `Try v${version} first. Go live unlocks after a try where every step worked.` };
    if (!t.clean) return { ok: false, text: `Go live is locked: the latest try of v${version} ${t.why}. Try it again.` };
    const looser = target.active ? [] : specLooser(now?.spec ?? null, target.spec);
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first${looser.length ? `: ${looser.join("; ")}` : ""}.` };
    const all = await listPlaybooks(agentId);
    const pending = pendingPlaybook(all);
    let routine = "";
    if (pending) {
      const v = await approvePlaybook(agentId, pending.id, Array.isArray(keep) ? keep.map(Number).filter(Number.isInteger) : pending.steps.map((_, i) => i));
      routine = ` Routine v${v} approved.`;
    } else if (!activePlaybook(all)) return { ok: false, text: "No routine yet: try it fresh, so code can save the calls that worked." };
    if (!target.active) await activateSpecVersion(agentId, version);
    revalidatePath("/", "layout");
    return { ok: true, text: `v${version} is live.${routine} On or off duty hasn’t changed.` };
  } catch (e) { return fail(e); }
}

