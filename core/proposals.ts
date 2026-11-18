import "server-only";
// Proposals store (docs/company-mode.md, slice 3). A head files proposals at the end of a run (the
// `propose` report tool); the owner decides each one. Nothing a proposal says happens until their tap, and
// then only through the app's own paths: a hire is created off duty with no actions (like New
// agent), a tool grant becomes a draft version that still needs Try it and Go live, a new tool opens
// Find a tool (use a connection, add a server, or ask for a connector), a retirement takes an agent off duty and opens its seat. Every check runs again
// at the tap, against the chart and the tool list as they are then.
import { db } from "@/core/db";
import { createBuiltAgent, draftOf, listSpecVersions, readSpec, saveSpecVersion } from "@/core/agent-spec";
import { teach } from "@/core/memory";
import { addSeat, agentNames, below, headOf, liveAgentIds, loadOrg, removeSeat, seatOf, setHolder, unseat, type Org, type Seat } from "@/core/org";
import { TOOLS } from "@/core/tools/catalog";
import { hireSpec, planProposal, proposalTitle, toolInfoOf, type ProposalKind, type ProposalPlan } from "@/core/proposal-rules";

export type ProposalState = "pending" | "accepted" | "declined" | "built" | "failed";
export interface Proposal {
  id: string; kind: ProposalKind; title: string; source: "agent" | "claude" | "owner";
  from_agent: string | null; department_id: string | null; run_id: string | null;
  payload: Resolved; why: string; state: ProposalState; outcome: string | null; result_ref: string | null;
  decided_at: string | null; created_at: string;
}
/** A plan with names resolved against the chart when it was filed (checked again at the tap). */
export type Resolved = ProposalPlan & { seatId?: string | null; parentSeatId?: string | null; agentId?: string | null };

export const PROPOSALS_MISSING = "The proposals table isn’t in Supabase yet: apply the migration 20261122090000_proposals.sql.";
const COLS = "id, kind, title, source, from_agent, department_id, run_id, payload, why, state, outcome, result_ref, decided_at, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING_PER_AGENT = 6;
const toolInfo = () => toolInfoOf(TOOLS);
export const toolLabel = (id: string) => TOOLS[id]?.label ?? id;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The seat a proposer speaks for: a department head (its department), or the company seat (every department). */
export function proposerSeat(org: Org, agentId: string): Seat | null {
  const s = seatOf(org, agentId);
  return s && (s.parentId == null) ? s : null;
}

/** Seats a proposal may touch: the proposer's department (every department for the company seat). */
const scope = (org: Org, seat: Seat | null) => org.seats.filter((s) => s.departmentId != null && (!seat?.departmentId || s.departmentId === seat.departmentId));

/**
 * Resolves names in a plan to seats and agents on the chart, within the proposer's reach. `seat`
 * null means the owner or Claude filed it: any department.
 */
async function resolve(org: Org, plan: ProposalPlan, seat: Seat | null, deptId: string | null): Promise<{ r: Resolved; dept: string | null } | { problem: string }> {
  const seats = scope(org, seat);
  const live = await liveAgentIds();
  const inReach = seats.filter((s) => s.holder === "agent" && s.agentId).map((s) => s.agentId as string);
  const names = await agentNames(inReach);
  const agentNamed = (n: string) => inReach.find((id) => same(names[id] ?? "", n) || same(id, n)) ?? null;
  if (plan.kind === "hire") {
    const open = seats.find((s) => s.holder === "open" && same(s.title, plan.seat));
    if (open) return { r: { ...plan, seatId: open.id, parentSeatId: null }, dept: open.departmentId };
    // a new seat goes under the proposer's own seat; the owner and Claude name an open seat or a department head
    const parent = seat?.departmentId ? seat : deptId ? headOf(org, deptId) : null;
    if (!parent) return { problem: `there is no open seat called “${plan.seat}”` };
    return { r: { ...plan, seatId: null, parentSeatId: parent.id }, dept: parent.departmentId };
  }
  if (plan.kind === "grant_tool") {
    const id = agentNamed(plan.agent);
    if (!id || !live.has(id)) return { problem: `${plan.agent} isn't an agent in your department` };
    if (id === seat?.agentId) return { problem: "a head can't propose tools for itself" };
    return { r: { ...plan, agentId: id }, dept: seats.find((s) => s.agentId === id)?.departmentId ?? null };
  }
  if (plan.kind === "retire") {
    if (plan.agent) {
      const id = agentNamed(plan.agent);
      if (!id) return { problem: `${plan.agent} isn't an agent in your department` };
      if (id === seat?.agentId) return { problem: "a head can't propose retiring itself" };
      const at = seats.find((s) => s.agentId === id);
      if (at?.parentId == null) return { problem: "a department head isn't retired by a proposal; the owner does that on Crew" };
      return { r: { ...plan, agentId: id }, dept: at.departmentId };
    }
    const s = seats.find((x) => same(x.title, plan.seat ?? ""));
    if (!s) return { problem: `there is no seat called “${plan.seat}” in your department` };
    if (s.parentId == null) return { problem: "a department's head seat can't be closed this way" };
    return { r: { ...plan, seatId: s.id }, dept: s.departmentId };
  }
  return { r: plan, dept: seat?.departmentId ?? deptId };
}

/** Files one checked proposal. Returns its id. */
export async function fileProposal(input: Record<string, unknown>, from: { agentId: string | null; runId?: string | null; source: Proposal["source"]; deptId?: string | null }): Promise<string> {
  const got = planProposal(input, toolInfo());
  if ("problem" in got) throw new Error(got.problem);
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  let seat: Seat | null = null;
  if (from.agentId) {
    seat = proposerSeat(org, from.agentId);
    if (!seat) throw new Error("only a department head (or the company seat) files proposals");
  }
  const res = await resolve(org, got.plan, seat, from.deptId ?? null);
  if ("problem" in res) throw new Error(res.problem);
  const title = proposalTitle(got.plan, toolLabel);
  const { data: open, error: e1 } = await db().from("proposals").select("id, title").eq("state", "pending").eq("source", from.source).limit(200);
  if (e1) throw new Error(/proposals/.test(e1.message) ? PROPOSALS_MISSING : e1.message);
  const mine = (open ?? []) as { id: string; title: string }[];
  if (mine.some((p) => same(p.title, title))) throw new Error(`“${title}” is already waiting for the owner`);
  if (from.agentId) {
    const { count } = await db().from("proposals").select("id", { count: "exact", head: true }).eq("state", "pending").eq("from_agent", from.agentId);
    if ((count ?? 0) >= MAX_PENDING_PER_AGENT) throw new Error(`${MAX_PENDING_PER_AGENT} proposals are already waiting for the owner; wait for an answer`);
  }
  const { data, error } = await db().from("proposals").insert({
    kind: got.plan.kind, title, source: from.source, from_agent: from.agentId, department_id: res.dept, run_id: from.runId ?? null, payload: res.r, why: got.why,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function listProposals(states: ProposalState[], limit = 50): Promise<Proposal[] | null> {
  const { data, error } = await db().from("proposals").select(COLS).in("state", states).order("created_at", { ascending: false }).limit(limit);
  return error ? null : (data ?? []) as Proposal[];
}

export async function getProposal(id: string): Promise<Proposal | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db().from("proposals").select(COLS).eq("id", id).maybeSingle();
  return error || !data ? null : data as Proposal;
}

async function close(id: string, state: ProposalState, outcome: string, ref: string | null = null) {
  const { error } = await db().from("proposals").update({ state, outcome: outcome.slice(0, 400), result_ref: ref, decided_at: new Date().toISOString() }).eq("id", id).eq("state", "pending");
  if (error) throw new Error(error.message);
}

/** Is the hire's name free, and is its seat still where it was? Throws with what changed. */
async function hireChecks(p: Extract<Resolved, { kind: "hire" }>, org: Org) {
  const { data } = await db().from("agents").select("id").ilike("name", p.name).limit(1);
  if (data?.length) throw new Error(`There is already an agent called ${p.name}. Change it first and pick another name.`);
  if (p.seatId && org.seats.find((s) => s.id === p.seatId)?.holder !== "open") throw new Error("That seat isn't open any more. Change it first and pick a seat.");
  if (!p.seatId && !org.seats.some((s) => s.id === p.parentSeatId)) throw new Error("The seat it would sit under isn't on the chart any more.");
}

/** The spec a hire would create, checked against code like any save. */
export function hireDraft(p: Extract<Resolved, { kind: "hire" }>) {
  const { spec, problems } = readSpec(hireSpec(p));
  const actions = spec.tools.filter((t) => TOOLS[t]?.kind === "action");
  // only the owner grants a tool from a server they added, on the builder's Tools step
  const custom = spec.tools.filter((t) => !TOOLS[t]);
  return { spec, problems: [...problems, ...actions.map((t) => `${toolLabel(t)} is an action, which a new agent can't have`), ...custom.map(() => "a tool from a server you added is granted only on the builder's Tools step")] };
}

/** Seats the hire: its open seat, or a new one under the proposer. Returns the seat's words. */
async function seatHire(p: Extract<Resolved, { kind: "hire" }>, agentId: string): Promise<string> {
  const seatId = p.seatId ?? await addSeat(p.parentSeatId!, p.seat, p.job.slice(0, 120));
  await setHolder(seatId, "agent", agentId);
  return p.seatId ? `the ${p.seat} seat` : `a new ${p.seat} seat`;
}

/**
 * The owner's yes. Each kind goes through the app's own path, checked again now. `agentFromBuilder` is
 * set when he changed a hire first in the builder, which already created the agent off duty.
 */
export async function acceptProposal(id: string, opts: { agentFromBuilder?: string } = {}): Promise<{ text: string; href: string | null }> {
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending") throw new Error("That proposal isn't waiting any more.");
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const p = pr.payload;
  try {
    if (p.kind === "hire") {
      if (opts.agentFromBuilder) {
        await close(id, "accepted", `Hired as ${opts.agentFromBuilder}, changed first in the builder, off duty.`, opts.agentFromBuilder);
        return { text: "Hired, off duty.", href: `/build/${opts.agentFromBuilder}` };
      }
      await hireChecks(p, org);
      const d = hireDraft(p);
      if (d.problems.length) throw new Error(`It asks for something code doesn’t offer: ${d.problems.join("; ")}.`);
      const agentId = await createBuiltAgent(d.spec, pr.from_agent ? `proposal from ${pr.from_agent}` : "proposal");
      let where = "";
      try { where = ` in ${await seatHire(p, agentId)}`; } catch (e) { where = `, but not on the chart yet: ${e instanceof Error ? e.message : e}`; }
      await close(id, "accepted", `Created ${p.name} (${agentId}) off duty as v1${where}.`, agentId);
      return { text: `${p.name} is hired, off duty, as v1${where}. Try it, then Go live.`, href: `/build/${agentId}` };
    }
    if (p.kind === "grant_tool") {
      const t = TOOLS[p.tool];
      if (!t || t.kind === "action") throw new Error(`${toolLabel(p.tool)} can't be handed out by a proposal.`);
      const versions = await listSpecVersions(p.agentId!);
      const base = draftOf(versions) ?? versions.find((v) => v.active);
      if (!base) throw new Error("That agent wasn't built in the app, so a tool can't be added to it here.");
      if (base.spec.tools.includes(p.tool)) throw new Error(`It already has ${t.label}.`);
      const { spec, problems } = readSpec({ ...base.spec, tools: [...base.spec.tools, p.tool] }, p.agentId!);
      if (problems.length) throw new Error(`Not saved: ${problems.join("; ")}.`);
      const v = await saveSpecVersion(p.agentId!, spec, `Adds ${t.label}, proposed${pr.from_agent ? ` by ${pr.from_agent}` : ""}`, "proposal");
      await close(id, "accepted", `Draft v${v} adds ${t.label}. It runs only after Try it and Go live.`, p.agentId!);
      return { text: `Saved as draft v${v} with ${t.label}. Try it, then Go live; what runs today hasn’t changed.`, href: `/build/${p.agentId}` };
    }
    if (p.kind === "new_tool") {
      // a yes hands out nothing: the owner picks how on Find a tool, where an ask for a connector is counted
      await close(id, "accepted", "Sent to Find a tool.");
      return { text: "Pick how on Find a tool: a connection you have, a server you add, or an ask for a connector.", href: `/connections/find?for=${id}` };
    }
    // retire
    if (p.agentId) {
      const { error } = await db().from("agents").update({ enabled: false }).eq("id", p.agentId);
      if (error) throw new Error(error.message);
      await unseat(p.agentId);
      await close(id, "accepted", "Off duty, and its seat is open.", p.agentId);
      return { text: "Off duty, and its seat is open. Its versions and runs stay.", href: `/agents/${p.agentId}` };
    }
    const s = org.seats.find((x) => x.id === p.seatId);
    if (!s) throw new Error("That seat isn't on the chart any more.");
    if (s.holder === "agent") throw new Error("Someone sits in that seat now. Move them out first.");
    if (below(org, s.id).length) throw new Error("That seat has seats under it. Remove those first.");
    await removeSeat(s.id);
    await close(id, "accepted", `The ${s.title} seat is closed.`);
    return { text: `The ${s.title} seat is closed.`, href: "/crew" };
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** The owner's no. With words, they become a 30-day note for the head that proposed it. */
export async function declineProposal(id: string, reason: string): Promise<string> {
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending") throw new Error("That proposal isn't waiting any more.");
  const words = reason.replace(/\s+/g, " ").trim().slice(0, 240);
  let noted = "";
  if (pr.from_agent && words) {
    try {
      await teach({ agentId: pr.from_agent, text: `The owner said not now to “${pr.title}”: ${words}`.slice(0, 280), keepAs: "note", forget: "days_30", sourceTag: `proposal:${id}` });
      noted = " Your words are a 30-day note for the head that asked.";
    } catch { noted = " (Your words couldn’t be saved as a note.)"; }
  }
  await close(id, "declined", words ? `Not now: ${words}` : "Not now.");
  return `Not now.${noted}`;
}

/** Pending proposals per seat, for the org chart: a hire on its seat (or the seat it goes under), a retirement on its seat. */
export function proposalsBySeat(org: Org, list: Proposal[]): Record<string, { id: string; text: string }[]> {
  const out: Record<string, { id: string; text: string }[]> = {};
  for (const p of list) {
    const r = p.payload;
    const seatId = r.kind === "hire" ? r.seatId ?? r.parentSeatId : r.kind === "retire" ? r.seatId ?? (r.agentId ? seatOf(org, r.agentId)?.id : null) : null;
    if (seatId) (out[seatId] ??= []).push({ id: p.id, text: p.title });
  }
  return out;
}

export interface Check { ok: boolean; text: string }

/** What code checks again at the tap, as a list for the proposal page. Read-only. */
export async function proposalChecks(pr: Proposal, org: Org): Promise<Check[]> {
  const p = pr.payload;
  const seatTitle = (id: string | null | undefined) => org.seats.find((s) => s.id === id)?.title ?? null;
  if (p.kind === "hire") {
    const { data } = await db().from("agents").select("id").ilike("name", p.name).limit(1);
    const d = hireDraft(p);
    const seat = p.seatId ? org.seats.find((s) => s.id === p.seatId) : null;
    return [
      { ok: !data?.length, text: data?.length ? `There is already an agent called ${p.name}` : `No other agent is called ${p.name}` },
      p.seatId
        ? { ok: seat?.holder === "open", text: seat?.holder === "open" ? `The ${p.seat} seat is open` : `The ${p.seat} seat isn’t open any more` }
        : { ok: !!seatTitle(p.parentSeatId), text: seatTitle(p.parentSeatId) ? `A new ${p.seat} seat goes under ${seatTitle(p.parentSeatId)}` : "The seat it would sit under is gone" },
      { ok: !d.problems.length, text: d.problems.length ? d.problems.join("; ") : `Every tool is on the list, and none is an action` },
      { ok: true, text: "Starts off duty, so nothing runs until you Try it and Go live" },
    ];
  }
  if (p.kind === "grant_tool") {
    const t = TOOLS[p.tool];
    const live = await liveAgentIds();
    return [
      { ok: !!t && t.kind !== "action", text: !t ? `${p.tool} isn’t on the tool list` : t.kind === "action" ? `${t.label} is an action` : `${t.label} is a ${t.kind} tool, not an action` },
      { ok: !!p.agentId && live.has(p.agentId), text: p.agentId && live.has(p.agentId) ? `${p.agent} is on the crew` : `${p.agent} isn’t on the crew any more` },
      { ok: true, text: "Saved as a draft version: what runs today doesn’t change until Go live" },
    ];
  }
  if (p.kind === "retire") {
    if (p.agentId) {
      const s = seatOf(org, p.agentId);
      return [
        { ok: !!s && s.parentId != null, text: s ? `${p.agent} sits in ${s.title}` : `${p.agent} isn’t on the chart` },
        { ok: true, text: "Off duty, not deleted: its versions and runs stay, and you can turn it back on" },
      ];
    }
    const s = org.seats.find((x) => x.id === p.seatId);
    return [
      { ok: !!s && s.holder !== "agent", text: !s ? "That seat is gone" : s.holder === "agent" ? "Someone sits there now" : `The ${s.title} seat is empty` },
      { ok: !!s && !below(org, s.id).length, text: s && below(org, s.id).length ? "It has seats under it" : "No seats under it" },
    ];
  }
  return [{ ok: true, text: "A yes hands out nothing: it opens Find a tool, where you pick a connection, add a server, or ask for a connector" }];
}
