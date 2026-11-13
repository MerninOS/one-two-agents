import "server-only";
// Every agent this app can run on a schedule, in a chain or by hand through /api/agents/<id>,
// by its id in the `agents` table. Each one is a saved spec run on the shared engine
// (core/built.ts runBuilt): its active version and approved routine. Building or editing one is
// the builder flow (docs/builder-flow.md); when it runs is the crew flow (Crew > Schedule).
// The folders next to this file hold only code the engine's tools call (core/tools/catalog.ts).
import type { MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import type { Handoff } from "@/core/chain";
import { runBuilt } from "@/core/built";

export interface JobOpts {
  runId?: string;
  dryRun?: boolean;
  /** Loaded by withRun for agents in MEMORY_AGENTS (core/memory.ts); null when the store can't be read. */
  memory?: MemoryLoad | null;
  /** In a chain, the step before's summary and numbers, when the flow passes it along (core/flow.ts TAKES_HANDOFF). Data, never instructions. */
  handoff?: Handoff | null;
}

export interface AgentDef {
  /** The job. A dry run makes the routine's reads in code and writes nothing, with no model. */
  job: (opts: JobOpts) => Promise<RunResult>;
  /** Only runs when called with ?trigger=manual or from a chain Zak saved; anything else is skipped (see the route). */
  manualOnly?: boolean;
}

const engine = (id: string): AgentDef["job"] => (o) => runBuilt(id, { runId: o.runId, dryRun: o.dryRun, memory: o.memory, handoff: o.handoff });

export const AGENTS: Record<string, AgentDef> = {
  cfo: { job: engine("cfo") },
  chief_of_staff: { job: engine("chief_of_staff") },
  // ~$1 of Claude credit a run, so it has no schedule and never runs on its own.
  wholesale_hunter: { job: engine("wholesale_hunter"), manualOnly: true },
  // Manual only until launch (planned daily 6:00 AM CT, after the CFO snapshot). Proposes Mercury
  // changes but never makes them; a few cents of Haiku a run.
  bookkeeper: { job: engine("bookkeeper"), manualOnly: true },
};

/** Old route names from the storefront repo, still accepted. */
const ALIASES: Record<string, string> = { brief: "chief_of_staff", hunter: "wholesale_hunter" };

export const resolveAgent = (slug: string) => {
  const id = ALIASES[slug] ?? slug;
  return AGENTS[id] ? { id, def: AGENTS[id] } : null;
};
