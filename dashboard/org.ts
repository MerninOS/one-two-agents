import "server-only";
// The org chart as Crew draws it (docs/org-chart.md): each seat with who sits there, that agent's
// state and last run, and the agents that aren't on the chart yet. Plain data for
// components/OrgChart.tsx.
import { loadCaps } from "@/core/gateway";
import { CAPS } from "@/core/gateway/policy";
import { departmentRules } from "@/core/memory";
import { agentNames, companySeat, deptSpent, headOf, childrenOf, liveAgentIds, monthSpendByAgent, orgProblems, reportsTo, seatOf, seatPath, seatTeam, seatToolBlocks, type Org, type Seat } from "@/core/org";
import type { MapOrg } from "./agentMap";
import type { BuiltRow } from "./builder";
import { BY_ID, CREW } from "./crew";
import type { Floor } from "./data";
import { when } from "./format";
import { STATE_LOOK, stateOf, type Look } from "./status";

export interface SeatAgent {
  id: string;
  name: string;
  role: string;
  href: string;
  icon: string;
  hue: string | null;
  planned: boolean;
  look: Look;
  last: string;
}
export interface SeatView {
  id: string;
  title: string;
  sub: string;
  holder: Seat["holder"];
  agent: SeatAgent | null;
  /** Seats under this one, in order. */
  kids: SeatView[];
}
export interface DeptView {
  id: string; name: string; head: SeatView; seats: number; filled: number; planned: number; open: number;
  /** Monthly AI budget (null: none) and what its agents spent this Chicago month, added up in code. */
  budget: number | null; spent: number;
  /** Its email cap (null: the company cap) and the company cap it sits under. */
  emails: number | null; companyEmails: number;
  /** Department rules, loaded by every agent seated in it. */
  rules: { id: string; text: string }[];
  /** Drafts from its agents wait for the agent above them first (slice 4). */
  leadChecks: boolean;
}
/** What the department cards need besides the chart: spend this month per agent, department rules, the company email cap. */
export interface DeptExtras { spend: Record<string, number>; rules: { id: string; departmentId: string; text: string }[]; companyEmails: number }
export interface OrgView {
  company: SeatView | null;
  departments: DeptView[];
  /** Agents not in any seat: they can be put in one with Edit chart, or from step 1 of the builder. */
  offChart: SeatAgent[];
  /** Every agent a seat can hold, for the picker. */
  choices: { id: string; label: string; seat: string | null }[];
  problems: string[];
}

const OFF_LOOK: Look = { label: "Off duty", dot: "var(--mut)", bg: "var(--soft)", fg: "var(--ink2)" };
const ON_LOOK: Look = { label: "On duty", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" };

/** Every agent the chart knows: the crew in code (built and planned), then agents built in the app. */
function agentsOf(f: Floor, built: BuiltRow[]): SeatAgent[] {
  const crew = CREW.map((a): SeatAgent => {
    const st = stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0);
    const last = f.runs.find((r) => r.agent_id === a.id && r.status !== "skipped");
    return { id: a.id, name: a.name, role: a.role, href: `/agents/${a.id}`, icon: a.icon, hue: a.built ? a.hue ?? null : null, planned: !a.built, look: STATE_LOOK[st], last: !a.built ? `Phase ${a.phase}` : last ? `Last ran ${when(last.started_at)}` : "Never run" };
  });
  const own = built.filter((b) => !BY_ID[b.id]).map((b): SeatAgent => ({
    id: b.id, name: b.name, role: b.mandate || "Built in the app", href: `/build/${b.id}`, icon: "cpu", hue: null, planned: false,
    look: b.enabled ? ON_LOOK : OFF_LOOK, last: b.lastRun ? `Last ran ${when(b.lastRun.at)}` : "Never run",
  }));
  return [...crew, ...own];
}

export function orgView(f: Floor, org: Org, built: BuiltRow[], x: DeptExtras): OrgView {
  const all = agentsOf(f, built);
  const byId = new Map(all.map((a) => [a.id, a]));
  const view = (s: Seat, depth: number): SeatView => ({
    id: s.id, title: s.title, sub: s.sub, holder: s.holder,
    agent: s.holder === "agent" && s.agentId ? byId.get(s.agentId) ?? { id: s.agentId, name: s.agentId, role: "Not found", href: "/crew", icon: "cpu", hue: null, planned: false, look: OFF_LOOK, last: "" } : null,
    kids: depth > 6 ? [] : childrenOf(org, s.id).map((c) => view(c, depth + 1)),
  });
  const count = (v: SeatView): SeatView[] => [v, ...v.kids.flatMap(count)];
  const departments = org.departments.flatMap((d): DeptView[] => {
    const h = headOf(org, d.id);
    if (!h) return [];
    const head = view(h, 1);
    const seats = count(head);
    return [{
      id: d.id, name: d.name, head, seats: seats.length, filled: seats.filter((s) => s.holder !== "open" && !s.agent?.planned).length, planned: seats.filter((s) => s.agent?.planned).length, open: seats.filter((s) => s.holder === "open").length,
      budget: d.monthlyBudgetUsd, spent: deptSpent(org, d.id, x.spend), emails: d.maxEmailsPerDay, companyEmails: x.companyEmails,
      rules: x.rules.filter((r) => r.departmentId === d.id).map((r) => ({ id: r.id, text: r.text })),
      leadChecks: d.leadChecksDrafts,
    }];
  });
  const top = companySeat(org);
  return {
    company: top ? view(top, 0) : null,
    departments,
    offChart: all.filter((a) => !seatOf(org, a.id)),
    choices: all.map((a) => { const s = seatOf(org, a.id); return { id: a.id, label: `${a.name}${a.planned ? " (planned)" : ""}`, seat: s ? seatPath(org, s) : null }; }),
    problems: orgProblems(org),
  };
}

/** For the builder's step 1: every seat as a path, and whether it's free for this agent. */
export function seatChoices(org: Org, agentId: string | null): { id: string; label: string; free: boolean }[] {
  return org.seats
    .filter((s) => s.departmentId != null || s.holder === "open" || s.agentId === agentId)
    .map((s) => ({ id: s.id, label: seatPath(org, s), free: s.holder === "open" || (s.holder === "agent" && s.agentId === agentId) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Spend this month, department rules and the company email cap for the department cards. Each part reads as empty when it can't be loaded. */
export async function deptExtras(org: Org): Promise<DeptExtras> {
  const ids = [...new Set(org.seats.filter((s) => s.holder === "agent" && s.agentId && s.departmentId).map((s) => s.agentId as string))];
  const [spend, rules, caps] = await Promise.all([
    monthSpendByAgent(ids).catch(() => ({} as Record<string, number>)),
    departmentRules(org.departments.map((d) => d.id)),
    loadCaps().catch(() => null),
  ]);
  return {
    spend,
    rules: rules.map((r) => ({ id: r.id, departmentId: r.department_id as string, text: r.text })),
    companyEmails: caps?.max_emails_per_day.value ?? CAPS.max_emails_per_day.start,
  };
}

/** For the builder's step 2: why Your team and Department reports are off, for each seat and for no seat (""). Empty before the org chart migration. */
export async function seatToolChoices(org: Org | null): Promise<Record<string, { team: string | null; company: string | null }>> {
  if (!org) return {};
  const live = await liveAgentIds().catch(() => new Set<string>());
  const out: Record<string, { team: string | null; company: string | null }> = { "": seatToolBlocks(org, null, live) };
  for (const s of org.seats) out[s.id] = seatToolBlocks(org, s.id, live);
  return out;
}

/** An agent's place for its map: who its result goes up to, and the live agents under it. Null before the org chart migration. */
export async function mapOrgOf(org: Org | null, agentId: string): Promise<MapOrg | null> {
  if (!org) return null;
  const seat = seatOf(org, agentId);
  if (!seat) return { reportsTo: null, team: [] };
  const live = await liveAgentIds().catch(() => new Set<string>());
  const team = seatTeam(org, seat, live).agents;
  const up = reportsTo(org, seat);
  const names = await agentNames([...team, ...(up?.agentId ? [up.agentId] : [])]).catch(() => ({} as Record<string, string>));
  const name = (id: string) => names[id] ?? BY_ID[id]?.name ?? id;
  const box: MapOrg["reportsTo"] = !up
    ? { title: "Zak", sub: "The company seat reports to you, in the morning brief", agentId: null, open: false }
    : up.holder === "agent" && up.agentId ? { title: name(up.agentId), sub: seatPath(org, up), agentId: up.agentId, open: false }
    : up.holder === "zak" ? { title: "Zak", sub: seatPath(org, up), agentId: null, open: false }
    : { title: up.title, sub: "No one sits here yet, so its result waits", agentId: null, open: true };
  return { reportsTo: box, team: team.map((id) => ({ id, name: name(id) })) };
}
