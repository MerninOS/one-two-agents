// Agent and run status in plain words, as the design names them.
import type { CrewMember } from "./crew";
import type { AgentRow, Run, RunStatus } from "./data";

/** True until Zak launches. Paused agents then read "Off duty until launch". */
export const PRE_LAUNCH = true;

export interface Look { label: string; dot: string; bg: string; fg: string; pulse?: boolean }

export const RUN_LOOK: Record<RunStatus, Look> = {
  running: { label: "Running", dot: "var(--acc)", bg: "var(--acc-soft)", fg: "var(--acc-ink)", pulse: true },
  ok: { label: "OK", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  skipped: { label: "Skipped", dot: "var(--mut2)", bg: "var(--soft)", fg: "var(--ink2)" },
  failed: { label: "Failed", dot: "var(--red)", bg: "var(--red-soft)", fg: "var(--red-ink)" },
};

export type AgentState = "planned" | "missing" | "running" | "paused" | "over" | "manual" | "active";

/** A run row stuck at "running" past the function limit (5 min) died without finishing. */
export const isLive = (r: Run, now = Date.now()) => r.status === "running" && now - Date.parse(r.started_at) < 6 * 6e4;

export function stateOf(a: CrewMember, row: AgentRow | undefined, runs: Run[], spent: number): AgentState {
  if (!a.built) return "planned";
  if (!row) return "missing";
  if (runs.some((r) => r.agent_id === a.id && isLive(r))) return "running";
  if (!row.enabled) return "paused";
  if (spent >= row.daily_budget_usd) return "over";
  if (!a.schedule || a.schedule.kind === "manual") return "manual";
  return "active";
}

export const STATE_LOOK: Record<AgentState, Look> = {
  planned: { label: "Joining after launch", dot: "var(--mut2)", bg: "var(--soft)", fg: "var(--mut)" },
  missing: { label: "Not in the database", dot: "var(--red)", bg: "var(--red-soft)", fg: "var(--red-ink)" },
  running: { label: "Working now", dot: "var(--acc)", bg: "var(--acc-soft)", fg: "var(--acc-ink)", pulse: true },
  paused: { label: PRE_LAUNCH ? "Off duty until launch" : "Off duty", dot: "var(--mut)", bg: "var(--soft)", fg: "var(--ink2)" },
  over: { label: "Budget reached today", dot: "var(--red)", bg: "var(--red-soft)", fg: "var(--red-ink)" },
  manual: { label: "On call", dot: "var(--ink2)", bg: "var(--soft)", fg: "var(--ink)" },
  active: { label: "On shift", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
};

/** One sentence on what the two switches add up to. */
export function combined(a: CrewMember, row: AgentRow | undefined) {
  const manual = !a.schedule || a.schedule.kind === "manual";
  if (!row?.enabled) return manual ? "Off duty: anything you start is skipped and logged at $0." : "Off duty: scheduled runs are skipped and logged at $0.";
  return manual ? "On call: runs only when you press Run." : "On the crew: runs on schedule (if the Vercel schedule is on) and whenever you press Run.";
}
