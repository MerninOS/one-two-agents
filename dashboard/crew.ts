// The crew as the Control Room shows them: personas, mandates, access and the hard rules.
// Names are placeholders Zak can rename here. Facts about what each agent can touch come
// from the tech spec and CLAUDE.md; the live switches (enabled, budget) come from Supabase.

export type Tier = "Report" | "Draft" | "Act";
export type IntegrationId = "shopify" | "mercury" | "notion" | "gmail" | "gmail_read" | "claude" | "web" | "supabase" | "github";
export type Level = "read" | "draft" | "write" | "uses";

export interface Schedule {
  kind: "manual" | "daily" | "weekdays";
  /** "HH:MM" in Central Time */
  time?: string;
  /** Vercel Schedule name in vercel.json */
  vercelName?: string;
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
  model?: string;
  since?: string;
  /** Rough cost of one real run, for confirm dialogs. Computed cost is always read from agent_runs. */
  estCostLabel?: string;
  writes?: string;
  works?: string;
  how?: [string, string][];
  schedule?: Schedule;
  trigger?: string;
}

export const CREW: CrewMember[] = [
  {
    id: "chief_of_staff", name: "Avery", role: "Chief of Staff", hue: "#F2884B", icon: "clipboard-list", built: true, tier: "Report",
    model: "claude-sonnet-5-5", since: "Oct 29", estCostLabel: "About $0.003", writes: "1 Notion page",
    mandate: "I read every other agent’s runs and your numbers, and write one morning brief in Notion before you start the day.",
    job: "Morning brief posted to a Notion page: numbers, what each agent did, watch list, today’s focus.",
    works: "Reads every run from Morgan and Rowan for the morning brief.",
    how: [
      ["Voice", "Numbers first, then one focus for the day."],
      ["Reads", "The run log, kpi_snapshots, Shopify open orders and green lots"],
      ["Writes", "One Notion page per brief under Morning briefs"],
      ["Numbers", "Come from code. Claude writes only the watch list and today’s focus, with a rules fallback."],
      ["Works with", "Reads every other agent’s runs for the morning brief."],
    ],
    schedule: { kind: "weekdays", time: "06:45", vercelName: "chief-of-staff" },
  },
  {
    id: "cfo", name: "Morgan", role: "CFO", hue: "#6CC69A", icon: "calculator", built: true, tier: "Report",
    model: "None (plain code)", since: "Oct 29", estCostLabel: "$0", writes: "1 row in kpi_snapshots",
    mandate: "I count yesterday’s revenue, orders, margin and cash in code and write them down. I never estimate a number.",
    job: "Daily snapshot: yesterday’s revenue, orders, AOV, repeat rate, green coffee cost and margin from Shopify, cash from Mercury.",
    works: "Avery reads my snapshot every morning.",
    how: [
      ["Method", "Plain code, no model. Money, margins and counts are computed in code."],
      ["Reads", "Shopify orders, products, inventory. Mercury balances."],
      ["Writes", "Its own table kpi_snapshots"],
      ["Works with", "Avery reads the snapshot each morning."],
    ],
    schedule: { kind: "daily", time: "05:30", vercelName: "cfo" },
  },
  {
    id: "wholesale_hunter", name: "Rowan", role: "Wholesale Hunter", hue: "#F5D35C", icon: "compass", built: true, tier: "Draft",
    model: "claude-opus-5-5 + web search", since: "Oct 29", estCostLabel: "About $1", writes: "wholesale_leads, 1 Notion page, Gmail drafts if set up",
    mandate: "I find cafés, restaurants and offices around Austin that would pour One Two, and write the first hello. You send it. I never do.",
    job: "Finds a few new wholesale prospects in Austin, Lakeway and Bee Cave, scores fit, writes a first-touch email as a draft. Never sends.",
    works: "You review and send every draft. Avery reads each run.",
    how: [
      ["Voice", "Plain and short. Opens with the coffee. Signs as Zak."],
      ["Territory", "Austin, Lakeway, Bee Cave"],
      ["Looks for", "Independent cafés, restaurants and offices that pour espresso and don’t roast in house"],
      ["Shift", "Manual only. About $1 a run, so it never runs on its own."],
      ["Works with", "You review and send every draft. Avery reads each run for the brief."],
    ],
    schedule: { kind: "manual" },
  },
  {
    id: "bookkeeper", name: "Quinn", role: "Bookkeeper", hue: "#F6B8C9", icon: "receipt", built: true, tier: "Draft",
    model: "claude-haiku-5-5", since: "Nov 9", estCostLabel: "A few cents", writes: "expense_docs rows, receipt files, 1 Notion page when something changed",
    mandate: "I find the receipt behind every business charge, suggest a category, and ask you for a photo only when it matters. I never change Mercury myself: you approve every entry.",
    job: "Pulls business charges from Mercury, finds receipts in Gmail, suggests categories from Mercury’s own list, lists charges that need a photo, and closes each month on the 3rd.",
    works: "You approve every Mercury change. Morgan reads my categories once I ship.",
    how: [
      ["Method", "Code decides every match: exact amount, date within 3 days, merchant name. Haiku only reads receipts and suggests a category from Mercury’s list."],
      ["Reads", "Mercury charges and categories (business org, read only). Gmail receipts in zak@ when the read-only token is set."],
      ["Writes", "Its own tables (expense_docs, trips, home_office, tax_packets), receipt files in Supabase Storage, a Notion page when something changed."],
      ["Mercury", "Receipt, category and memo are proposals only. Nothing is written to Mercury until the approval gateway exists."],
      ["Photos", "Asked for at $75 and up, lodging, or stores that sell personal things too. After 30 days a charge stays as bank record only."],
      ["Shift", "Manual only until launch. Planned daily at 6:00 AM CT, after Morgan’s snapshot. Month close on the 3rd."],
    ],
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

export interface Integration { id: IntegrationId; name: string; sub: string; icon: string; scope: string }
export const INTEGRATIONS: Integration[] = [
  { id: "shopify", name: "Shopify", sub: "Store", icon: "shopping-bag", scope: "Read-only app “One Two Agents (read)”. Scopes: read products, inventory, orders, locations, customers." },
  { id: "mercury", name: "Mercury", sub: "Bank", icon: "landmark", scope: "Read-only token for the business accounts. Balances, transactions and categories. Receipt, category and memo changes wait for the approval gateway." },
  { id: "notion", name: "Notion", sub: "Pages", icon: "file-text", scope: "Creates pages under one parent page (“Morning briefs”) only." },
  { id: "gmail", name: "Gmail", sub: "Drafts", icon: "mail", scope: "Drafts only (compose scope) in zak@onetwocoffeelab.com. Can never send." },
  { id: "gmail_read", name: "Gmail receipts", sub: "Read only", icon: "inbox", scope: "A separate read-only token (gmail.readonly) for zak@onetwocoffeelab.com. Searches for receipts. Can’t draft, send, label or delete. Email is untrusted data." },
  { id: "claude", name: "Claude API", sub: "Model", icon: "cpu", scope: "The model. Spend is read from the run log." },
  { id: "web", name: "Web search and fetch", sub: "Public web", icon: "globe", scope: "Reads public web pages. Untrusted: a page never chooses a recipient, URL, product or category." },
  { id: "supabase", name: "Supabase", sub: "Agent database", icon: "database", scope: "Each agent writes only its own tables. Service role, server only." },
  { id: "github", name: "GitHub", sub: "Pull requests", icon: "git-pull-request", scope: "Planned for Ellis: a separate GitHub App on MerninOS/blended, PRs on agent/* branches only. Never merges." },
];

/** What each agent may touch. Built agents match the code; planned ones match the tech spec. */
export const ACCESS: Record<string, Partial<Record<IntegrationId, [Level, string]>>> = {
  cfo: { shopify: ["read", "Orders, products, inventory"], mercury: ["read", "Balances"], supabase: ["write", "Its own table kpi_snapshots"] },
  chief_of_staff: { shopify: ["read", "Open orders, green lots"], claude: ["uses", "claude-sonnet-5-5"], notion: ["write", "One page per brief under Morning briefs"], supabase: ["read", "The run log and kpi_snapshots"] },
  wholesale_hunter: { claude: ["uses", "claude-opus-5-5"], web: ["read", "Web search and fetch. Untrusted."], shopify: ["read", "Our coffees and green lots, so it only claims real facts"], supabase: ["write", "Its own table wholesale_leads"], notion: ["write", "One page per run"], gmail: ["draft", "Drafts when Gmail is set up. Never sends."] },
  bookkeeper: {
    mercury: ["draft", "Reads charges and categories. Receipt, category and memo on existing transactions are proposals Zak approves, applied only once the gateway exists."],
    gmail_read: ["read", "Receipt emails in zak@, read only. Untrusted: an email never picks a charge or category."],
    claude: ["uses", "claude-haiku-5-5"],
    supabase: ["write", "Its own tables expense_docs, trips, home_office, tax_packets and the private receipts bucket"],
    notion: ["write", "One page when something changed, and the month close"],
  },
  green_buyer: { web: ["read", "Importer offer pages and market reports. Report only."] },
  conversion_optimizer: { shopify: ["read", "Orders and reports, still read-only."], web: ["read", "The live site and PageSpeed Insights. Untrusted."], claude: ["uses", "claude-opus-5-5 and claude-sonnet-5-5"], notion: ["write", "The Site experiments page"], supabase: ["write", "Its own experiment tables"], github: ["draft", "Pull requests on agent/* branches of MerninOS/blended. You merge every PR."] },
};

export const HARD_RULES = [
  "Never moves money: no transfers, payments or card actions.",
  "Never sends an email or DM. Outreach is a draft Zak sends.",
  "Never writes to Shopify.",
  "Never deletes products, customers, orders or Klaviyo profiles.",
  "Never claims a fact about a lot, origin or certification that isn’t in Shopify.",
  "Never lets a web page or inbound email choose a recipient, URL, product or category.",
  "Computes money, margins and counts in code, never by the model.",
];
