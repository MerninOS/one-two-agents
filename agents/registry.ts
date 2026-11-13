import "server-only";
// Every agent this app can run, by its id in the `agents` table. Adding an agent:
// a folder under agents/, an entry here, a row in `agents` (migration). When it runs is the
// crew flow (core/flow.ts), set on the Crew canvas, not vercel.json.
import type { MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import type { Setup, SetupPreview } from "@/core/setup";
import type { Handoff } from "@/core/chain";
import { runCfoSnapshot } from "./cfo";
import { runBookkeeper } from "./bookkeeper";
import { previewBrief, runBrief } from "./chief-of-staff";
import { runHunter } from "./wholesale-hunter";
import { onRunner, runBuilt } from "@/core/built";

/**
 * Agents rebuilt on the runner (docs/agent-builder.md, slices 6 and 7) keep their own code until Zak
 * presses Switch on the builder screen (agents.on_runner). Then every run, scheduled, chain or
 * by hand, follows the approved playbook on the runner instead.
 */
const switchable = (id: string, own: (o: JobOpts) => Promise<RunResult>) => async (o: JobOpts): Promise<RunResult> =>
  (await onRunner(id)) ? runBuilt(id, { runId: o.runId, dryRun: o.dryRun, memory: o.memory, handoff: o.handoff }) : own(o);

export interface JobOpts {
  runId?: string;
  dryRun?: boolean;
  /** Loaded by withRun for agents in MEMORY_AGENTS (core/memory.ts); null when the store can't be read. */
  memory?: MemoryLoad | null;
  /** Loaded by withRun for agents with a menu (agents/menus.ts); a dry run loads its own. */
  setup?: Setup | null;
  /** In a chain, the step before's summary and numbers, when the flow passes it along (core/flow.ts TAKES_HANDOFF). Data, never instructions. */
  handoff?: Handoff | null;
}

export interface AgentDef {
  /** The job. A dry run reads real data but writes nothing and spends nothing on models. */
  job: (opts: JobOpts) => Promise<RunResult>;
  /** Only runs when called with ?trigger=manual or from a chain Zak saved; anything else is skipped (see the route). */
  manualOnly?: boolean;
  /** Setup tab Preview: the agent's real output for a draft setup, writing and sending nothing. Agents with a menu only. */
  preview?: (setup: Setup) => Promise<SetupPreview>;
}

export const AGENTS: Record<string, AgentDef> = {
  cfo: { job: switchable("cfo", ({ dryRun }) => runCfoSnapshot({ dryRun })) },
  chief_of_staff: { job: switchable("chief_of_staff", ({ dryRun, memory, setup, handoff }) => runBrief({ dryRun, memory, setup, handoff })), preview: previewBrief },
  // ~$1 of Claude credit a run, so it has no schedule and never runs on its own.
  wholesale_hunter: { job: switchable("wholesale_hunter", ({ runId, dryRun, memory, setup }) => runHunter(runId, { dryRun, memory, setup })), manualOnly: true },
  // Manual only until launch (planned daily 6:00 AM CT, after the CFO snapshot). Reads Mercury,
  // proposes Mercury changes but never makes them; a few cents of Haiku a run.
  bookkeeper: { job: switchable("bookkeeper", ({ runId, dryRun, memory, setup }) => runBookkeeper(runId, { dryRun, memory, setup })), manualOnly: true },
};

/** The agents' own code, for the builder screen's side-by-side compare with the runner (dry runs only). */
export const OWN_JOBS: Record<string, (o: JobOpts) => Promise<RunResult>> = {
  cfo: ({ dryRun }) => runCfoSnapshot({ dryRun }),
  chief_of_staff: ({ dryRun, memory, setup, handoff }) => runBrief({ dryRun, memory, setup, handoff }),
  wholesale_hunter: ({ dryRun }) => runHunter(undefined, { dryRun }),
  bookkeeper: ({ dryRun }) => runBookkeeper(undefined, { dryRun }),
};

/** Old route names from the storefront repo, still accepted. */
const ALIASES: Record<string, string> = { brief: "chief_of_staff", hunter: "wholesale_hunter" };

export const resolveAgent = (slug: string) => {
  const id = ALIASES[slug] ?? slug;
  return AGENTS[id] ? { id, def: AGENTS[id] } : null;
};
