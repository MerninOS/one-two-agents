import "server-only";
// Every agent this app can run, by its id in the `agents` table. Adding an agent:
// a folder under agents/, an entry here, a row in `agents` (migration), and a schedule
// in vercel.json if it runs on a schedule.
import type { MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import type { Setup } from "@/core/setup";
import { runCfoSnapshot } from "./cfo";
import { runBookkeeper } from "./bookkeeper";
import { runBrief } from "./chief-of-staff";
import { runHunter } from "./wholesale-hunter";

export interface JobOpts {
  runId?: string;
  dryRun?: boolean;
  /** Loaded by withRun for agents in MEMORY_AGENTS (core/memory.ts); null when the store can't be read. */
  memory?: MemoryLoad | null;
  /** Loaded by withRun for agents with a menu (agents/menus.ts); a dry run loads its own. */
  setup?: Setup | null;
}

export interface AgentDef {
  /** The job. A dry run reads real data but writes nothing and spends nothing on models. */
  job: (opts: JobOpts) => Promise<RunResult>;
  /** Only runs when called with ?trigger=manual; anything else is skipped (see the route). */
  manualOnly?: boolean;
}

export const AGENTS: Record<string, AgentDef> = {
  cfo: { job: ({ dryRun }) => runCfoSnapshot({ dryRun }) },
  chief_of_staff: { job: ({ dryRun, memory, setup }) => runBrief({ dryRun, memory, setup }) },
  // ~$1 of Claude credit a run, so it has no schedule and never runs on its own.
  wholesale_hunter: { job: ({ runId, dryRun, memory }) => runHunter(runId, { dryRun, memory }), manualOnly: true },
  // Manual only until launch (planned daily 6:00 AM CT, after the CFO snapshot). Reads Mercury,
  // proposes Mercury changes but never makes them; a few cents of Haiku a run.
  bookkeeper: { job: ({ runId, dryRun, memory }) => runBookkeeper(runId, { dryRun, memory }), manualOnly: true },
};

/** Old route names from the storefront repo, still accepted. */
const ALIASES: Record<string, string> = { brief: "chief_of_staff", hunter: "wholesale_hunter" };

export const resolveAgent = (slug: string) => {
  const id = ALIASES[slug] ?? slug;
  return AGENTS[id] ? { id, def: AGENTS[id] } : null;
};
