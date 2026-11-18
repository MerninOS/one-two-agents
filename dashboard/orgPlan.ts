// What turning on the org does, worked out in code before the owner confirms it (docs/org-schedule.md).
// Pure: no database, so `npm run check:org-switch` tests it and the confirm and the action agree.
import { DAY_RUNS, type Chain } from "@/core/flow-rules";
import type { Schedule } from "./crew";
import { scheduleOf } from "./roster";
import { nextRuns } from "./schedule";

export interface OrgMember {
  id: string;
  name: string;
  /** agents.in_org: false for a test agent that turning on the org never wakes. */
  inOrg: boolean;
  /** Average cost of its last real runs, or null before it has any. */
  avgCost: number | null;
  /** Its cap per run (live version), the cost to plan with before it has run. */
  capPerRun?: number;
}

export interface WakeLine {
  id: string;
  name: string;
  schedule: Schedule;
  /** The first scheduled run once the org is on; null when it runs only by hand. */
  firstRun: number | null;
  /** Cost a run: its average, or its cap before it has run; null when neither is known. */
  perRun: number | null;
  /** Cost a month on this schedule: per run times runs in 30 days. 0 by hand. */
  perMonth: number;
}

export interface OrgPlan {
  wake: WakeLine[];
  /** In the roster but never woken by the org (test agents). */
  left: { id: string; name: string }[];
  /** Chains to save on: every agent in them is in the org. */
  chainsOn: string[];
  /** The flow as it will be saved. */
  chains: Chain[];
  /** Sum of perMonth, in dollars. */
  totalMonth: number;
  /** Agents whose cost a run isn't known yet (no runs, no cap): left out of the total. */
  unknownCost: string[];
}

/** Runs in 30 days on a schedule (DAY_RUNS: 30 daily, 22 on weekdays, 4 on Mondays), none by hand. */
export const runsInMonth = (s: Schedule) => (s.kind === "manual" ? 0 : DAY_RUNS[s.kind] ?? 0);

export function planOrgOn(members: readonly OrgMember[], chains: readonly Chain[], now: number): OrgPlan {
  const inOrg = members.filter((m) => m.inOrg);
  const ids = new Set(inOrg.map((m) => m.id));
  // a chain comes on with the org only when every agent in it is in the org; one that is on stays on
  const next = chains.map((c) => (c.on || !c.steps.every((s) => ids.has(s.agent)) ? c : { ...c, on: true }));
  const chainsOn = next.filter((c, i) => c.on && !chains[i].on).map((c) => c.key);
  // the agent's schedule once those chains are on: only chains that are on count
  const live = next.filter((c) => c.on);
  const wake = inOrg.map((m): WakeLine => {
    const schedule = scheduleOf(m.id, live);
    const perRun = m.avgCost ?? m.capPerRun ?? null;
    return { id: m.id, name: m.name, schedule, firstRun: nextRuns(schedule, now, 1)[0] ?? null, perRun, perMonth: perRun == null ? 0 : perRun * runsInMonth(schedule) };
  });
  // scheduled first, in the order they run, then by hand
  wake.sort((a, b) => (a.firstRun ?? Infinity) - (b.firstRun ?? Infinity) || a.name.localeCompare(b.name));
  return {
    wake,
    left: members.filter((m) => !m.inOrg).map((m) => ({ id: m.id, name: m.name })),
    chainsOn,
    chains: next,
    totalMonth: wake.reduce((s, w) => s + w.perMonth, 0),
    unknownCost: wake.filter((w) => w.perRun == null && runsInMonth(w.schedule) > 0).map((w) => w.name),
  };
}
