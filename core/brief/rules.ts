// The morning brief's own rules (docs/morning-brief.md): reading the focus and watch list from the
// run's result, and the fixed rules that write them when the result has none or no model could be
// reached. Pure, so check:brief can test them. Every number they use was worked out in code.
import type { OpenCounts } from "./email";

export interface Judgment { watch: string[]; focus: { action: string; reason: string } }

/** A goal that's behind or missed its date, as the brief's facts carry it. */
export interface GoalBehind { title: string; line: string; status: "behind" | "missed" }

/** What the fixed rules look at: goals that are behind, open orders, failed runs. */
export interface RuleFacts {
  behind: GoalBehind[];
  openOrders: OpenCounts | null;
  agentRuns: { agent_id: string; status: string; error: string | null }[];
  names?: Record<string, string>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The focus and watch list from fixed rules: the goal furthest behind first, then orders waiting to ship. */
export function rulesJudgment(f: RuleFacts): Judgment {
  // a missed date first, then goals behind, in the order the owner set them
  const goals = [...f.behind].sort((a, b) => (a.status === b.status ? 0 : a.status === "missed" ? -1 : 1));
  const o = f.openOrders;
  const watch = [
    ...goals.map((g) => `${g.title} is ${g.status === "missed" ? "past its date" : "behind"}: ${g.line}.`),
    ...(o?.onHold.length ? [`${plural(o.onHold.length, "order")} on hold: ${o.onHold.join(", ")}.`] : []),
    ...f.agentRuns.filter((r) => r.status === "failed").map((r) => `${f.names?.[r.agent_id] ?? r.agent_id}'s run failed: ${r.error ?? "no error recorded"}.`),
  ].slice(0, 5);
  const waiting = (o?.unfulfilled ?? 0) + (o?.partial ?? 0);
  const focus = goals.length
    ? { action: `Get ${goals[0].title} back on track`, reason: `${goals[0].line}.` }
    : waiting
      ? { action: `Ship the ${plural(waiting, "open order")}`, reason: "They're waiting to go out." }
      : { action: "Pick one thing that grows the business", reason: "No goal is behind and no order is waiting." };
  return { watch, focus };
}

/**
 * The focus and watch list from a run's result: a line starting "Focus:" and up to five lines
 * starting "- ". Null when there is no Focus line.
 */
export function parseJudgment(text: string): Judgment | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const f = lines.find((l) => /^focus\s*:/i.test(l));
  if (!f) return null;
  const body = f.replace(/^focus\s*:\s*/i, "");
  const cut = body.search(/\.\s/);
  const focus = cut > 0 ? { action: body.slice(0, cut), reason: body.slice(cut + 1).trim() } : { action: body.replace(/\.$/, ""), reason: "" };
  const watch = lines.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, "").slice(0, 300)).slice(0, 5);
  return focus.action ? { watch, focus } : null;
}

/** Open orders by Shopify's fulfillment status: shipped and restocked ones don't count; on-hold ones are listed by number. */
export function openCounts(orders: readonly { name: string; displayFulfillmentStatus: string }[]): OpenCounts {
  const out: OpenCounts = { unfulfilled: 0, partial: 0, onHold: [] };
  for (const o of orders) {
    const s = o.displayFulfillmentStatus;
    if (s === "FULFILLED" || s === "RESTOCKED") continue;
    if (s === "ON_HOLD") out.onHold.push(o.name);
    else if (s === "PARTIALLY_FULFILLED") out.partial++;
    else out.unfulfilled++;
  }
  return out;
}
