// Find a tool and connector requests (docs/custom-servers.md, slice 3). Pure: no database, no
// network, so `npm run check:proposals` can test it.
//
// When an agent needs something no connection has, the owner can use one that's connected, add a
// server by its address, or ask for a built-in connector. Asks are counted per service, one Build
// Board card each, so what people ask for most is what gets built next. Adding a server by address
// always counts as an ask for that service too.

/** A service, as code compares asks: lowercase letters and digits only. "Post Hog" and "posthog" are one. */
export function serviceKey(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
}

const LINK = /https?:\/\/|www\.|<|>/i;

/** The service's name, as the owner typed it. */
export function checkServiceName(s: string): { name: string; key: string } | { problem: string } {
  const name = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return { problem: "Name the service, like PostHog or Square." };
  if (name.length > 60) return { problem: "Keep the service’s name under 60 characters." };
  if (LINK.test(name)) return { problem: "Just the name, no link." };
  const key = serviceKey(name);
  if (!key) return { problem: "Use letters or numbers in the name." };
  return { name, key };
}

/** What it should read, in a line. */
export function checkWhat(s: string): { what: string } | { problem: string } {
  const what = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (what.length < 5) return { problem: "Say in a few words what agents should read from it." };
  if (what.length > 300) return { problem: "Keep it under 300 characters." };
  if (LINK.test(what)) return { problem: "Leave links out." };
  return { what };
}

/**
 * Servers we know about, by name and address. Kept in code so an address never comes from an
 * agent's words or a web page. Not vetted: each is run by its own company, and adding one still
 * goes through the warning and every check on Connections. `builtIn` names the built-in connection
 * for a service the business already connects another way, so Find a tool sends you there instead.
 */
export interface KnownServer { key: string; name: string; url: string | null; docs: string; reads: string; builtIn?: "shopify" | "mercury" | "gmail" | "notion" | "klaviyo" }
export const KNOWN_SERVERS: readonly KnownServer[] = [
  { key: "posthog", name: "PostHog", url: "https://mcp.posthog.com/mcp", docs: "https://posthog.com/docs/model-context-protocol", reads: "Product and web analytics: insights, funnels, events" },
  { key: "stripe", name: "Stripe", url: "https://mcp.stripe.com", docs: "https://docs.stripe.com/mcp", reads: "Payments, customers, subscriptions" },
  { key: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", docs: "https://linear.app/docs/mcp", reads: "Issues and projects" },
  { key: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", docs: "https://docs.sentry.io/product/sentry-mcp/", reads: "Errors and performance" },
  { key: "vercel", name: "Vercel", url: "https://mcp.vercel.com", docs: "https://vercel.com/docs/mcp/vercel-mcp", reads: "Deployments, logs, Web Analytics (its sign-in reaches the whole team)" },
  { key: "cloudflare", name: "Cloudflare", url: "https://mcp.cloudflare.com/mcp", docs: "https://developers.cloudflare.com/agents/model-context-protocol/", reads: "Your Cloudflare account" },
  { key: "klaviyo", name: "Klaviyo", url: null, docs: "", reads: "Lists, campaigns, flows", builtIn: "klaviyo" },
  { key: "mercury", name: "Mercury", url: null, docs: "", reads: "Bank accounts and charges", builtIn: "mercury" },
  { key: "notion", name: "Notion", url: null, docs: "", reads: "Pages and databases", builtIn: "notion" },
  { key: "shopify", name: "Shopify", url: null, docs: "", reads: "Orders, products, stock", builtIn: "shopify" },
  { key: "gmail", name: "Gmail", url: null, docs: "", reads: "Receipts in, drafts out", builtIn: "gmail" },
];
/** The known server at this address (same host), so "PostHog prod" added at PostHog's address counts as PostHog. */
export function knownByAddress(url: string): KnownServer | null {
  let host: string;
  try { host = new URL(url).host.toLowerCase(); } catch { return null; }
  return KNOWN_SERVERS.find((k) => k.url && new URL(k.url).host === host) ?? null;
}
export const knownServer = (key: string | null | undefined): KnownServer | null => (key ? KNOWN_SERVERS.find((k) => k.key === serviceKey(key)) ?? null : null);

/** One ask, kept on the request: who, what for, when, and the proposal it came from. */
export interface Ask { by: string; what: string; at: string; proposal?: string | null }
export const MAX_ASKS_KEPT = 20;
/** The newest asks first, at most MAX_ASKS_KEPT. */
export const withAsk = (asks: readonly Ask[], a: Ask): Ask[] => [a, ...asks].slice(0, MAX_ASKS_KEPT);

/** The Build Board card's title: the service and how many times it was asked for. */
export const requestCardName = (name: string, asks: number) => `Connector: ${name}${asks > 1 ? ` (${asks} asks)` : ""}`;

export const REQUEST_CARD = { status: "Backlog", owner: "Claude", track: "Agent builder" } as const;
export interface RequestCard { name: string; sections: { heading: string; lines: string[] }[] }

/** The card for a service's first ask, so any Claude thread can pick it up cold. Same shape as the board's other cards. */
export function requestCard(c: { name: string; ask: Ask; date: string; link: string | null; known: KnownServer | null }): RequestCard {
  return {
    name: requestCardName(c.name, 1),
    sections: [
      { heading: "Why", lines: [`${c.ask.by} asked for ${c.name} on ${c.date}: ${c.ask.what}`, "Each later ask raises the count in this card's title."] },
      { heading: "Where things stand today", lines: [
        c.known?.url ? `${c.name} has an MCP server we know of (${c.known.url}); the owner can add it on Connections today, as a custom server.` : `No built-in connector for ${c.name}. The owner can add its MCP server on Connections if it has one.`,
        ...(c.link ? [`Requests: ${c.link}`] : []),
      ] },
      { heading: "What to build", lines: [
        `A built-in connector for ${c.name}: a profile in core/mcp-rules.ts with its read tools named in code, or our own server when the hosted one reaches more than agents need.`,
        "Then name it in KNOWN_SERVERS (core/connector-rules.ts) with builtIn, so Find a tool sends people there and the request shows A built-in connector is ready.",
      ] },
      { heading: "Rules that apply", lines: [
        "Read only. Writes come only as gateway action types, starting at Draft.",
        "Numbers are computed in code, not by a model.",
        "Outside data is untrusted: it never chooses a recipient, URL, product or category.",
      ] },
      { heading: "Done when", lines: ["The connector is merged and the owner closes the request (that moves this card to Done)."] },
      { heading: "Before you start", lines: ["Read CLAUDE.md, docs/mcp-everywhere.md and docs/custom-servers.md."] },
    ],
  };
}
