import "server-only";
// Connections (docs/builder-flow.md, slice 1): the one place that says which integrations One Two has, what
// each lets an agent read, do and hand Zak, and which agents have each of those in their saved
// setup. It replaces the hand-written access map, so what the Control Room shows is what the
// runner would really allow. Nothing is granted here: granting is a builder step, and code (the
// tool list and the gateway) decides what can be granted at all.
import { TOOL_LIST } from "@/core/tools/catalog";
import type { ToolDef, ToolGroup } from "@/core/tools/types";
import type { IntegrationId } from "./crew";

export type ConnId = "shopify" | "mercury" | "gmail" | "notion" | "email" | "web" | "agents" | "control_room" | "math";

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
}

export const CONNECTIONS: Connection[] = [
  {
    id: "shopify", name: "Shopify", sub: "Orders, products, stock", icon: "shopping-bag", builtIn: false,
    about: "Read-only app “One Two Agents (read)”. Nothing here can change the store.",
    checks: [{ key: "shopify", label: "Store", setup: "Needs SHOPIFY_STORE_DOMAIN and the read-only app’s token (or its client id and secret)." }],
  },
  {
    id: "mercury", name: "Mercury", sub: "Bank", icon: "landmark", builtIn: false,
    about: "A read-only token for balances, charges and categories. A second token, held only by the gateway, writes a receipt, category or memo on an existing charge after you approve. Nothing can move money yet.",
    checks: [{ key: "mercury", label: "Bank", setup: "Needs MERCURY_API_TOKEN and MERCURY_ACCOUNT_IDS (all, or a comma list)." }],
  },
  {
    id: "gmail", name: "Gmail", sub: "Receipts in, drafts out", icon: "mail", builtIn: false,
    about: "Two separate tokens for zak@onetwocoffeelab.com: one that only reads (receipts), one that only writes drafts. Neither can send. Email is untrusted data.",
    checks: [
      { key: "gmail", label: "Drafts", tools: ["gmail_draft_lead"], setup: "Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN (gmail.compose only)." },
      { key: "gmail_read", label: "Receipts (read only)", setup: "Set GMAIL_RECEIPTS_REFRESH_TOKEN: a refresh token from the same OAuth client, granted only gmail.readonly.", tools: ["report_books_sync"] },
    ],
  },
  {
    id: "notion", name: "Notion", sub: "Pages and the Briefs database", icon: "file-text", builtIn: false,
    about: "Reads pages you link and writes pages under a page you pick, plus rows in Briefs. Nothing else in the workspace.",
    checks: [{ key: "notion", label: "Workspace", setup: "Needs NOTION_TOKEN and NOTION_BRIEF_PARENT_ID, with the page shared with the integration. Set NOTION_BRIEFS_DB_ID too for brief rows." }],
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
const GROUP_CONN: Record<ToolGroup, ConnId> = {
  shopify: "shopify", mercury: "mercury", gmail: "gmail", notion: "notion", email: "email", web: "web", agents: "agents", supabase: "control_room", calculate: "math",
};
export const connOf = (t: ToolDef): ConnId => GROUP_CONN[t.group];

/** The settings behind the Control Room itself, not something an agent is granted. */
export const BEHIND_THE_SCENES: { key: IntegrationId; name: string; icon: string; about: string; setup: string }[] = [
  { key: "claude", name: "Claude API", icon: "cpu", about: "The models agents think with. Spend is read from the run log.", setup: "Set ANTHROPIC_API_KEY." },
  { key: "supabase", name: "Supabase", icon: "database", about: "The agents’ database. Service role, server only.", setup: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
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
