// The crew as the Control Room shows them: personas, mandates and the hard rules.
// Names are placeholders Zak can rename here. What each agent can reach comes from its saved
// setup (dashboard/connections.ts); the live switches (enabled, budget) come from Supabase.

export type Tier = "Report" | "Draft" | "Act";
export type IntegrationId = "shopify" | "mercury" | "notion" | "email" | "gmail" | "gmail_read" | "claude" | "web" | "supabase" | "github";

export interface Schedule {
  kind: "manual" | "daily" | "weekdays";
  /** "HH:MM" in Central Time */
  time?: string;
  /** Vercel Schedule name in vercel.json */
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
  /** Built and in the `agents` table. */
  built: boolean;
  phase?: number;
  hue?: string;
  since?: string;
  /** Rough cost of one real run, for confirm dialogs. Computed cost is always read from agent_runs. */
  estCostLabel?: string;
  writes?: string;
  works?: string;
  schedule?: Schedule;
  trigger?: string;
}

export const CREW: CrewMember[] = [
  {
    id: "chief_of_staff", name: "Avery", role: "Chief of Staff", hue: "#F2884B", icon: "clipboard-list", built: true, tier: "Report",
    since: "Oct 29", estCostLabel: "About $0.003", writes: "1 email to you, 1 row in the Briefs database",
    mandate: "I read every other agent’s runs and your numbers, and email you one morning brief before you start the day.",
    job: "Morning brief emailed to you, with a copy in Notion: today’s focus, what’s waiting on you, numbers, watch list.",
    works: "Reads every run from Morgan and Rowan for the morning brief.",
    schedule: { kind: "weekdays", time: "06:45", chain: "morning" },
  },
  {
    id: "cfo", name: "Morgan", role: "CFO", hue: "#6CC69A", icon: "calculator", built: true, tier: "Report",
    since: "Oct 29", estCostLabel: "$0", writes: "1 row in kpi_snapshots",
    mandate: "I count yesterday’s revenue, orders, margin and cash in code and write them down. I never estimate a number.",
    job: "Daily snapshot: yesterday’s revenue, orders, AOV, repeat rate, green coffee cost and margin from Shopify, cash from Mercury.",
    works: "Avery reads my snapshot every morning.",
    schedule: { kind: "daily", time: "05:30", chain: "morning" },
  },
  {
    id: "wholesale_hunter", name: "Rowan", role: "Wholesale Hunter", hue: "#F5D35C", icon: "compass", built: true, tier: "Draft",
    since: "Oct 29", estCostLabel: "About $1", writes: "wholesale_leads, 1 Notion page, Gmail drafts if set up",
    mandate: "I find cafés, restaurants and offices around Austin that would pour One Two, and write the first hello. You approve every first email before it goes out.",
    job: "Finds a few new wholesale prospects in Austin, Lakeway and Bee Cave, scores fit, writes a first-touch email as a draft. First emails always wait for your approval.",
    works: "You review and send every draft. Avery reads each run.",
    schedule: { kind: "manual" },
  },
  {
    id: "bookkeeper", name: "Quinn", role: "Bookkeeper", hue: "#F6B8C9", icon: "receipt", built: true, tier: "Draft",
    since: "Nov 9", estCostLabel: "A few cents", writes: "expense_docs rows, receipt files, 1 Notion page when something changed",
    mandate: "I find the receipt behind every business charge, suggest a category, and ask you for a photo only when it matters. I never change Mercury myself: you approve every entry.",
    job: "Pulls business charges from Mercury, finds receipts in Gmail, suggests categories from Mercury’s own list, lists charges that need a photo, and closes each month on the 3rd.",
    works: "You approve every Mercury change. Morgan reads my categories once I ship.",
    schedule: { kind: "manual" },
  },
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

export const BY_ID: Record<string, CrewMember> = Object.fromEntries(CREW.map((a) => [a.id, a]));
export const BUILT = CREW.filter((a) => a.built);
export const PLANNED = CREW.filter((a) => !a.built);

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
