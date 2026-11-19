// How the Control Room shows an agent, and the hard rules. Every agent comes from the database
// (dashboard/roster.ts: its agents row, live saved version, runs, seat and schedule), whether it
// started from a template or was built in the app (docs/agent-roster.md).

import type { Days } from "@/core/flow-rules";

export type Tier = "Report" | "Draft" | "Act";
export type IntegrationId = "shopify" | "mercury" | "notion" | "email" | "gmail" | "gmail_read" | "claude" | "web" | "supabase" | "github" | "klaviyo" | "mercury_write" | "mercury_files" | "vault";

export interface Schedule {
  kind: "manual" | Days;
  /** "HH:MM" in Central Time */
  time?: string;
  /** The crew flow chain (core/flow.ts) that runs it on this schedule. Off until the owner turns the chain on. */
  chain?: string;
}

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  icon: string;
  tier: Tier;
  mandate: string;
  job: string;
  hue?: string;
  /** When it joined, "Oct 29" (agents.created_at). */
  since?: string;
  /** What a real run costs, from its recent runs (or its cap per run before it has any). */
  estCostLabel?: string;
  /** What a real run writes or hands you, from its live version. */
  writes?: string;
  /** Its chain on Crew > Schedule, when it is in one with a schedule. */
  schedule?: Schedule;
  /** Runs only by hand (agents.manual_only). */
  manualOnly?: boolean;
  /** agents.in_org: false for a test agent that turning on the org never wakes (docs/org-schedule.md). */
  inOrg?: boolean;
  /** Average cost of its last real runs (up to 10), or null before it has any. */
  avgCost?: number | null;
  /** Its cap per run, from its live version. */
  capPerRun?: number;
  trigger?: string;
}


export const TIERS: Record<Tier, string> = {
  Report: "Report: reads only, writes a report.",
  Draft: "Draft: proposes actions that an approver approves.",
  Act: "Act: carries out allow-listed, reversible actions within limits.",
};

export const HARD_RULES = [
  "Never sends, buys or posts without the approval its trust level needs. Every new action starts as an approval card.",
  "Earns trust per action: 28 of the last 30 approved unedited, then you confirm the promotion. One bad call drops it back.",
  "Spends only within caps ($500 a purchase, $1,500 a month) and only to vendors you added. No card actions.",
  "First email to a new person always waits for you. Unsubscribes end all messages.",
  "Writes to Mercury only through the gateway: receipt, category and memo on an existing charge, after you approve.",
  "Never writes to Shopify.",
  "Never deletes products, customers, orders or Klaviyo profiles.",
  "Never claims a fact about a lot, origin or certification that isn’t in Shopify.",
  "Never lets a web page, inbound email or a server you added choose a recipient, URL, product or category.",
  "Uses a server you added only for tools you turned on that only read. If one changes, the server pauses until you look.",
  "Computes money, margins and counts in code, never by the model.",
];
