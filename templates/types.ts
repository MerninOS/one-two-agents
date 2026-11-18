// The shape of a template pack (docs/templates.md): what one kind of business brings on top of
// core: tools, goal measures, its own tables, and a starting crew that core/install.ts installs into a
// new, empty org.
import type { MeasureRead } from "@/core/measures";
import type { ToolDef } from "@/core/tools/types";
import type { CrewMember } from "@/dashboard/crew";

export interface TemplatePack {
  /** Short id, lowercase. */
  id: string;
  name: string;
  about: string;
  /** Tools added to the tool list. Held to the same rules as core tools; ids never clash with core's. */
  tools: readonly ToolDef[];
  /** Tables only this pack's code reads and writes. Each is still a tenant table (core/tenancy.ts)
   * with its own migration, org_id and org_rows policy; check:packs keeps core out of them. */
  tables: readonly string[];
  /** Goal measures this pack counts, by core/goal-rules.ts key. */
  measures?: Readonly<Record<string, () => Promise<MeasureRead>>>;
  /** The crew a new org can start from (core/install.ts), checked by check:install. */
  crew?: PackCrew;
  /** Agents on the pack's plan that aren't built yet, shown in an org that has the pack's agents. */
  planned?: readonly CrewMember[];
}

/**
 * A starting crew, as data. Installed into an empty org only, and always switched off: every agent
 * off duty, every chain off, every playbook waiting for the owner's approval, the org switch left
 * off. Specs and playbooks pick only from code (core/agent-spec.ts readSpec, the tool list), so a
 * pack can make an agent smaller, never give it a new ability.
 */
export interface PackCrew {
  departments: { id: string; name: string; sort: number; lead_checks_drafts: boolean }[];
  agents: { id: string; name: string; role: string; model: string; icon: string | null; hue: string | null; daily_budget_usd: number; manual_only: boolean }[];
  /** Each agent's spec (core/agent-spec.ts AgentSpec), installed as version 1. */
  specs: Record<string, unknown>;
  /** Each agent's playbook steps, installed as a proposed version 1 for the owner to approve. */
  playbooks: Record<string, { tool: string; input: Record<string, unknown> }[]>;
  /** The org chart. `key` and `parent` are names inside this list; new ids are made at install. */
  seats: { key: string; parent: string | null; department: string | null; title: string; sub: string; holder: "open" | "owner" | "agent"; agent: string | null; sort: number }[];
  /** The chains (core/flow-rules.ts), installed with every chain off. */
  flow: unknown;
  /** Starting goals, installed active with no due date for the owner to set. */
  goals: { department: string; title: string; measure: string | null; target: number | null }[];
}
