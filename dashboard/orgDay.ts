// The org's day on Crew > Schedule (docs/org-schedule.md, slice 2): every agent in the org, grouped by
// department as on the org chart, with when it runs, its next runs and what it costs a run and a
// month, all worked out in code. Pure: no database, so `npm run check:org-switch` tests it.
import type { Org } from "@/core/org-rules";
import type { CrewMember, Schedule } from "./crew";
import { runsInMonth } from "./orgPlan";
import { nextRuns, schedWords } from "./schedule";

/** Tools whose result reaches the owner: an agent with one is marked "reports to you" on the day. */
export const REPORTS_TO_OWNER = ["report_email_owner", "report_morning_brief"];

export interface DayRow {
  id: string;
  name: string;
  role: string;
  hue: string;
  icon: string;
  schedule: Schedule;
  when: string;
  /** Next scheduled runs (epoch ms), up to 4; empty by hand. */
  next: number[];
  perRun: number | null;
  perMonth: number;
  enabled: boolean;
  budget: number;
  reportsToYou: boolean;
  /** Where its time falls in the day's window, 0 to 1; null by hand. */
  at: number | null;
}

export interface OrgDay {
  groups: { name: string; rows: DayRow[] }[];
  rows: DayRow[];
  /** Hours shown, Central Time: from, to (to is exclusive), whole hours. */
  window: [number, number];
  totalMonth: number;
  scheduled: number;
  byHand: number;
  /** Scheduled agents with no cost known yet (no runs, no cap): not in the total. */
  unknownCost: string[];
  /** In the roster but left out of the org (test agents). */
  left: string[];
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function orgDay(o: {
  members: readonly CrewMember[];
  enabled: Record<string, boolean>;
  budget: Record<string, number>;
  grants: Record<string, string[]>;
  org: Org | null;
  now: number;
}): OrgDay {
  const inOrg = o.members.filter((m) => m.built && m.inOrg !== false);
  const base = inOrg.map((m) => {
    const schedule = m.schedule ?? { kind: "manual" as const };
    const perRun = m.avgCost ?? m.capPerRun ?? null;
    return {
      id: m.id, name: m.name, role: m.role, hue: m.hue ?? "#999", icon: m.icon,
      schedule, when: schedWords(schedule), next: nextRuns(schedule, o.now, 4),
      perRun, perMonth: perRun == null ? 0 : perRun * runsInMonth(schedule),
      enabled: !!o.enabled[m.id], budget: o.budget[m.id] ?? 0,
      reportsToYou: (o.grants[m.id] ?? []).some((t) => REPORTS_TO_OWNER.includes(t)),
    };
  });
  // the window: 4 AM to noon, stretched to an hour around the earliest and latest run
  const times = base.filter((r) => r.schedule.kind !== "manual" && r.schedule.time).map((r) => mins(r.schedule.time!));
  const from = Math.max(0, Math.min(4, ...times.map((t) => Math.floor(t / 60) - 1)));
  const to = Math.min(24, Math.max(12, ...times.map((t) => Math.floor(t / 60) + 2)));
  const rows: DayRow[] = base.map((r) => ({ ...r, at: r.schedule.kind !== "manual" && r.schedule.time ? (mins(r.schedule.time) - from * 60) / ((to - from) * 60) : null }));
  // in each group: scheduled by time, then by hand by name
  const order = (a: DayRow, b: DayRow) => (a.at ?? 2) - (b.at ?? 2) || a.name.localeCompare(b.name);
  const seatOf = (id: string) => o.org?.seats.find((s) => s.holder === "agent" && s.agentId === id) ?? null;
  const groups: OrgDay["groups"] = [];
  const top = rows.filter((r) => { const s = seatOf(r.id); return s != null && s.departmentId == null; }).sort(order);
  if (top.length) groups.push({ name: "Company", rows: top });
  for (const d of [...(o.org?.departments ?? [])].sort((a, b) => a.sort - b.sort)) {
    const g = rows.filter((r) => seatOf(r.id)?.departmentId === d.id).sort(order);
    if (g.length) groups.push({ name: d.name, rows: g });
  }
  const rest = rows.filter((r) => !seatOf(r.id)).sort(order);
  if (rest.length) groups.push({ name: "Not on the chart", rows: rest });
  const scheduled = rows.filter((r) => r.at != null);
  return {
    groups, rows, window: [from, to],
    totalMonth: rows.reduce((s, r) => s + r.perMonth, 0),
    scheduled: scheduled.length, byHand: rows.length - scheduled.length,
    unknownCost: scheduled.filter((r) => r.perRun == null).map((r) => r.name),
    left: o.members.filter((m) => m.built && m.inOrg === false).map((m) => m.name),
  };
}
