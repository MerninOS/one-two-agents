import "server-only";
// Teach by reacting (docs/company-mode.md, slice 1). The owner's Good or Not this on an agent's work.
// The rules for what a reaction saves are pure and live in core/reaction-rules.ts.
//
// A reaction never decides what an agent may do: a rule it saves is a memory line (a note, never
// authority), and the reaction row is a signal for the scorecard and the head that reads the team.
import { db } from "@/core/db";
import { agentDepartment } from "@/core/org";
import { addDepartmentRule, forgetMemory, teach } from "@/core/memory";
import { canReplace, planReaction, savedWords, tally, type ReactionInput, type Tally, type Verdict } from "@/core/reaction-rules";

export interface ReactTarget { runId?: string | null; approvalId?: string | null; itemId?: string | null; itemLabel?: string | null }
export interface Reaction { id: string; agent_id: string; run_id: string | null; approval_id: string | null; item_id: string | null; item_label: string | null; verdict: Verdict; text: string | null; memory_id: string | null; created_at: string }

const deptOf = async (agentId: string) => { try { return (await agentDepartment(agentId))?.dept ?? null; } catch { return null; } };

/**
 * Saves one rule in the owner's words as a memory line: the agent's own (a standing order, or a note for
 * the next run or 30 days), its department's, or the whole crew's. Used by reactions and by Avery's
 * chat (core/avery-chat.ts). Returns the memory line's id.
 */
export async function saveRule(r: { scope: "agent" | "department" | "crew"; agentId: string; deptId: string | null; keep: "next_run" | "days_30" | "always"; text: string; tag: string }): Promise<string> {
  if (r.scope === "department") {
    if (!r.deptId) throw new Error("That agent isn't in a department.");
    return addDepartmentRule(r.deptId, r.text, r.tag);
  }
  const keep = r.scope === "agent" ? r.keep : "always";
  return teach({ agentId: r.agentId, text: r.text, keepAs: r.scope === "crew" ? "crew" : keep === "always" ? "standing_order" : "note", forget: keep, sourceTag: r.tag });
}

/**
 * Saves a reaction: the rule first (so a failed save never loses the old rule), then forgets the
 * rule it replaces, then records the reaction itself (one per thing reacted to). Returns what to
 * tell the owner. The caller has checked the login and that the target belongs to this agent.
 */
export async function saveReaction(agentId: string, name: string, target: ReactTarget, input: ReactionInput): Promise<string> {
  if (!target.runId && !target.approvalId) throw new Error("React to a run or an approval.");
  const dept = await deptOf(agentId);
  const got = planReaction(input, { hasDept: !!dept });
  if ("error" in got) throw new Error(got.error);
  const p = got.plan;
  const tag = target.approvalId ? `approval:${target.approvalId}` : `run:${target.runId}`;

  let memoryId: string | null = null;
  if (p.rule) {
    const r = p.rule;
    let old: { state: string; grp: string; agent_id: string | null; department_id: string | null } | null = null;
    if (r.replaces) {
      const { data } = await db().from("agent_memory").select("state, grp, agent_id, department_id").eq("id", r.replaces).maybeSingle();
      if (!data || !canReplace(data, r, agentId, dept?.id ?? null)) throw new Error("That rule can't be replaced from here: it isn't one of the rules for who you picked.");
      old = data;
    }
    memoryId = await saveRule({ scope: r.scope, agentId, deptId: dept?.id ?? null, keep: r.keep, text: r.text, tag });
    if (old && r.replaces) await forgetMemory(r.replaces);
  }

  const row = {
    agent_id: agentId, run_id: target.runId ?? null, approval_id: target.approvalId ?? null,
    item_id: target.itemId ?? null, item_label: target.itemLabel ? target.itemLabel.slice(0, 120) : null,
    verdict: p.verdict, text: p.rule ? p.text : null, memory_id: memoryId, updated_at: new Date().toISOString(),
  };
  // one reaction per thing reacted to: reacting again changes it (the rule it saved stays until forgotten)
  const said = savedWords(p, name, dept?.name ?? null);
  try {
    let q = db().from("reactions").select("id").eq("agent_id", agentId);
    q = target.approvalId ? q.eq("approval_id", target.approvalId) : q.eq("run_id", target.runId!);
    q = target.itemId ? q.eq("item_id", target.itemId) : q.is("item_id", null);
    const { data: prev, error: readErr } = await q.maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const { error } = prev
      ? await db().from("reactions").update(row).eq("id", prev.id)
      : await db().from("reactions").insert(row);
    if (error) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const why = /reactions/.test(msg) ? "the reactions table isn’t in Supabase yet (apply the migration in the PR)" : msg;
    // the rule is already saved, so say so rather than fail
    if (memoryId) return `${said} (It won’t show on the scorecard: ${why}.)`;
    throw new Error(`Couldn’t record that: ${why}.`);
  }
  return said;
}

/** The owner's reactions on one run, keyed by item id ("" for the run itself). Empty when the table isn't there. */
export async function reactionsOnRun(runId: string): Promise<Record<string, Reaction>> {
  const { data, error } = await db().from("reactions").select("*").eq("run_id", runId).limit(200);
  if (error) return {};
  return Object.fromEntries(((data ?? []) as Reaction[]).map((r) => [r.item_id ?? "", r]));
}

/** An agent's latest reactions, newest first. Empty when the table isn't there. */
export async function reactionsOf(agentId: string, limit = 8): Promise<Reaction[]> {
  const { data, error } = await db().from("reactions").select("*").eq("agent_id", agentId).order("updated_at", { ascending: false }).limit(limit);
  return error ? [] : (data ?? []) as Reaction[];
}

/** Good and Not this per agent since a time, with his latest words. Empty when the table isn't there. */
export async function reactionTally(agentIds: string[], sinceIso: string): Promise<Record<string, Tally>> {
  if (!agentIds.length) return {};
  const { data, error } = await db().from("reactions").select("agent_id, verdict, text").in("agent_id", agentIds).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(1000);
  return error ? {} : tally(data ?? []);
}
