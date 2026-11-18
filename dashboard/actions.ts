"use server";
// Control Room actions. Each one checks the signed-in member's role first (asRole, docs/tenancy.md). Anything that can spend money
// or wake an agent also needs DASHBOARD_CONTROLS=on; stopping things never does.
import { audit } from "@/core/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withActor } from "@/core/actor";
import { after } from "next/server";
import { jobOf, loadCrew } from "@/agents/registry";
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { discardLesson, editMemory, forgetMemory, keepLesson, teach as teachMemory } from "@/core/memory";
import { saveReaction } from "@/core/reactions";
import { applyApproved, decide, loadCaps, queueBookkeeperProposals, retry } from "@/core/gateway";
import { CAPS, capChange, fmtCap, type CapKey } from "@/core/gateway/policy";
import { env } from "@/core/env";
import { approvalDecided, startStep } from "@/core/chain";
import { orgId, withOrg } from "@/core/tenancy";
import { activateFlow, flowLooser, flowProblems, listFlowVersions, loadFlow, saveFlowVersion, withAgentTime, DAY_WORDS, type AgentTime, type Flow } from "@/core/flow";
import { ANNOTATE } from "@/core/gateway";
import { BUDGET_CEILING, activateSpecVersion, createBuiltAgent, draftOf, listSpecVersions, loadSpec, readSpec, saveSpecVersion, specLooser, type AgentSpec } from "@/core/agent-spec";
import { dryRunTools, runExplore, type PlaybookStep } from "@/core/runner";
import { TOOLS } from "@/core/tools/catalog";
import { customMenu } from "@/core/tools/custom";
import { isCustomToolId } from "@/core/custom-mcp-rules";
import { lastTry } from "./builder";
import { activePlaybook, afterRun, approvePlaybook, holdAfterRejection, listPlaybooks, pendingPlaybook } from "@/core/playbook";
import { loadMemory } from "@/core/memory";
import { loadOrg, seatPath, setHolder } from "@/core/org";
import { getFloor, asRole } from "./data";
import { planOrgOn } from "./orgPlan";
import { when } from "./format";
import { schedWords } from "./schedule";
import { setOrg } from "@/core/org-switch";
import { controlsOn } from "./session";

export interface ActionResult { ok: boolean; text: string }

const CONTROLS_OFF = "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this.";
/** An agent with a live version, as the Control Room shows it (docs/agent-roster.md); null otherwise. */
const crewAgent = async (id: string) => { const a = (await getFloor()).byId[id]; return a?.built ? a : null; };
/** An agent's name, or its id when it isn't on the roster. */
const nameOf = async (id: string) => (await getFloor()).byId[id]?.name ?? id;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });

/** Reads real data, writes nothing, calls no model, logs nothing. */
export async function dryRun(agentId: string): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!(await crewAgent(agentId))) return { ok: false, text: "Unknown agent." };
  try {
    const res = await jobOf(agentId)({ dryRun: true });
    return { ok: true, text: res.summary };
  } catch (e) { return fail(e); }
}

/**
 * A real run, logged in agent_runs as manual. withRun still skips it when the agent is off duty or over budget.
 * The run keeps going in the background (after()), so this returns as soon as its row is written and the
 * dashboard stays usable; the layout polls until the row finishes. A skip or a failure to start comes back at once.
 */
export async function realRun(agentId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  const name = who.name;
  // one at a time: a row still "running" inside the 6 minute window means a run is going
  const { data: going } = await db().from("agent_runs").select("id").eq("agent_id", agentId).eq("status", "running").gte("started_at", new Date(Date.now() - 6 * 6e4).toISOString()).limit(1);
  if (going?.length) return { ok: false, text: `${name} is already working. Wait for that run to finish.` };

  let markStarted: () => void = () => {};
  const started = new Promise<null>((resolve) => { markStarted = () => resolve(null); });
  // the run outlives this request, so it carries the org itself rather than reading the cookie later
  const org = await orgId();
  const run = withOrg(org, () => withRun(agentId, "manual", (runId, memory) => { markStarted(); return jobOf(agentId)({ runId, memory }); }))
    .then((res) => ({ res }), (err: unknown) => { console.error(`[control-room] ${agentId} run failed`, err); return { err }; });
  after(run);
  const first = await Promise.race([started, run]);
  await audit(me, "run_now", agentId);
  revalidatePath("/", "layout");
  if (first === null) return { ok: true, text: `${name} is working. Keep using the app; ${name} pulses until the run is done.` };
  if ("err" in first) return fail(first.err);
  return { ok: first.res.status === "ok", text: `${name}: ${first.res.status === "skipped" ? "skipped, " : ""}${first.res.summary}` };
}

export async function setEnabled(agentId: string, on: boolean): Promise<ActionResult> {
  // taking an agent off duty is a stop, so approvers may; putting one back is the owner's
  const { me, no } = await asRole(on ? "owner" : "approver"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  if (on && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const { error } = await db().from("agents").update({ enabled: on }).eq("id", agentId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  const name = who.name;
  await audit(me, on ? "put_on_duty" : "take_off_duty", agentId);
  return { ok: true, text: on ? `${name} is back on the crew.` : `${name} is off duty. Every run is skipped at $0.` };
}

/**
 * When one agent runs (Crew > Schedule, docs/org-schedule.md): `t` days and a time, or null for by
 * hand. An edit of the flow (core/flow-rules.ts withAgentTime) saved as a new version, plus
 * agents.manual_only to match. By hand always works; letting an agent run on a schedule, or moving a
 * schedule that is on, needs Controls on and a confirm. It still runs only while the org is on and
 * the agent is on duty.
 */
export async function setAgentTime(agentId: string, t: AgentTime | null, confirmed = false): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  try {
    const crew = await loadCrew();
    const flow = await loadFlow(crew);
    const r = withAgentTime(flow.flow, agentId, who.name, t);
    if ("refuse" in r) return { ok: false, text: r.refuse };
    // the crew as it will be: the agent by hand or not
    const manualOnly = new Set(crew.manualOnly);
    if (t) manualOnly.delete(agentId); else manualOnly.add(agentId);
    const problems = flowProblems(r.flow, { ids: crew.ids, manualOnly });
    if (problems.length) return { ok: false, text: problems.join(" ") };
    const looser = flowLooser(flow.flow, r.flow);
    if (t && (looser.length || crew.manualOnly.has(agentId))) {
      if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${who.name} would run on a schedule.` };
      if (!confirmed) return { ok: false, text: `Confirm first: ${who.name} would run ${schedWords({ kind: t.days, time: t.time })}.` };
    }
    // schedule: allow schedules first, then the flow; by hand: the flow first, then mark it by hand
    if (t) { const { error } = await db().from("agents").update({ manual_only: false }).eq("id", agentId); if (error) return fail(error.message); }
    if (JSON.stringify(r.flow) !== JSON.stringify(flow.flow)) await saveFlowVersion(r.flow, t ? `${who.name}: ${schedWords({ kind: t.days, time: t.time })}` : `${who.name}: by hand`, me.email, flow.version);
    if (!t) { const { error } = await db().from("agents").update({ manual_only: true }).eq("id", agentId); if (error) return fail(error.message); }
    revalidatePath("/", "layout");
    await audit(me, "set_agent_time", agentId, { when: t ? schedWords({ kind: t.days, time: t.time }) : "by hand" });
    return { ok: true, text: t ? `${who.name} runs ${schedWords({ kind: t.days, time: t.time })}, while the org is on.` : `${who.name} runs only when you press Run now.` };
  } catch (e) { return fail(e); }
}

// ---- The org switch (docs/org-schedule.md). Turning on is launch: Controls on and a confirm.
// Turning off always works, since it only stops things.

/** What turning on the org would do now: who wakes, first runs, chains, cost a month. */
async function orgPlanNow() {
  const f = await getFloor();
  const flow = await loadFlow(f.palette);
  const members = f.built.map((a) => ({ id: a.id, name: a.name, inOrg: a.inOrg !== false, avgCost: a.avgCost ?? null, capPerRun: a.capPerRun }));
  return { flow, plan: planOrgOn(members, flow.flow.chains, Date.now()) };
}

export async function turnOnOrg(confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} Turning on the org wakes the agents.` };
  if (!confirmed) return { ok: false, text: "Confirm first: turning on the org wakes the agents." };
  try {
    // test agents must stay off: without agents.in_org there is no way to tell them apart
    const probe = await db().from("agents").select("id, in_org").limit(1);
    if (probe.error) return fail(/in_org/.test(probe.error.message) ? "Apply the org switch migration (20261128090000_org_switch.sql) first." : probe.error.message);
    const { flow, plan } = await orgPlanNow();
    if (!plan.wake.length) return { ok: false, text: "No agent is in the org yet." };
    const ids = plan.wake.map((w) => w.id);
    const { error } = await db().from("agents").update({ enabled: true }).in("id", ids);
    if (error) return fail(error.message);
    if (plan.chainsOn.length) await saveFlowVersion({ chains: plan.chains }, `Turned on the org: ${plan.chainsOn.join(", ")} on`, me.email, flow.version);
    // the switch last, so nothing starts before the agents and chains are ready
    await setOrg(true, me.email);
    revalidatePath("/", "layout");
    const first = plan.wake.find((w) => w.firstRun);
    await audit(me, "turn_on_org", null, { agents: ids.length });
    return { ok: true, text: `The org is on. ${ids.length} agent${ids.length === 1 ? " is" : "s are"} on duty${first ? `; first up, ${first.name} at ${when(first.firstRun!)} CT` : ""}.` };
  } catch (e) { return fail(e); }
}

export async function turnOffOrg(): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  try {
    // the switch first, so the dispatcher stops starting chains at once
    await setOrg(false, me.email);
    // every agent, including ones built in the app and test agents
    const { error } = await db().from("agents").update({ enabled: false }).eq("enabled", true);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    await audit(me, "turn_off_org");
    return { ok: true, text: "The org is off. Every agent is off duty and nothing runs on its own." };
  } catch (e) { return fail(e); }
}

// ---- Approvals. Deciding only records the owner's choice. Writing the approved change to Mercury
// also needs DASHBOARD_CONTROLS=on, the gateway's Mercury sign-ins, and the agent on duty (withRun).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why approved actions can't be applied from here at all right now, or null. Each kind's own blocker (Mercury token, Gmail) is the gateway's to say. */
const applyBlocker = () => (!controlsOn() ? "Approved, not applied yet: DASHBOARD_CONTROLS is off." : null);

/** This deployment's own address, for a chain step's request to /api/agents. */
async function selfOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : env.dashboardUrl ?? "";
}

/** Chains that start when an approval is decided (core/flow.ts). Runs after the answer, never blocks it, as this org. */
async function fireApprovalChains(decision: "approve" | "reject") {
  const origin = await selfOrigin();
  if (!origin) return;
  const org = await orgId();
  after(() => withOrg(org, async () => {
    try {
      const flow = await loadFlow(await loadCrew());
      const started = await approvalDecided(origin, flow.flow, ANNOTATE, decision);
      if (started.length) console.log(`[chains] approval ${decision} started ${started.join(", ")}`);
    } catch (e) { console.error("[chains] approval", e); }
  }));
}

async function applyNow(ids?: string[]): Promise<ActionResult> {
  const blocked = applyBlocker();
  if (blocked) return { ok: true, text: blocked.startsWith("Approved") ? blocked : `Approved, not applied yet: ${blocked}` };
  return applyApproved(ids);
}

export async function approve(approvalId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  try {
    const actionId = await decide(approvalId, "approve", me.email);
    if (!actionId) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    const res = await applyNow([actionId]);
    await fireApprovalChains("approve");
    revalidatePath("/", "layout");
    await audit(me, "approve", approvalId);
    return res;
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/**
 * Rejects an approval. A reason is the owner's own words, so it is a reaction (docs/company-mode.md): it
 * saves a rule for the agent (or its department, or everyone) straight away, with no Keep to tap.
 */
export async function reject(approvalId: string, reason?: string, scope?: string, keep?: string, replaces?: string | null): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  try {
    const actionId = await decide(approvalId, "reject", me.email, why || undefined);
    if (!actionId) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    await fireApprovalChains("reject");
    let more = "";
    const { data: ap } = await db().from("approvals").select("agent_id, title").eq("id", approvalId).single();
    if (why && ap) {
      try { more = ` ${await withActor(me.email, async () => saveReaction(ap.agent_id, await nameOf(ap.agent_id), { approvalId }, { verdict: "not", text: why, scope, keep, replaces }))}`; }
      catch (e) { more = ` Your words couldn’t be saved as a rule: ${e instanceof Error ? e.message : String(e)}`; }
    }
    // an agent on a playbook that proposed this goes back to needing approval for its next playbook
    try { if (ap && await holdAfterRejection(ap.agent_id, ap.title)) more += " Its next playbook will wait for your approval."; } catch { /* no playbook tables yet */ }
    revalidatePath("/", "layout");
    await audit(me, "reject", approvalId, why ? { reason: why } : undefined);
    return { ok: true, text: `Rejected.${more}` };
  } catch (e) { return fail(e); }
}

export async function approveAll(approvalIds: string[]): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const ids = approvalIds.filter((i) => UUID.test(i)).slice(0, 200);
  try {
    const actionIds: string[] = [];
    for (const id of ids) { const a = await decide(id, "approve", me.email); if (a) actionIds.push(a); }
    const res = actionIds.length ? await applyNow(actionIds) : { ok: false, text: "Nothing left to approve." };
    if (actionIds.length) await fireApprovalChains("approve");
    revalidatePath("/", "layout");
    if (actionIds.length) await audit(me, "approve_all", null, { approved: actionIds.length });
    return actionIds.length ? { ok: res.ok, text: `Approved ${actionIds.length}. ${res.text}` } : res;
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/** Applies everything approved that is still waiting (also after a failure was put back with Retry). */
export async function applyWaiting(): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  try { const res = await applyNow(); revalidatePath("/", "layout"); return res; } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

export async function retryAction(actionId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(actionId)) return { ok: false, text: "Unknown action." };
  try {
    const back = await retry(actionId);
    if (!back) return { ok: false, text: "Only a failed change can be retried." };
    const res = await applyNow([actionId]);
    revalidatePath("/", "layout");
    await audit(me, "retry_action", actionId);
    return res;
  } catch (e) { return fail(e); }
}

/** Turns Quinn's saved proposals into approvals. Writes only Supabase, never Mercury. */
export async function queueQuinn(): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  try {
    const r = await queueBookkeeperProposals(null);
    revalidatePath("/", "layout");
    return { ok: true, text: r.queued || r.refused ? `${r.queued} new approval${r.queued === 1 ? "" : "s"} from Quinn${r.refused ? `, ${r.refused} refused by the gateway (see the log)` : ""}.` : "No new proposals from Quinn." };
  } catch (e) { return fail(e); }
}

// ---- Memory. Teaching, editing and forgetting spend nothing and wake nothing, so they need only the login.

/**
 * Good or Not this on a run, or on one item of a run (a lead it found). The run and the item must
 * belong to the agent: both are looked up here, never taken from the page.
 */
export async function react(agentId: string, runId: string, itemId: string | null, verdict: string, text = "", scope = "agent", keep = "always", replaces: string | null = null): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  if (!UUID.test(runId) || (itemId && !UUID.test(itemId))) return { ok: false, text: "Unknown run." };
  try {
    const { data: run } = await db().from("agent_runs").select("agent_id").eq("id", runId).maybeSingle();
    if (!run || run.agent_id !== agentId) return { ok: false, text: "That run isn’t this agent’s." };
    let itemLabel: string | null = null;
    if (itemId) {
      const { data: lead } = await db().from("wholesale_leads").select("business, run_id").eq("id", itemId).maybeSingle();
      if (!lead || lead.run_id !== runId) return { ok: false, text: "That lead isn’t from this run." };
      itemLabel = String(lead.business);
    }
    const said = await withActor(me.email, () => saveReaction(agentId, who.name, { runId, itemId, itemLabel }, { verdict, text, scope, keep, replaces }));
    revalidatePath("/", "layout");
    return { ok: true, text: said };
  } catch (e) { return fail(e); }
}

export async function editMemoryLine(memoryId: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await withActor(me.email, () => editMemory(memoryId, String(text))); revalidatePath("/", "layout"); return { ok: true, text: "Saved. The old words are in the timeline." }; } catch (e) { return fail(e); }
}

export async function forgetMemoryLine(memoryId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await withActor(me.email, () => forgetMemory(memoryId)); revalidatePath("/", "layout"); return { ok: true, text: "Forgotten. It won’t be loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function keepLessonLine(memoryId: string, forCrew: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await withActor(me.email, () => keepLesson(memoryId, !!forCrew)); revalidatePath("/", "layout"); return { ok: true, text: forCrew ? "Kept for the whole crew." : "Kept. It’s loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function discardLessonLine(memoryId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await withActor(me.email, () => discardLesson(memoryId)); revalidatePath("/", "layout"); return { ok: true, text: "Discarded. The timeline keeps a record of it." }; } catch (e) { return fail(e); }
}

// ---- Crew flow (docs/agent-setup.md, slice 5): chains of agents on the Crew canvas

/** A flow from the browser, checked against the palette before anything is saved or run. */
async function cleanFlow(f: unknown): Promise<{ flow: Flow } | { problems: string[] }> {
  const problems = flowProblems(f, await loadCrew());
  return problems.length ? { problems } : { flow: f as Flow };
}

/**
 * Saves the crew flow as a new version. A chain that starts running on its own (or gains an
 * agent) needs a confirm and DASHBOARD_CONTROLS=on. Saving never turns an agent on: each run
 * still goes through withRun, and an agent that is off duty is skipped.
 */
export async function saveCrewFlow(flow: unknown, note: string, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const why = String(note ?? "").trim().slice(0, 300);
  if (!why) return { ok: false, text: "Add a short note saying why, so the version list makes sense later." };
  const got = await cleanFlow(flow);
  if ("problems" in got) return { ok: false, text: `Not saved: ${got.problems.slice(0, 5).join(" ")}` };
  try {
    const now = await loadFlow(await loadCrew());
    if (JSON.stringify(now.flow) === JSON.stringify(got.flow)) return { ok: false, text: "Nothing changed from the saved flow." };
    const looser = flowLooser(now.flow, got.flow);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    const v = await saveFlowVersion(got.flow, why, me.email, now.version);
    revalidatePath("/", "layout");
    await audit(me, "save_flow", null, { version: v });
    return { ok: true, text: `Saved as flow v${v}.${got.flow.chains.some((c) => c.on) ? " Chains that are on start at their next time; agents that are off duty are skipped." : " Every chain is off, so nothing runs on its own."}` };
  } catch (e) { return fail(e); }
}

export async function rollBackFlow(version: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const crew = await loadCrew();
    const [now, all] = await Promise.all([loadFlow(crew), listFlowVersions(crew)]);
    const target = all.find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no flow v${version}.` };
    if (target.version === now.version) return { ok: false, text: `v${version} is already active.` };
    const looser = flowLooser(now.flow, target.flow);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    await activateFlow(version, now.version);
    revalidatePath("/", "layout");
    await audit(me, "roll_back_flow", null, { version });
    return { ok: true, text: `Flow v${version} is active again.` };
  } catch (e) { return fail(e); }
}

/**
 * The Run chain button: starts a saved chain now, even while it is off (like the Run button on a
 * profile). Real runs, so DASHBOARD_CONTROLS=on; each agent still needs to be on duty.
 */
export async function runChainNow(key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  try {
    const flow = await loadFlow(await loadCrew());
    const c = flow.flow.chains.find((x) => x.key === key);
    if (!c) return { ok: false, text: "That chain isn’t in the saved flow. Save first." };
    const origin = await selfOrigin();
    if (!origin) return { ok: false, text: "Can’t work out this app’s address to start the chain." };
    const chainId = crypto.randomUUID();
    await startStep(origin, c, { chainId, key: c.key, step: 0, manual: true });
    await audit(me, "run_chain_now", c.key, { chain: c.name });
    revalidatePath("/", "layout");
    const names = await Promise.all(c.steps.map((s) => nameOf(s.agent)));
    return { ok: true, text: `${c.name} started: ${names.join(", then ")}. An agent that is off duty is skipped and the chain stops there. Runs shows each step.` };
  } catch (e) { return fail(e); }
}

export interface ChainPreviewStep { agent: string; name: string; summary: string; next: string }

/**
 * Preview a chain from the canvas (saved or not): each step's dry run in order (real data, no
 * writes, no model, no cost, nothing logged), and what the chain would do after it. A dry run
 * reports no numbers, so a check is shown as not tested.
 */
export async function previewChain(flow: unknown, key: string): Promise<ActionResult & { steps?: ChainPreviewStep[] }> {
  const { no } = await asRole("approver"); if (no) return no;
  const got = await cleanFlow(flow);
  if ("problems" in got) return { ok: false, text: got.problems.slice(0, 5).join(" ") };
  const c = got.flow.chains.find((x) => x.key === key);
  if (!c) return { ok: false, text: "Unknown chain." };
  const steps: ChainPreviewStep[] = [];
  for (let k = 0; k < c.steps.length; k++) {
    const s = c.steps[k], name = await nameOf(s.agent);
    let summary: string, status: "ok" | "failed" = "ok";
    try { summary = (await jobOf(s.agent)({ dryRun: true })).summary; }
    catch (e) { status = "failed"; summary = `Dry run failed: ${e instanceof Error ? e.message : String(e)}`; }
    const nxt = c.steps[k + 1];
    let next = "End of the chain.";
    if (nxt) {
      const nn = await nameOf(nxt.agent);
      const when = nxt.when ?? "ok";
      const goes = when === "any" || (when === "ok" ? status === "ok" : status === "failed");
      next = !goes ? `${nn} would not run (${when === "ok" ? "only after a step that worked" : "only after a failure"}).`
        : `${nn} would run next${nxt.days && nxt.days !== "daily" ? ` ${DAY_WORDS[nxt.days]}` : ""}${nxt.notBefore ? `, not before ${nxt.notBefore}` : ""}${nxt.check ? `, if ${nxt.check.metric} ${nxt.check.op} ${nxt.check.value} (a dry run reports no numbers, so not tested)` : ""}${nxt.passAlong ? `, with ${name}’s summary passed along` : ""}.`;
      if (!goes) { steps.push({ agent: s.agent, name, summary, next }); break; }
    }
    steps.push({ agent: s.agent, name, summary, next });
  }
  return { ok: true, text: `Previewed ${c.name}: ${steps.length} step${steps.length === 1 ? "" : "s"}. Nothing was written or sent.`, steps };
}

// ---- Caps, vendors and suppressed addresses (Settings). Agents never call
// these: only a signed-in the owner. Tightening is always allowed; loosening needs a confirm and
// DASHBOARD_CONTROLS=on, and never passes the limit in code (CAPS in core/gateway/policy.ts).

export async function setCap(key: string, value: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
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
    await db().from("policy_log").insert({ key, old_value: caps[key as CapKey].raw ?? null, new_value: v, changed_by: me.email });
    revalidatePath("/", "layout");
    await audit(me, "set_cap", key, { value });
    return { ok: true, text: `${CAPS[key as CapKey].label}: ${fmtCap(key as CapKey, v)}. The gateway uses it from the next check.` };
  } catch (e) { return fail(e); }
}

const KINDS = ["importer", "packaging", "other"] as const;

/** Adds a payee. Only here, only the owner, DASHBOARD_CONTROLS=on. A first payment to a vendor always waits for approval. */
export async function addVendor(form: { name: string; kind: string; mercuryRecipientId: string; contactEmail: string }): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const name = String(form.name ?? "").trim(), kind = KINDS.includes(form.kind as (typeof KINDS)[number]) ? form.kind : "other";
  const rid = String(form.mercuryRecipientId ?? "").trim(), email = String(form.contactEmail ?? "").trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, text: "Give the vendor a name (up to 120 characters)." };
  if (rid && !/^[0-9a-f-]{36}$/i.test(rid)) return { ok: false, text: "The Mercury recipient id is the long id from Mercury (Payments, Recipients). Leave it empty if the recipient isn’t in Mercury yet." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That contact email doesn’t look right." };
  const { error } = await db().from("vendors").insert({ name, kind, mercury_recipient_id: rid || null, contact_email: email || null, added_by: me.email });
  if (error) return fail(error.code === "23505" ? "That Mercury recipient is already a vendor." : error.message);
  revalidatePath("/settings");
  await audit(me, "add_vendor", form.name, { kind: form.kind });
  return { ok: true, text: `${name} added to vendors.${rid ? "" : " Add its Mercury recipient id before anything can be paid to it."}` };
}

/** Stops all email to an address. Always allowed: it only takes power away. */
export async function suppressEmail(address: string, reason: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const email = String(address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That isn’t an email address." };
  const { error } = await db().from("email_suppressions").upsert({ email, reason: String(reason ?? "").trim().slice(0, 200) || `Added by ${me.email}`, source: "owner" });
  if (error) return fail(error.message);
  revalidatePath("/settings");
  await audit(me, "suppress_email", address);
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

/** Tools from servers the owner added that aren't turned on now (or whose server is gone). */
async function customGone(spec: AgentSpec): Promise<string[]> {
  const ids = spec.tools.filter(isCustomToolId);
  if (!ids.length) return [];
  const on = new Set((await customMenu()).flatMap((s) => s.tools.map((t) => t.id)));
  return ids.filter((id) => !on.has(id)).map(() => "a tool from a server you added is no longer turned on (Connections)");
}

/** A draft from the builder, checked against code and, for tools from servers you added, against what is turned on. Problems refuse it; nothing is clamped. */
async function checkedDraft(draft: unknown, agentId: string): Promise<{ spec: AgentSpec } | { error: string }> {
  const { spec, problems } = readSpec(draft, agentId);
  const all = [...problems, ...(await customGone(spec))];
  return all.length ? { error: `This draft asks for something code doesn’t offer: ${all.join("; ")}.` } : { spec };
}

/**
 * Creates a new agent, off duty, from the builder flow's draft (docs/builder-flow.md, slice 2). The
 * draft is checked against code like any save; a new agent has no gateway actions, since the
 * gateway names the agents that may ask for each one.
 */
/** Creates the agent off duty as v1, and puts it in the seat picked in step 1 when that seat is still open. */
export async function createBuilt(draft: unknown, seatId?: string | null): Promise<ActionResult & { id?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const { spec, problems: p0 } = readSpec(draft);
    const problems = [...p0, ...(await customGone(spec))];
    if (problems.length) return { ok: false, text: `Not created. This draft asks for something code doesn’t offer: ${problems.join("; ")}.` };
    if (spec.tools.some((t) => TOOLS[t]?.kind === "action")) return { ok: false, text: "Not created. A new agent can’t ask for actions: code names which agents may." };
    const id = await createBuiltAgent(spec, me.email);
    let seated = "";
    if (seatId && UUID.test(seatId)) {
      const o = await loadOrg();
      const seat = o?.seats.find((s) => s.id === seatId);
      if (o && seat?.holder === "open") {
        try { await setHolder(seat.id, "agent", id); seated = ` It sits in ${seatPath(o, seat)}.`; } catch (e) { seated = ` It isn’t on the chart yet: ${e instanceof Error ? e.message : e}`; }
      } else seated = " That seat was taken meanwhile, so it isn’t on the chart yet.";
    }
    revalidatePath("/", "layout");
    await audit(me, "create_agent", id, { name: spec.name });
    return { ok: true, text: `${spec.name} is saved as v1, off duty.${seated}`, id };
  } catch (e) { return fail(e); }
}

/** Saves the flow's draft as the next version, a draft: today's version keeps running until Go live. */
export async function saveSpec(agentId: string, draft: unknown, note: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const why = String(note ?? "").trim().slice(0, 300) || "Edited in the builder";
  try {
    await builtAgent(agentId);
    const got = await checkedDraft(draft, agentId);
    if ("error" in got) return { ok: false, text: `Not saved. ${got.error}` };
    const versions = await listSpecVersions(agentId);
    const base = draftOf(versions) ?? versions.find((v) => v.active);
    if (base && JSON.stringify(base.spec) === JSON.stringify(got.spec)) return { ok: false, text: `Nothing changed from v${base.version}.` };
    const v = await saveSpecVersion(agentId, got.spec, why, me.email);
    revalidatePath("/", "layout");
    await audit(me, "save_spec", agentId, { version: v });
    return { ok: true, text: `Saved as draft v${v}. Try it, then go live; what runs today hasn’t changed.` };
  } catch (e) { return fail(e); }
}

/** Goes back to an earlier version in one tap. Anything that lets it do or spend more needs Controls on and a confirm. */
export async function goBack(agentId: string, version: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
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
    await audit(me, "go_back", agentId, { version });
    return { ok: true, text: `Back on v${version}. The next run uses it.` };
  } catch (e) { return fail(e); }
}

/** A built agent's daily budget. Lowering is always allowed; raising needs DASHBOARD_CONTROLS=on. */
export async function setBuiltBudget(agentId: string, value: number): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
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
    await audit(me, "set_agent_budget", agentId, { usd: v });
    return { ok: true, text: `Budget saved: $${v.toFixed(2)} a day.` };
  } catch (e) { return fail(e); }
}

/** Adds a standing order for a built agent: the same memory store as the Memory tab. */
export async function addStandard(agentId: string, text: string, notionLink = ""): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  try {
    await builtAgent(agentId);
    const link = String(notionLink ?? "").slice(0, 500);
    await withActor(me.email, () => teachMemory({ agentId, text: String(text ?? ""), keepAs: "standing_order", forget: "always", notionLink: link }));
    revalidatePath("/", "layout");
    return { ok: true, text: `Saved. It’s loaded on every run from the next one${link ? ", with the linked page read fresh each time" : ""}.` };
  } catch (e) { return fail(e); }
}

/** Runs every tool the draft (or the saved spec) grants once with default inputs. No model, nothing written, not logged. */
export async function dryRunBuilt(agentId: string, draft?: unknown): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  try {
    const now = await builtAgent(agentId);
    let spec = now?.spec;
    if (draft !== undefined) { const g = await checkedDraft(draft, agentId); if ("error" in g) return { ok: false, text: g.error }; spec = g.spec; }
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
  const { me, no } = await asRole("owner"); if (no) return no;
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
    await audit(me, "try_agent", agentId, { version: target.version, cost_usd: res.costUsd ?? 0 });
    return { ok: res.status === "ok", text: `Try of v${target.version} done ($${(res.costUsd ?? 0).toFixed(4)}).${note}`, runId: rid ?? undefined };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/**
 * Go live (step 6): makes a version the one that runs, only after its latest try worked on every
 * step. It approves the routine that try drafted (with the steps the owner kept). On or off duty,
 * schedules and chains don't change.
 */
export async function goLive(agentId: string, version: number, keep: number[] | null, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
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
      const v = await withActor(me.email, () => approvePlaybook(agentId, pending.id, Array.isArray(keep) ? keep.map(Number).filter(Number.isInteger) : pending.steps.map((_, i) => i)));
      routine = ` Routine v${v} approved.`;
    } else if (!activePlaybook(all)) return { ok: false, text: "No routine yet: try it fresh, so code can save the calls that worked." };
    if (!target.active) await activateSpecVersion(agentId, version);
    revalidatePath("/", "layout");
    await audit(me, "go_live", agentId, { version, playbook: routine ? "approved" : "unchanged" });
    return { ok: true, text: `v${version} is live.${routine} On or off duty hasn’t changed.` };
  } catch (e) { return fail(e); }
}

