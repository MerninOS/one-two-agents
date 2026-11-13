// The org chart's rules (docs/org-chart.md), with no database access so the chart and the builder
// can use them in the browser; core/org.ts adds loading and saving.
//
// A department holds seats. Each department has one head seat (no parent); every other seat sits
// under a seat in the same department. One company seat (Avery's) sits above every head. A seat
// is held by an agent, by Zak, or nobody yet. Where an agent sits gives it nothing: what it can
// read or do is still its saved setup, checked in code.

export const MAX_DEPARTMENTS = 12;
export const MAX_SEATS = 80;
/** A head is depth 1, a seat under it 2, and so on. */
export const MAX_DEPTH = 4;

export type Holder = "open" | "zak" | "agent";

export interface Department {
  id: string;
  name: string;
  sort: number;
  /** AI spend of the agents seated here per Chicago calendar month; null for no department budget. */
  monthlyBudgetUsd: number | null;
  /** Outbound emails a day from the agents seated here; null for the company cap alone. */
  maxEmailsPerDay: number | null;
}
export interface Seat {
  id: string;
  /** Null for the company seat. */
  departmentId: string | null;
  /** Null for a head and for the company seat. */
  parentId: string | null;
  title: string;
  sub: string;
  holder: Holder;
  agentId: string | null;
  sort: number;
}
export interface Org { departments: Department[]; seats: Seat[] }

export const EMPTY_ORG: Org = { departments: [], seats: [] };

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;

export const companySeat = (o: Org) => o.seats.find((s) => s.departmentId == null) ?? null;
export const headOf = (o: Org, deptId: string) => o.seats.find((s) => s.departmentId === deptId && s.parentId == null) ?? null;
export const childrenOf = (o: Org, seatId: string) => o.seats.filter((s) => s.parentId === seatId).sort(bySort);
export const seatOf = (o: Org, agentId: string) => o.seats.find((s) => s.holder === "agent" && s.agentId === agentId) ?? null;

/** How deep a seat sits: a head is 1. The company seat is 0. */
export function depthOf(o: Org, seat: Seat): number {
  if (seat.departmentId == null) return 0;
  let d = 1, cur = seat;
  for (let i = 0; i < MAX_SEATS && cur.parentId; i++) {
    const up = o.seats.find((s) => s.id === cur.parentId);
    if (!up) break;
    cur = up; d++;
  }
  return d;
}

/** Every seat under this one, at any depth. */
export function below(o: Org, seatId: string): Seat[] {
  const out: Seat[] = [];
  const walk = (id: string, n: number) => { if (n > MAX_DEPTH) return; for (const c of childrenOf(o, id)) { out.push(c); walk(c.id, n + 1); } };
  walk(seatId, 1);
  return out;
}

/** The seat a seat reports to: its parent, or for a head the company seat. */
export function reportsTo(o: Org, seat: Seat): Seat | null {
  if (seat.departmentId == null) return null;
  if (seat.parentId) return o.seats.find((s) => s.id === seat.parentId) ?? null;
  return companySeat(o);
}

/** "Marketing › Retention lead › Subscriptions": where a seat sits, in words. */
export function seatPath(o: Org, seat: Seat): string {
  if (seat.departmentId == null) return seat.title;
  const dept = o.departments.find((d) => d.id === seat.departmentId)?.name ?? seat.departmentId;
  const chain: string[] = [];
  let cur: Seat | undefined = seat;
  for (let i = 0; i < MAX_SEATS && cur; i++) { chain.unshift(cur.title); cur = cur.parentId ? o.seats.find((s) => s.id === cur!.parentId) : undefined; }
  return [dept, ...chain].join(" › ");
}

/** A department id from its name: "Customer care" → "customer_care". */
export function deptSlug(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(s) && s.length >= 2 ? s : `d_${s}`.slice(0, 40);
}

export const cleanTitle = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
export const cleanSub = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

/** Anything wrong with a chart as read from the database, in words. The chart still shows. */
export function orgProblems(o: Org): string[] {
  const out: string[] = [];
  const ids = new Set(o.seats.map((s) => s.id));
  for (const s of o.seats) {
    if (s.parentId && !ids.has(s.parentId)) out.push(`“${s.title}” sits under a seat that isn’t there.`);
    const p = s.parentId ? o.seats.find((x) => x.id === s.parentId) : null;
    if (p && p.departmentId !== s.departmentId) out.push(`“${s.title}” sits under a seat in another department.`);
    if (depthOf(o, s) > MAX_DEPTH) out.push(`“${s.title}” sits deeper than ${MAX_DEPTH} levels.`);
  }
  for (const d of o.departments) if (!headOf(o, d.id)) out.push(`${d.name} has no head seat.`);
  return out;
}

// ---- Department limits (slice 2). A department can only be stricter than the company: its budget
// sits on top of each agent's daily budget, and its email cap is held at or under the company's.

/** The most a department's monthly AI budget may be. The migration holds the same ceiling. */
export const DEPT_BUDGET_CEILING = 500;

/** Agents seated in a department, at any depth. */
export const agentsIn = (o: Org, deptId: string) => o.seats.filter((s) => s.departmentId === deptId && s.holder === "agent" && s.agentId).map((s) => s.agentId as string);

/** The department an agent sits in, or null (off the chart, or the company seat). */
export const deptOf = (o: Org, agentId: string) => {
  const s = seatOf(o, agentId);
  return s?.departmentId ? o.departments.find((d) => d.id === s.departmentId) ?? null : null;
};

/** What a department's agents spent this month, added up in cents in code, back in dollars. */
export function deptSpent(o: Org, deptId: string, spentByAgent: Record<string, number>): number {
  const cents = agentsIn(o, deptId).reduce((sum, id) => sum + Math.round((spentByAgent[id] ?? 0) * 100), 0);
  return cents / 100;
}

/** Why a department may not spend more this month, or null. */
export function deptBudgetBlock(d: Department, spentUsd: number): string | null {
  if (d.monthlyBudgetUsd == null) return null;
  if (Math.round(spentUsd * 100) < Math.round(d.monthlyBudgetUsd * 100)) return null;
  return `${d.name}’s monthly budget of $${d.monthlyBudgetUsd.toFixed(2)} is used up ($${spentUsd.toFixed(2)} spent this month).`;
}

/**
 * Why a new department budget can't be saved, or whether it is looser (needs Controls on and a
 * confirm). Null means no department budget, the loosest.
 */
export function deptBudgetChange(now: number | null, next: number | null): { refuse: string } | { looser: boolean } {
  if (next !== null) {
    if (!Number.isFinite(next) || next < 0) return { refuse: "Pick an amount of $0 or more, or leave it blank for no department budget." };
    if (Math.abs(Math.round(next * 100) - next * 100) > 1e-6) return { refuse: "Whole cents only." };
    if (next > DEPT_BUDGET_CEILING) return { refuse: `A department budget can’t go above $${DEPT_BUDGET_CEILING} a month. That ceiling is in code (core/org-rules.ts).` };
  }
  if (next === now) return { refuse: "That is already the budget." };
  return { looser: next === null || (now !== null && next > now) };
}

/** The same for a department's email cap, which may never pass the company cap. */
export function deptEmailChange(now: number | null, next: number | null, companyCap: number): { refuse: string } | { looser: boolean } {
  if (next !== null) {
    if (!Number.isInteger(next) || next < 0) return { refuse: "Pick a whole number of emails, or leave it blank to use the company cap." };
    if (next > companyCap) return { refuse: `A department can’t send more than the company cap of ${companyCap} a day. Change that in Settings first.` };
  }
  if (next === now) return { refuse: "That is already the cap." };
  return { looser: next === null || (now !== null && next > now) };
}

/** A department's email cap as enforced: never above the company cap, whatever the row says. */
export const deptEmailCap = (d: Department, companyCap: number) => (d.maxEmailsPerDay == null ? companyCap : Math.max(0, Math.min(companyCap, d.maxEmailsPerDay)));
