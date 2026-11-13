import "server-only";
// Playbooks (docs/agent-builder.md, slice 4). An explore run lets the model pick its own tool
// calls. Code drafts a playbook from the calls that worked: the tools and inputs, in order. Zak
// approves an agent's first playbook (and may drop steps); after that, runs follow it: code makes
// the calls, the model only writes the result. When a step fails the run falls back to exploring.
//
// Updates (Zak, Nov 13): once a playbook is approved, a new one drafted from a deliberate
// Re-explore applies automatically, with what changed shown. A run that falls back or doesn't
// finish puts the agent on hold: its next playbook waits for approval again. A rejected action
// (slice 5) will do the same.
import { db } from "@/core/db";
import { TOOLS } from "@/core/tools/catalog";
import type { PlaybookStep, RunMode, Step } from "@/core/runner";

export type PlaybookStatus = "proposed" | "approved" | "rejected" | "replaced";
export interface Playbook {
  id: number; agentId: string; version: number; steps: PlaybookStep[]; status: PlaybookStatus;
  fromRun: string | null; changes: string | null; auto: boolean; createdAt: string; decidedAt: string | null;
}

/** The steps an explore run found: every tool call that worked, in order, without repeats. */
export function draftSteps(steps: Step[]): PlaybookStep[] {
  const out: PlaybookStep[] = [];
  for (const s of steps) {
    if (s.kind !== "tool" || !s.ok || !s.tool) continue;
    const input = (s.input && typeof s.input === "object" ? s.input : {}) as Record<string, string | number>;
    const key = stepKey({ tool: s.tool, input });
    if (!out.some((x) => stepKey(x) === key)) out.push({ tool: s.tool, input });
  }
  return out.slice(0, 30);
}

const stepKey = (s: PlaybookStep) => `${s.tool}(${Object.keys(s.input).sort().map((k) => `${k}=${s.input[k]}`).join(",")})`;

/** "Green lots on hand", or "Green use per week (days 30)". */
export function stepLabel(s: PlaybookStep): string {
  const ins = Object.entries(s.input).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ");
  return `${TOOLS[s.tool]?.label ?? s.tool}${ins ? ` (${ins})` : ""}`;
}

export const sameSteps = (a: PlaybookStep[], b: PlaybookStep[]) => a.length === b.length && a.every((s, i) => stepKey(s) === stepKey(b[i]));

/** What changed from one playbook to the next, in plain words. */
export function stepChanges(before: PlaybookStep[] | null, after: PlaybookStep[]): string {
  if (!before) return `First playbook: ${after.length} step${after.length === 1 ? "" : "s"}.`;
  const bk = new Set(before.map(stepKey)), ak = new Set(after.map(stepKey));
  const added = after.filter((s) => !bk.has(stepKey(s))).map(stepLabel);
  const removed = before.filter((s) => !ak.has(stepKey(s))).map(stepLabel);
  const parts = [added.length && `Added: ${added.join("; ")}.`, removed.length && `Removed: ${removed.join("; ")}.`].filter(Boolean);
  return parts.length ? parts.join(" ") : "Same steps in a new order.";
}

const row = (r: Record<string, unknown>): Playbook => ({
  id: Number(r.id), agentId: r.agent_id as string, version: r.version as number, steps: (Array.isArray(r.steps) ? r.steps : []) as PlaybookStep[],
  status: r.status as PlaybookStatus, fromRun: (r.from_run as string) ?? null, changes: (r.changes as string) ?? null, auto: !!r.auto,
  createdAt: r.created_at as string, decidedAt: (r.decided_at as string) ?? null,
});

/** Every playbook of an agent, newest first. Throws when the table can't be read. */
export async function listPlaybooks(agentId: string): Promise<Playbook[]> {
  const { data, error } = await db().from("agent_playbooks").select("*").eq("agent_id", agentId).order("version", { ascending: false }).limit(30);
  if (error) throw new Error(`Playbooks: ${error.message}`);
  return (data ?? []).map(row);
}

export const activePlaybook = (all: Playbook[]) => all.find((p) => p.status === "approved") ?? null;
export const pendingPlaybook = (all: Playbook[]) => all.find((p) => p.status === "proposed") ?? null;

export interface Hold { agentId: string; reason: string; at: string }

/** Why the agent's next playbook must wait for Zak, or null when updates may apply on their own. */
export async function playbookHold(agentId: string): Promise<Hold | null> {
  const { data, error } = await db().from("agent_playbook_holds").select("agent_id, reason, at").eq("agent_id", agentId).maybeSingle();
  if (error) throw new Error(`Playbooks: ${error.message}`);
  return data ? { agentId: data.agent_id, reason: data.reason, at: data.at } : null;
}

async function setHold(agentId: string, reason: string) {
  const { error } = await db().from("agent_playbook_holds").upsert({ agent_id: agentId, reason: reason.slice(0, 300), at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function clearHold(agentId: string) {
  const { error } = await db().from("agent_playbook_holds").delete().eq("agent_id", agentId);
  if (error) throw new Error(error.message);
}

async function insertPlaybook(agentId: string, steps: PlaybookStep[], status: "proposed" | "approved", fromRun: string | null, changes: string, auto: boolean, all: Playbook[]) {
  const version = (all[0]?.version ?? 0) + 1;
  // one proposal at a time: a newer draft replaces an older one Zak hasn't decided
  const old = all.filter((p) => p.status === "proposed" || (status === "approved" && p.status === "approved")).map((p) => p.id);
  if (old.length) {
    const r = await db().from("agent_playbooks").update({ status: "replaced", decided_at: new Date().toISOString() }).in("id", old);
    if (r.error) throw new Error(r.error.message);
  }
  const { error } = await db().from("agent_playbooks").insert({
    agent_id: agentId, version, steps, status, from_run: fromRun, changes, auto,
    decided_at: status === "approved" ? new Date().toISOString() : null, decided_by: status === "approved" ? "auto" : null,
  });
  if (error) throw new Error(error.message);
  return version;
}

/**
 * After a run: hold the agent when a playbook run fell back or a run didn't finish, and draft a
 * playbook from what an explore run did. Returns one plain line for the run summary.
 */
export async function afterRun(agentId: string, runId: string | null, r: { steps: Step[]; finished: boolean; mode: RunMode; fellBack: string | null }): Promise<string> {
  const all = await listPlaybooks(agentId);
  const active = activePlaybook(all);
  if (r.mode === "fallback" && active) await setHold(agentId, `Playbook v${active.version} fell back to exploring: ${r.fellBack ?? "a step failed"}`);
  if (!r.finished) {
    if (active) await setHold(agentId, `A run didn't finish (${r.mode === "playbook" ? `following playbook v${active.version}` : "exploring"})`);
    return "No playbook drafted: the run didn't finish.";
  }
  if (r.mode === "playbook") return `Followed playbook v${active?.version ?? "?"}.`;
  const steps = draftSteps(r.steps);
  if (!steps.length) return "No playbook drafted: no tool call worked.";
  if (active && sameSteps(steps, active.steps)) return `Same steps as playbook v${active.version}.`;
  const pending = pendingPlaybook(all);
  if (pending && sameSteps(steps, pending.steps)) return `Same steps as playbook v${pending.version}, which waits for your approval.`;
  const changes = stepChanges(active?.steps ?? null, steps);
  const hold = active ? await playbookHold(agentId) : null;
  if (!active || hold) {
    const v = await insertPlaybook(agentId, steps, "proposed", runId, changes, false, all);
    return `Drafted playbook v${v} for your approval.`;
  }
  const v = await insertPlaybook(agentId, steps, "approved", runId, changes, true, all);
  return `Playbook updated to v${v} on its own. ${changes}`;
}

/** Zak approves a proposed playbook, keeping the steps he ticked. Clears the hold. */
export async function approvePlaybook(agentId: string, id: number, keep: number[]): Promise<number> {
  const all = await listPlaybooks(agentId);
  const p = all.find((x) => x.id === id);
  if (!p || p.status !== "proposed") throw new Error("That playbook isn't waiting for approval.");
  const steps = p.steps.filter((_, i) => keep.includes(i));
  if (!steps.length) throw new Error("Keep at least one step.");
  const active = activePlaybook(all);
  if (active) {
    const r = await db().from("agent_playbooks").update({ status: "replaced" }).eq("id", active.id);
    if (r.error) throw new Error(r.error.message);
  }
  const edited = steps.length !== p.steps.length;
  const { error } = await db().from("agent_playbooks").update({
    status: "approved", steps, decided_at: new Date().toISOString(), decided_by: "zak (control room)",
    changes: edited ? `${stepChanges(active?.steps ?? null, steps)} (You dropped ${p.steps.length - steps.length} step${p.steps.length - steps.length === 1 ? "" : "s"}.)` : p.changes,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  await clearHold(agentId);
  return p.version;
}

export async function rejectPlaybook(agentId: string, id: number): Promise<number> {
  const all = await listPlaybooks(agentId);
  const p = all.find((x) => x.id === id);
  if (!p || p.status !== "proposed") throw new Error("That playbook isn't waiting for approval.");
  const { error } = await db().from("agent_playbooks").update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: "zak (control room)" }).eq("id", id);
  if (error) throw new Error(error.message);
  return p.version;
}
