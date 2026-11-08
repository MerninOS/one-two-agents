import "server-only";
// Every agent this app can run, by its id in the `agents` table. Adding an agent:
// a folder under agents/, an entry here, a row in `agents` (migration), and a cron
// line in vercel.json if it runs on a schedule.
import type { RunResult } from "@/core/runs";
import { runCfoSnapshot } from "./cfo";
import { runBrief } from "./chief-of-staff";
import { runHunter } from "./wholesale-hunter";

export interface JobOpts { runId?: string; dryRun?: boolean }

export interface AgentDef {
  /** The job. A dry run reads real data but writes nothing and spends nothing on models. */
  job: (opts: JobOpts) => Promise<RunResult>;
  /** Only runs when started by hand: its Feb 29 placeholder firing is skipped (see the route). */
  manualOnly?: boolean;
}

export const AGENTS: Record<string, AgentDef> = {
  cfo: { job: ({ dryRun }) => runCfoSnapshot({ dryRun }) },
  chief_of_staff: { job: ({ dryRun }) => runBrief({ dryRun }) },
  // ~$1 of Claude credit a run, so it never runs on its own (vercel.json gives it a
  // Feb 29 schedule only so Vercel shows a Run button).
  wholesale_hunter: { job: ({ runId, dryRun }) => runHunter(runId, { dryRun }), manualOnly: true },
};

/** Old route names from the storefront repo, still accepted. */
const ALIASES: Record<string, string> = { brief: "chief_of_staff", hunter: "wholesale_hunter" };

export const resolveAgent = (slug: string) => {
  const id = ALIASES[slug] ?? slug;
  return AGENTS[id] ? { id, def: AGENTS[id] } : null;
};
