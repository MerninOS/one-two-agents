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
  /**
   * Extra cards at the bottom of Settings (billing, seats). Server component, given the page's query
   * (a card's own short messages, such as a problem after a redirect); null for none.
   */
  SettingsCards: ComponentType<{ query: Readonly<Record<string, string | undefined>> }> | null;
  /** The sign-up page at /signup, given its query. null: no sign-up, /signup is not found (the open edition). */
  SignupPage: ComponentType<{ query: Readonly<Record<string, string | undefined>> }> | null;
  /**
   * Routes at /api/ee/<name> (POST), such as a billing webhook. Each checks its own caller (a
   * signature), since /api is outside the sign-in guard. Empty: every /api/ee route is not found.
   */
  api: Readonly<Record<string, (req: Request) => Promise<Response>>>;
  /** Told after People changes (someone added or removed), as the current org. Never stops the change. */
  afterMembersChange(): Promise<void>;
}

/** Every slot, so check:open-core can make sure each edition fills each one. */
export const SLOTS = ["edition", "planBlock", "SettingsCards", "SignupPage", "api", "afterMembersChange"] as const satisfies readonly (keyof Extensions)[];
