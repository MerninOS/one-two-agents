// The crew as the Control Room shows it, built from data (docs/agent-roster.md): each agent's row in
// `agents` (role, avatar, since, by hand only), its live saved version (name, job, tools, cost cap),
// its recent runs (what a run costs), its seat on the org chart (its role when the row has none) and
// Crew > Schedule (when it runs). No agent is written in code; the planned seats that have no agent
// yet come from the org's template pack (core/install.ts plannedSeats). Pure: no database, so `npm run check:roster` can test it.
import type { CrewMember, Schedule, Tier } from "./crew";
import type { Chain } from "@/core/flow-rules";

export interface RosterRow { id: string; name: string; role?: string | null; icon?: string | null; hue?: string | null; manual_only?: boolean | null; in_org?: boolean | null; created_at?: string | null }
export interface RosterSpec { name?: string; mandate?: string; goodResult?: string; tools: string[]; maxCostUsd?: number }
export interface RosterTool { label: string; kind: string }

/** Avatar colours for an agent whose row has none, picked from its id so it never changes. */
export const HUES = ["#F2884B", "#6CC69A", "#F5D35C", "#F6B8C9", "#8FB8F2", "#C9A27A", "#B9A3F0", "#7FD1C7"] as const;
export const hueFor = (id: string) => HUES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

/** "About $0.003", "About $0.25", "$0", or the cap per run before it has run. */
export function costLabel(avg: number | null, cap: number | undefined): string {
  if (avg == null) return cap ? `Up to $${cap.toFixed(2)}` : "Unknown";
  if (avg === 0) return "$0";
  return `About $${avg < 0.01 ? avg.toFixed(3) : avg.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 29", in Chicago. */
export function sinceLabel(at: string | null | undefined): string | undefined {
  if (!at || Number.isNaN(Date.parse(at))) return undefined;
  const d = new Date(Date.parse(at) - 6 * 36e5);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** When an agent runs on its own: the first chain with a schedule it is a step of (one that is on first). */
export function scheduleOf(id: string, chains: readonly Chain[]): Schedule {
  const withIt = chains.filter((c) => c.start.type === "schedule" && c.steps.some((s) => s.agent === id));
  const c = withIt.find((x) => x.on) ?? withIt[0];
  if (!c || c.start.type !== "schedule") return { kind: "manual" };
  const step = c.steps.find((s) => s.agent === id)!;
  return { kind: step.days ?? c.start.days, time: step.notBefore ?? c.start.time, chain: c.name };
}

/**
 * One agent as the Control Room shows it. `role` falls back to its seat's title, then to "Built in
 * the app"; the tier is Draft when its live version has an action (an approval card), else Report.
 */
export function memberOf(row: RosterRow, spec: RosterSpec | null, o: { tools: Record<string, RosterTool>; avgCost: number | null; seatTitle: string | null; chains: readonly Chain[] }): CrewMember {
  const tools = (spec?.tools ?? []).map((t) => o.tools[t]).filter(Boolean);
  const tier: Tier = tools.some((t) => t.kind === "action") ? "Draft" : "Report";
  const hands = tools.filter((t) => t.kind === "report").map((t) => t.label);
  const job = spec?.mandate?.trim() || "No job line yet";
  return {
    id: row.id,
    name: spec?.name?.trim() || row.name,
    role: row.role?.trim() || o.seatTitle || "Built in the app",
    icon: row.icon || "cpu",
    hue: row.hue || hueFor(row.id),
    tier, mandate: job, job, built: !!spec,
    since: sinceLabel(row.created_at),
    estCostLabel: costLabel(o.avgCost, spec?.maxCostUsd),
    writes: hands.length ? hands.join(", ") : "its result, saved for other agents to read",
    schedule: scheduleOf(row.id, o.chains),
    manualOnly: row.manual_only !== false,
    inOrg: row.in_org !== false,
    avgCost: o.avgCost,
    capPerRun: spec?.maxCostUsd,
  };
}

/** Every agent with a live version (in the order given: oldest first), then the planned seats that no agent with the same id has taken. */
export function buildCrew(members: CrewMember[], plannedSeats: readonly CrewMember[] = []): { crew: CrewMember[]; built: CrewMember[]; planned: CrewMember[]; byId: Record<string, CrewMember> } {
  const built = members.filter((m) => m.built);
  const ids = new Set(built.map((m) => m.id));
  const planned = plannedSeats.filter((p) => !ids.has(p.id));
  const crew = [...built, ...planned];
  return { crew, built, planned, byId: Object.fromEntries(crew.map((m) => [m.id, m])) };
}

/** Average cost of an agent's last real runs (finished, not a try), or null when it has none. */
export function avgCostOf(runs: readonly { agent_id: string; status: string; trigger: string; cost_usd: number }[], id: string, n = 10): number | null {
  const real = runs.filter((r) => r.agent_id === id && r.status === "ok" && r.trigger !== "preview").slice(0, n);
  return real.length ? real.reduce((s, r) => s + r.cost_usd, 0) / real.length : null;
}
