// Teach by reacting (docs/company-mode.md, slice 1): the rules for what a reaction saves.
// Pure: no database, no network, tested by `npm run check:reactions`.
//
// A reaction is the owner's Good or Not this on an agent's work. Good saves nothing but the signal.
// Not this with words saves a rule in their words straight away (owner's call, Nov 15: their own words don't wait
// for a Keep). Like every memory line, a rule is a note: it can add a do or don't, never raise a cap,
// add a recipient or grant access.

export type Verdict = "good" | "not";
/** Who follows the rule: the agent, everyone in its department, or the whole crew. */
export type Scope = "agent" | "department" | "crew";
export type ReactKeep = "next_run" | "days_30" | "always";
export type RuleGroup = "standing_order" | "note" | "department" | "crew";

export const MAX_REACTION = 280;
export const VERDICTS: readonly Verdict[] = ["good", "not"];
export const SCOPES: readonly Scope[] = ["agent", "department", "crew"];
export const REACT_KEEPS: readonly ReactKeep[] = ["always", "days_30", "next_run"];

export interface ReactionInput { verdict: string; text?: string | null; scope?: string | null; keep?: string | null; replaces?: string | null }
export interface RulePlan { scope: Scope; grp: RuleGroup; keep: ReactKeep; text: string; replaces: string | null }
export interface ReactionPlan { verdict: Verdict; text: string | null; rule: RulePlan | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a reaction saves, or why it can't be saved. `hasDept` says whether the agent sits in a
 * department (a department rule needs one). A rule for a department or the crew is always kept
 * until the owner forgets it; only the agent's own rule can be for the next run or 30 days.
 */
export function planReaction(i: ReactionInput, ctx: { hasDept: boolean }): { plan: ReactionPlan } | { error: string } {
  if (!VERDICTS.includes(i.verdict as Verdict)) return { error: "Pick Good or Not this." };
  const verdict = i.verdict as Verdict;
  const text = String(i.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length > MAX_REACTION) return { error: `Keep it to ${MAX_REACTION} characters (this is ${text.length}).` };
  if (verdict === "good" || !text) return { plan: { verdict, text: null, rule: null } };
  const scope = (i.scope ?? "agent") as Scope;
  if (!SCOPES.includes(scope)) return { error: "Pick who should follow it." };
  if (scope === "department" && !ctx.hasDept) return { error: "This agent isn't in a department, so pick it alone or everyone." };
  const asked = (i.keep ?? "always") as ReactKeep;
  if (!REACT_KEEPS.includes(asked)) return { error: "Pick how long to keep it." };
  const keep: ReactKeep = scope === "agent" ? asked : "always";
  const replaces = i.replaces ? String(i.replaces) : null;
  if (replaces && !UUID.test(replaces)) return { error: "That rule to replace isn't one of its rules." };
  const grp: RuleGroup = scope === "department" ? "department" : scope === "crew" ? "crew" : keep === "always" ? "standing_order" : "note";
  return { plan: { verdict, text, rule: { scope, grp, keep, text, replaces } } };
}

/** The memory line a rule may replace must be kept and belong to the same scope. */
export function canReplace(row: { state: string; grp: string; agent_id: string | null; department_id: string | null }, rule: RulePlan, agentId: string, deptId: string | null): boolean {
  if (row.state !== "kept") return false;
  if (rule.scope === "crew") return row.grp === "crew" && row.agent_id === null;
  if (rule.scope === "department") return row.grp === "department" && !!deptId && row.department_id === deptId;
  return row.agent_id === agentId && (row.grp === "standing_order" || row.grp === "note" || row.grp === "lesson");
}

export interface Tally { good: number; not: number; said: string[] }

/** Good and Not this per agent, newest words first (at most 3), counted in code. Rows newest first. */
export function tally(rows: { agent_id: string; verdict: string; text: string | null }[]): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const r of rows) {
    const t = (out[r.agent_id] ??= { good: 0, not: 0, said: [] });
    if (r.verdict === "good") t.good += 1;
    else if (r.verdict === "not") {
      t.not += 1;
      if (r.text && t.said.length < 3) t.said.push(r.text);
    }
  }
  return out;
}

/** "4 good · 2 not this", or null when there is nothing to show. */
export function tallyWords(t: Tally | undefined): string | null {
  if (!t || (!t.good && !t.not)) return null;
  return `${t.good} good · ${t.not} not this`;
}

/** What the toast says after a save, in plain words. */
export function savedWords(p: ReactionPlan, name: string, deptName: string | null): string {
  if (p.verdict === "good") return `Noted. It counts on ${name}’s scorecard, and whoever ${name} reports to sees it.`;
  if (!p.rule) return `Noted as not this. Add words next time and ${name} learns from it.`;
  const who = p.rule.scope === "crew" ? "Every agent follows it" : p.rule.scope === "department" ? `Everyone in ${deptName ?? "the department"} follows it` : `${name} follows it`;
  const when = p.rule.keep === "next_run" ? " on the next run, then forgets it" : p.rule.keep === "days_30" ? " for 30 days" : " from the next run";
  return `Saved in your words. ${who}${when}.${p.rule.replaces ? " The old rule is forgotten." : ""} Undo on the Memory tab.`;
}
