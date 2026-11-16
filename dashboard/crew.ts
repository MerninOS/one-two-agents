// How the Control Room shows an agent, the planned seats that have no agent yet, and the hard rules.
// Every agent that exists comes from the database (dashboard/roster.ts: its agents row, live saved
// version, runs, seat and schedule), whether it started in code or was built in the app. Only the
// planned roster below is written here, until each one is built (docs/agent-roster.md).

export type Tier = "Report" | "Draft" | "Act";
export type IntegrationId = "shopify" | "mercury" | "notion" | "email" | "gmail" | "gmail_read" | "claude" | "web" | "supabase" | "github" | "klaviyo" | "vault";

export interface Schedule {
  kind: "manual" | "daily" | "weekdays";
  /** "HH:MM" in Central Time */
  time?: string;
  /** The crew flow chain (core/flow.ts) that runs it on this schedule. Off until Zak turns the chain on. */
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
  /** In the `agents` table with a live version. False for the planned roster. */
  built: boolean;
  phase?: number;
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
  trigger?: string;
}

/** Seats on the plan that have no agent yet. Each leaves this list when it is built in the app. */
export const PLANNED: CrewMember[] = [
  { id: "blend_coach", name: "Sage", role: "Blend Coach", icon: "sliders-horizontal", built: false, phase: 3, tier: "Draft", trigger: "When a Shopify order is fulfilled + 5 days",
    job: "Post-purchase check-ins, blend ratio tweaks, reorder timing.",
    mandate: "I’ll check in after a bag lands, suggest blend tweaks and time the reorder. You approve what goes out." },
  { id: "roast_planner", name: "Blair", role: "Roast Planner", icon: "flame", built: false, phase: 3, tier: "Report", trigger: "Trigger set when built",
    job: "Roast schedule, green lot burn-down, days of cover, and a 60-day “start shopping” signal.",
    mandate: "I’ll plan the roast schedule and tell you how many days of green cover are left." },
  { id: "green_buyer", name: "Sol", role: "Green Buyer", icon: "leaf", built: false, phase: 3, tier: "Report", trigger: "Monthly, and when Roast Planner sees under 60 days of green cover",
    job: "Green coffee market pulse, offer ranking, buying suggestions.",
    mandate: "I’ll read importer offers and the market, rank what fits, and suggest what to buy. You decide." },
  { id: "merchandiser", name: "Remy", role: "Merchandiser", icon: "store", built: false, phase: 4, tier: "Act", trigger: "Trigger set when built",
    job: "Hide sold-out lots in the blend builder, back-in-stock, lot page drafts.",
    mandate: "I’ll hide sold-out lots, flag back-in-stock and draft lot pages, within limits you set." },
  { id: "concierge", name: "Jules", role: "Concierge", icon: "mail", built: false, phase: 4, tier: "Draft", trigger: "Trigger set when built",
    job: "Customer email triage and reply drafts.",
    mandate: "I’ll sort customer email and draft replies. You send them." },
  { id: "conversion_optimizer", name: "Ellis", role: "Conversion Optimizer", icon: "flask-conical", built: false, phase: 4, tier: "Draft",
    trigger: "First Monday of each month, 8:00 AM CT, plus a weekly code-only check Mondays 7:30 AM CT",
    job: "Runs one experiment at a time on onetwocoffeelab.com and drafts each change as a pull request you review and merge. About $3 to $6 a month.",
    mandate: "I’ll run one experiment at a time on the site and draft each change as a pull request. You merge it. I never do." },
  { id: "content_scout", name: "Kit", role: "Content Scout", icon: "clapperboard", built: false, phase: 4, tier: "Report", trigger: "Trigger set when built",
    job: "Social content research, weekly ideas, creator briefs.",
    mandate: "I’ll research social content and bring you weekly ideas and creator briefs." },
];

export const TIERS: Record<Tier, string> = {
  Report: "Report: reads only, writes a report.",
  Draft: "Draft: proposes actions that Zak approves.",
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
  "Never lets a web page or inbound email choose a recipient, URL, product or category.",
  "Computes money, margins and counts in code, never by the model.",
];
