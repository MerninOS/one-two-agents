// What installing a template pack's crew into an org writes (core/install.ts, docs/templates.md),
// worked out in code with no database, so check:install can test it. Always switched off: every
// agent off duty, every chain off, every playbook proposed for the owner to approve, goals with no
// due date. Specs pick only from code (readSpec), so a pack can never give an agent a new ability.
import { randomUUID } from "node:crypto";
import { readSpec } from "@/core/agent-spec";
import { readFlow, type Flow } from "@/core/flow-rules";
import { measureOf } from "@/core/goal-rules";
import { TOOLS } from "@/core/tools/catalog";
import type { PackCrew } from "@/templates/types";

const ID = /^[a-z0-9_]{1,60}$/;

/** Everything wrong with a pack's crew. An install refuses a crew with any problem. */
export function crewProblems(crew: PackCrew): string[] {
  const out: string[] = [];
  const depts = new Set(crew.departments.map((d) => d.id));
  const agents = new Set(crew.agents.map((a) => a.id));
  if (depts.size !== crew.departments.length) out.push("a department id is used twice");
  if (agents.size !== crew.agents.length) out.push("an agent id is used twice");
  for (const d of crew.departments) if (!/^[a-z][a-z0-9_]{1,39}$/.test(d.id) || !d.name.trim() || d.name.length > 60) out.push(`department ${d.id}: needs an id and a name of at most 60 characters`);
  for (const a of crew.agents) {
    if (!ID.test(a.id)) out.push(`agent ${a.id}: bad id`);
    if (a.role.length > 60 || (a.icon !== null && !/^[a-z0-9-]{1,40}$/.test(a.icon)) || (a.hue !== null && !/^#[0-9A-Fa-f]{6}$/.test(a.hue))) out.push(`agent ${a.id}: role, icon or colour isn't allowed`);
    if (!(a.daily_budget_usd > 0 && a.daily_budget_usd <= 50)) out.push(`agent ${a.id}: daily budget must be over $0 and at most $50`);
    const { spec, problems } = readSpec(crew.specs[a.id], a.id);
    if (!crew.specs[a.id]) out.push(`agent ${a.id}: no spec`);
    for (const p of problems) out.push(`agent ${a.id}: ${p}`);
    if (crew.specs[a.id] && spec.model !== a.model) out.push(`agent ${a.id}: its spec's model isn't the agent's`);
    for (const s of crew.playbooks[a.id] ?? []) {
      if (!TOOLS[s.tool]) out.push(`agent ${a.id}: playbook step ${s.tool} isn't a tool`);
      else if (!spec.tools.includes(s.tool)) out.push(`agent ${a.id}: playbook step ${s.tool} isn't one of its tools`);
      if (!s.input || typeof s.input !== "object" || Array.isArray(s.input)) out.push(`agent ${a.id}: playbook step ${s.tool} needs an input object`);
    }
  }
  for (const id of Object.keys(crew.specs)) if (!agents.has(id)) out.push(`spec ${id}: no such agent`);
  for (const id of Object.keys(crew.playbooks)) if (!agents.has(id)) out.push(`playbook ${id}: no such agent`);
  const keys = new Set(crew.seats.map((s) => s.key));
  if (keys.size !== crew.seats.length) out.push("a seat key is used twice");
  for (const s of crew.seats) {
    if (s.parent !== null && !keys.has(s.parent)) out.push(`seat ${s.key}: no parent ${s.parent}`);
    if (s.department !== null && !depts.has(s.department)) out.push(`seat ${s.key}: no department ${s.department}`);
    if ((s.holder === "agent") !== (s.agent !== null)) out.push(`seat ${s.key}: an agent seat names its agent, and only it does`);
    if (s.agent !== null && !/^[a-z][a-z0-9_]{1,62}$/.test(s.agent)) out.push(`seat ${s.key}: bad agent id`);
    if (!s.title.trim() || s.title.length > 60 || s.sub.length > 120) out.push(`seat ${s.key}: title 1 to 60 characters, note at most 120`);
    if (s.department === null && s.parent !== null) out.push(`seat ${s.key}: a seat outside the departments has no parent`);
  }
  // a seat's parents never loop back to it
  const parent = new Map(crew.seats.map((s) => [s.key, s.parent]));
  for (const s of crew.seats) {
    let at = s.parent, hops = 0;
    while (at !== null && at !== undefined && hops++ <= crew.seats.length) at = parent.get(at) ?? null;
    if (hops > crew.seats.length) out.push(`seat ${s.key}: its parents loop`);
  }
  const crewIds = { ids: [...agents], manualOnly: new Set(crew.agents.filter((a) => a.manual_only).map((a) => a.id)) };
  const raw = (crew.flow as Flow)?.chains;
  const { flow, problems } = readFlow(crew.flow, crewIds);
  for (const p of problems) out.push(`flow: ${p}`);
  if (!Array.isArray(raw) || flow.chains.length !== raw.length) out.push("flow: a chain would be dropped");
  for (const g of crew.goals) {
    if (!depts.has(g.department)) out.push(`goal ${g.title}: no department ${g.department}`);
    if (g.title.trim().length < 3 || g.title.length > 120) out.push(`goal ${g.title}: title must be 3 to 120 characters`);
    if (g.measure !== null && !measureOf(g.measure)) out.push(`goal ${g.title}: no measure ${g.measure}`);
    if (g.target !== null && !(g.target > 0)) out.push(`goal ${g.title}: target must be above 0`);
  }
  return out;
}

export interface InstallRows {
  departments: Record<string, unknown>[];
  agents: Record<string, unknown>[];
  agent_defs: Record<string, unknown>[];
  agent_playbooks: Record<string, unknown>[];
  /** Parents before children, so each insert's parent is already there. */
  seats: Record<string, unknown>[];
  crew_flow: Record<string, unknown>[];
  goals: Record<string, unknown>[];
}

/** The rows an install writes, in the order it writes them. Throws on a crew with problems. */
export function installRows(packId: string, crew: PackCrew, makeId: () => string = randomUUID): InstallRows {
  const problems = crewProblems(crew);
  if (problems.length) throw new Error(`The ${packId} pack's crew can't be installed: ${problems.join("; ")}`);
  const by = `template:${packId}`;
  const ids = new Map(crew.seats.map((s) => [s.key, makeId()]));
  const placed = new Set<string>(), seats: Record<string, unknown>[] = [];
  while (placed.size < crew.seats.length) {
    for (const s of crew.seats) {
      if (placed.has(s.key) || (s.parent !== null && !placed.has(s.parent))) continue;
      seats.push({ id: ids.get(s.key), parent_id: s.parent === null ? null : ids.get(s.parent), department_id: s.department, title: s.title, sub: s.sub, holder: s.holder, agent_id: s.agent, sort: s.sort });
      placed.add(s.key);
    }
  }
  const flow = crew.flow as Flow;
  return {
    departments: crew.departments.map((d) => ({ id: d.id, name: d.name, sort: d.sort, lead_checks_drafts: d.lead_checks_drafts })),
    agents: crew.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, model: a.model, icon: a.icon, hue: a.hue, daily_budget_usd: a.daily_budget_usd, manual_only: a.manual_only, enabled: false, in_org: true })),
    agent_defs: crew.agents.map((a) => ({ agent_id: a.id, version: 1, spec: readSpec(crew.specs[a.id], a.id).spec, note: `From the ${packId} template`, created_by: by, active: true })),
    agent_playbooks: Object.entries(crew.playbooks).map(([agentId, steps]) => ({ agent_id: agentId, version: 1, steps, status: "proposed", changes: `From the ${packId} template`, auto: false })),
    seats,
    crew_flow: [{ version: 1, flow: { chains: flow.chains.map((c) => ({ ...c, on: false })) }, note: `From the ${packId} template`, created_by: by, active: true }],
    goals: crew.goals.map((g) => ({ department_id: g.department, title: g.title, measure: g.measure, target: g.target, start_value: null, due_on: null, state: "active" })),
  };
}
