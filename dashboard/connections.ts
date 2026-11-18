import "server-only";
// Connections (docs/builder-flow.md, slice 1): the one place that says which integrations the business has, what
// each lets an agent read, do and hand the owner, and which agents have each of those in their saved
// setup. It replaces the hand-written access map, so what the Control Room shows is what the
// runner would really allow. Nothing is granted here: granting is a builder step, and code (the
// tool list and the gateway) decides what can be granted at all.
import { TOOL_LIST } from "@/core/tools/catalog";
import type { ToolDef, ToolGroup } from "@/core/tools/types";
import type { IntegrationId } from "./crew";
import type { McpId } from "@/core/mcp-rules";

export type ConnId = "shopify" | "mercury" | "gmail" | "notion" | "klaviyo" | "email" | "web" | "agents" | "control_room" | "math";
/** A server the owner added by its address (docs/custom-servers.md): its id is the connection's. */
export type CustomConnId = `c_${string}`;

/** One settings check. `tools` names the tools that need it when that isn't simply every tool of the connection. */
export interface Check { key: IntegrationId; label: string; setup: string; tools?: string[] }

export interface Connection {
  id: ConnId;
  name: string;
  sub: string;
  icon: string;
  /** Built into the Control Room: nothing to connect. */
  builtIn: boolean;
  /** What the connection is and its limits, in plain words. */
  about: string;
  /** The settings checks behind it (dashboard/data.ts health), each with a label when there is more than one. */
  checks: Check[];
  /** An MCP server (core/mcp-rules.ts): signed in with Connect on this page, not with a setting. */
  mcp?: McpId;
  /** More sign-ins shown on the same page (the gateway-only write sign-ins: Mercury writes, Gmail drafts). */
  mcpMore?: McpId[];
}

export const CONNECTIONS: Connection[] = [
  {
    id: "shopify", name: "Shopify", sub: "Orders, products, stock", icon: "shopping-bag", builtIn: false, mcp: "shopify",
    about: "Our own Shopify server, run in the app with the read-only custom app the business makes in Shopify. Each tool runs one fixed query written in code; no tool takes GraphQL and no change can run. A key whose app has any write scope is refused when you paste it. Order reads carry no customer names or addresses.",
    checks: [{ key: "shopify", label: "Store", setup: "Paste the read-only app’s key below, and set SHOPIFY_STORE_DOMAIN (and SHOPIFY_CLIENT_ID if the key is a client secret)." }],
  },
  {
    id: "mercury", name: "Mercury", sub: "Bank", icon: "landmark", builtIn: false, mcp: "mercury", mcpMore: ["mercury_write", "mercury_files"],
    about: "Mercury’s own MCP server, signed in with the read scope only, so this sign-in can’t use any tool that changes Mercury or moves money. Code may call only the read tools named in code (accounts, charges, categories). Sums are worked out in code. After you approve, the gateway sets a charge’s category and memo through its own Mercury sign-in (that one change only), and attaches the receipt file with a separate Mercury token, also locked in the vault, that only it uses.",
    checks: [{ key: "mercury", label: "Bank", setup: "Tap Connect and sign in to Mercury, picking the business’s Mercury org. Set MERCURY_ACCOUNT_IDS (all, or a comma list) for the cash number." }],
  },
  {
    id: "gmail", name: "Gmail", sub: "Receipts in, drafts out", icon: "mail", builtIn: false, mcp: "gmail_read", mcpMore: ["gmail"],
    about: "Our own Gmail server, run in the app. Google’s Gmail MCP server isn’t used: it’s a preview program and can’t download receipt files. Two separate Google sign-ins to the business’s mailbox, each granted one scope: one only reads (Quinn’s receipts), one only makes drafts and is used only by the gateway after you approve. There is no send tool, so you send every email from Gmail. Email is untrusted data.",
    checks: [
      { key: "gmail_read", label: "Receipts (read only)", setup: "Tap Connect under Gmail (read only) and sign in to the business’s mailbox. Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel.", tools: ["report_books_sync"] },
      { key: "gmail", label: "Drafts", tools: ["gmail_draft_lead"], setup: "Tap Connect under Gmail drafts and sign in to the same mailbox." },
    ],
  },
  {
    id: "notion", name: "Notion", sub: "Pages and the Briefs database", icon: "file-text", builtIn: false, mcp: "notion",
    about: "Our own Notion server, run in the app with the agents’ integration key, so it sees only pages and databases shared with that integration. Agents may read a page you link; code writes report pages under a page you pick, plus rows in Briefs and the Build Board. Notion’s hosted server isn’t used: it signs in as you and reaches your whole workspace.",
    checks: [{ key: "notion", label: "Workspace", setup: "Paste the integration’s key below, and set NOTION_BRIEF_PARENT_ID with that page shared with the integration. Set NOTION_BRIEFS_DB_ID too for brief rows, and NOTION_BUILD_BOARD_DB_ID for a Build Board card when you say yes to a new tool." }],
  },
  {
    id: "klaviyo", name: "Klaviyo", sub: "Email lists, campaigns, flows", icon: "send", builtIn: false, mcp: "klaviyo",
    about: "Klaviyo’s own MCP server, called by our runner with the server’s read-only switch on. Code may call only the read tools named in code (lists, a list’s size, campaign and flow results); nothing here can change Klaviyo. Counts and rates are added up in code.",
    checks: [{ key: "klaviyo", label: "Account", setup: "Tap Connect and sign in to Klaviyo as an Owner, Admin or Manager. Klaviyo signs in with its own page, so there is no key to paste." }],
  },
  {
    id: "email", name: "Email to you", sub: "Briefs and alerts", icon: "inbox", builtIn: false,
    about: "Sends through Resend to one address fixed in settings (BRIEF_TO). The code has no way to name anyone else.",
    checks: [{ key: "email", label: "Email", setup: "Set RESEND_API_KEY, BRIEF_FROM (a sender on a domain verified in Resend) and BRIEF_TO." }],
  },
  {
    id: "web", name: "The web", sub: "Search and read pages", icon: "globe", builtIn: false,
    about: "Claude’s own web search and fetch. Pages are written by strangers, so they are information only: a page never chooses a recipient, URL, product or category.",
    checks: [{ key: "web", label: "Web", setup: "Runs through the Claude API key (ANTHROPIC_API_KEY)." }],
  },
  {
    id: "agents", name: "Your other agents", sub: "What they saved on their last run", icon: "users", builtIn: true,
    about: "Every finished run is saved as an output other agents can pick as a source. Their words are untrusted; their numbers were traced by code.",
    checks: [{ key: "supabase", label: "Agent database", setup: "Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }],
  },
  {
    id: "control_room", name: "Control Room", sub: "Runs, numbers, leads, approvals", icon: "layout-dashboard", builtIn: true,
    about: "The agents’ own database: the run log, Morgan’s daily numbers, Rowan’s leads, approvals waiting. Each agent writes only its own tables.",
    checks: [{ key: "supabase", label: "Agent database", setup: "Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }],
  },
  {
    id: "math", name: "Math done in code", sub: "Days of cover, burn rate, margins", icon: "calculator", builtIn: true,
    about: "Plain code, no model. Money, margins and counts are always worked out here, never by the AI.",
    checks: [],
  },
];

export const CONN_BY_ID = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c])) as Record<ConnId, Connection>;

/** Which connection each tool group belongs to. */
type BuiltInGroup = Exclude<ToolGroup, "custom">;
const GROUP_CONN: Record<BuiltInGroup, ConnId> = {
  shopify: "shopify", mercury: "mercury", gmail: "gmail", klaviyo: "klaviyo", notion: "notion", email: "email", web: "web", agents: "agents", supabase: "control_room", calculate: "math",
};
/** For tools on the list in code. A custom server's tools belong to that server (dashboard/builder.ts customMenuFor). */
export const connOf = (t: ToolDef): ConnId => GROUP_CONN[t.group as BuiltInGroup];

/** The settings behind the Control Room itself, not something an agent is granted. */
export const BEHIND_THE_SCENES: { key: IntegrationId; name: string; icon: string; about: string; setup: string }[] = [
  { key: "claude", name: "Claude API", icon: "cpu", about: "The models agents think with. Spend is read from the run log.", setup: "Set ANTHROPIC_API_KEY." },
  { key: "supabase", name: "Supabase", icon: "database", about: "The agents’ database. Service role, server only.", setup: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
  { key: "vault", name: "Token vault", icon: "lock", about: "Locks every sign-in made with a Connect button, with a key of its own. Tokens are never shown, logged or given to a model.", setup: "Set MCP_SECRET_KEY (at least 32 characters, made with openssl rand -base64 32). Until then nothing can be connected." },
];

export type Ability = "read" | "do" | "hands";
const ABILITY: Record<ToolDef["kind"], Ability> = { read: "read", calculate: "read", action: "do", report: "hands" };
export const abilityOf = (t: ToolDef): Ability => ABILITY[t.kind];

/** One connection's tools, split the way the builder and this page show them. */
export function toolsOf(id: ConnId): Record<Ability, ToolDef[]> {
  const out: Record<Ability, ToolDef[]> = { read: [], do: [], hands: [] };
  for (const t of TOOL_LIST) if (connOf(t) === id) out[abilityOf(t)].push(t);
  return out;
}

/** Tool ids granted in each agent's active setup (agent_defs), by agent id. */
export type Grants = Record<string, string[]>;

export const isSetUp = (c: Connection, health: Record<IntegrationId, boolean>) => c.checks.every((k) => health[k.key]);

/** `ability` is the strongest one; `has` lists every kind it has there. */
export interface Reach { conn: Connection; ability: Ability; has: Ability[]; tools: string[]; by: Partial<Record<Ability, string[]>> }

/**
 * What one agent can reach, per connection: the strongest ability it has there (do, then hands,
 * then read) and the labels of the tools behind it. Empty when it has no saved setup.
 */
export function reachOf(agentId: string, grants: Grants): Reach[] {
  const ids = new Set(grants[agentId] ?? []);
  const rank: Record<Ability, number> = { read: 0, hands: 1, do: 2 };
  const by = new Map<ConnId, Reach>();
  for (const t of TOOL_LIST) {
    if (!ids.has(t.id)) continue;
    const c = CONN_BY_ID[connOf(t)];
    const ab = abilityOf(t);
    const cur = by.get(c.id) ?? { conn: c, ability: ab, has: [], tools: [], by: {} };
    if (rank[ab] > rank[cur.ability]) cur.ability = ab;
    if (!cur.has.includes(ab)) cur.has.push(ab);
    cur.tools.push(t.label);
    (cur.by[ab] ??= []).push(t.label);
    by.set(c.id, cur);
  }
  return CONNECTIONS.flatMap((c) => (by.has(c.id) ? [by.get(c.id)!] : []));
}

/** Agents that have at least one tool of this connection granted. */
export const usersOf = (id: ConnId, grants: Grants) => Object.keys(grants).filter((a) => grants[a].some((t) => TOOL_LIST.some((x) => x.id === t && connOf(x) === id)));

export const ABILITY_WORD: Record<Ability, string> = { read: "Reads", hands: "Hands you", do: "Asks first" };

/** Agents whose saved setup has a tool that needs this check. */
export function usersOfCheck(c: Connection, k: Check, grants: Grants): string[] {
  const need = new Set(k.tools ?? TOOL_LIST.filter((t) => connOf(t) === c.id).map((t) => t.id));
  return Object.keys(grants).filter((a) => grants[a].some((t) => need.has(t)));
}
