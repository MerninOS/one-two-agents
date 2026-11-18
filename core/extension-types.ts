// The slots the paid layer (ee/) may fill, and nothing else (docs/extensions.md). Types only, so
// core/extensions/none.ts and ee/index.ts can both import them without a cycle.
import type { ComponentType } from "react";

/** What a plan check is asked about. Each is checked as the current org, after the role check. */
export type PlanAsk =
  | { kind: "run"; agentId: string; trigger: string }
  | { kind: "invite"; email: string; role: string }
  | { kind: "agent_on"; agentIds: string[] }
  | { kind: "custom_server" };

export interface Extensions {
  /** "open" is the AGPL app on its own; "cloud" is the hosted edition built with ee/. */
  edition: "open" | "cloud";
  /**
   * Why the business's plan doesn't allow this now (no plan, trial over, seat limit), or null.
   * It can only say no on top of every check in core: core's hard rules, roles, caps and budgets
   * run whatever it answers, and nothing it returns turns one of them off.
   */
  planBlock(ask: PlanAsk): Promise<string | null>;
  /** Extra cards at the bottom of Settings (billing, seats). Server component; null for none. */
  SettingsCards: ComponentType | null;
  /** The sign-up page at /signup. null: no sign-up, /signup is not found (the open edition). */
  SignupPage: ComponentType | null;
}

/** Every slot, so check:open-core can make sure each edition fills each one. */
export const SLOTS = ["edition", "planBlock", "SettingsCards", "SignupPage"] as const satisfies readonly (keyof Extensions)[];
