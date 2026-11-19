// Department templates as data (docs/templates.md): each file in templates/ is one department a
// business can start from: its department, head and agents, their specs and playbooks, its seats,
// its chains and its starting goal. Pure, so check:templates and check:install can test it. A template
// picks only from code (readSpec, the tool list), so it can make an agent smaller, never give it a new
// ability; core/install-rules.ts checks the merged crew before anything is written.
import type { Chain } from "@/core/flow-rules";

/** A starting crew, as data: one or more templates merged (mergeTemplates), installed by core/install.ts. */
export interface Crew {
  departments: { id: string; name: string; sort: number; lead_checks_drafts: boolean }[];
  agents: { id: string; name: string; role: string; model: string; icon: string | null; hue: string | null; daily_budget_usd: number; manual_only: boolean }[];
  /** Each agent's spec (core/agent-spec.ts AgentSpec), installed as version 1. */
  specs: Record<string, unknown>;
  /** Each agent's playbook steps, installed as a proposed version 1 for the owner to approve. */
  playbooks: Record<string, { tool: string; input: Record<string, unknown> }[]>;
  /** The org chart. `key` and `parent` are names inside this list; new ids are made at install. */
  seats: { key: string; parent: string | null; department: string | null; title: string; sub: string; holder: "open" | "owner" | "agent"; agent: string | null; sort: number }[];
  /** The chains (core/flow-rules.ts), installed with every chain off. */
  flow: { chains: unknown[] };
  /** Starting goals, installed active with no due date for the owner to set. */
  goals: { department: string; title: string; measure: string | null; target: number | null }[];
}

/** One department template: a templates/<id>.json file. */
export interface Template extends Omit<Crew, "flow"> {
  /** Lowercase id, the file's name. */
  id: string;
  name: string;
  /** One line for the Desk's picker. */
  about: string;
  /** Its chains. A chain with the same key in another picked template merges into one, in template order. */
  chains: unknown[];
}

const TID = /^[a-z][a-z0-9-]{1,30}$/;

/** What's wrong with a template file's shape. The crew's own checks (crewProblems) run on the merge. */
export function templateProblems(t: unknown): string[] {
  if (!t || typeof t !== "object" || Array.isArray(t)) return ["a template is an object"];
  const x = t as Record<string, unknown>, out: string[] = [];
  if (typeof x.id !== "string" || !TID.test(x.id)) out.push("id: 2 to 31 lowercase letters, digits or dashes");
  if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 60) out.push("name: 1 to 60 characters");
  if (typeof x.about !== "string" || !x.about.trim() || x.about.length > 200) out.push("about: 1 to 200 characters");
  for (const k of ["departments", "agents", "seats", "chains", "goals"]) if (!Array.isArray(x[k])) out.push(`${k}: a list`);
  for (const k of ["specs", "playbooks"]) if (!x[k] || typeof x[k] !== "object" || Array.isArray(x[k])) out.push(`${k}: an object`);
  return out;
}

const stepAgent = (s: unknown) => (s && typeof s === "object" ? (s as { agent?: unknown }).agent : undefined);

/**
 * The picked templates as one crew. Lists are joined in template order; a chain whose key another
 * template already used adds its steps to that chain; a step whose agent isn't being installed is
 * dropped, and so is a chain left with no steps. Ids that clash are left for crewProblems to refuse.
 */
export function mergeTemplates(picked: readonly Template[]): Crew {
  const crew: Crew = { departments: [], agents: [], specs: {}, playbooks: {}, seats: [], flow: { chains: [] }, goals: [] };
  const chains = new Map<string, Chain>();
  for (const t of picked) {
    crew.departments.push(...t.departments);
    crew.agents.push(...t.agents);
    Object.assign(crew.specs, t.specs);
    Object.assign(crew.playbooks, t.playbooks);
    crew.seats.push(...t.seats);
    crew.goals.push(...t.goals);
    for (const raw of t.chains) {
      const c = raw as Chain;
      const had = chains.get(c.key);
      if (had) had.steps = [...had.steps, ...c.steps];
      else chains.set(c.key, { ...c, steps: [...c.steps] });
    }
  }
  const ids = new Set(crew.agents.map((a) => a.id));
  crew.flow.chains = [...chains.values()].map((c) => ({ ...c, steps: c.steps.filter((s) => ids.has(String(stepAgent(s)))) })).filter((c) => c.steps.length);
  return crew;
}
