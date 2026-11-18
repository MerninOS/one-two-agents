// The rules every Shopify query on our own MCP server follows (docs/mcp-everywhere.md, slice 7).
// Pure, with no imports from packs, so core and template packs can both build on it. There is no
// "run any GraphQL" tool: a model or agent picks a tool, never a query, and each tool's variables
// are built in code from checked inputs. Every document is a read (`assertReadOnly`, and
// scripts/validate-graphql.mjs against Shopify's schema), and the app's key is refused at paste time
// if it carries any scope that isn't a read.
import { offsetOn } from "@/core/time";

/** Identity tag so scripts/validate-graphql.mjs can find and check every document. */
export const gql = String.raw;

type Json = Record<string, unknown>;
/** What a query's variables builder sees: the caller's raw input, already an object. */
export type ShopifyArgs = Json;
/** Settings a query may use; they come from the app's settings, never a caller. */
export type ShopifyCtx = { stockCollection: string };
export type ShopifyVars = { variables: Record<string, unknown> } | { problem: string };

/** One tool on our Shopify server: one fixed read query and the checks on its inputs. */
export interface ShopifyQuery {
  tool: string;
  description: string;
  inputSchema: unknown;
  doc: string;
  variables: (args: ShopifyArgs, ctx: ShopifyCtx) => ShopifyVars;
}

/** A document is one query: no mutation or subscription anywhere in it. Our server refuses anything else. */
export function assertReadOnly(doc: string): void {
  const body = doc.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#[^\n]*/g, "");
  let depth = 0, end = -1;
  for (let i = 0; i < body.length && end < 0; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) end = i;
  }
  const single = end > 0 && body.slice(end + 1).trim() === "";
  if (!/^\s*query\s+[A-Za-z_]\w*/.test(body) || /\b(mutation|subscription)\b/.test(body) || !single) throw new Error("only a single query may run on Shopify");
}

/** Every scope is a read (read_* or unauthenticated_read_*). A key with any other scope is refused. */
export const writeScopes = (handles: readonly string[]) => handles.filter((h) => !/^(unauthenticated_)?read_[a-z_]+$/.test(h));

/** The pasted key: the app's Admin API access token, or the client secret of a Dev Dashboard app (its client id is SHOPIFY_CLIENT_ID). */
export function shopifyKeyKind(key: string): "token" | "secret" | null {
  if (/^shpat_[A-Za-z0-9]{20,100}$/.test(key)) return "token";
  if (/^(shpss_)?[A-Za-z0-9_-]{24,100}$/.test(key)) return "secret";
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,500}$/;
/** A YYYY-MM-DD input, or null. */
export const dayArg = (a: ShopifyArgs, k: string): string | null =>
  typeof a[k] === "string" && DAY.test(a[k] as string) && !Number.isNaN(Date.parse(a[k] as string)) ? (a[k] as string) : null;
/** A page cursor from the last page: null for the first page, undefined when it isn't a cursor. */
export const afterArg = (a: ShopifyArgs): string | null | undefined =>
  a.after == null ? null : typeof a.after === "string" && CURSOR.test(a.after) ? a.after : undefined;
/** The search for orders from one business-day up to another (the app's time zone). */
export const createdBetween = (start: string, end: string) => `created_at:>='${start}T00:00:00${offsetOn(start)}' created_at:<'${end}T00:00:00${offsetOn(end)}'`;

const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const after = { type: "string", maxLength: 500 };
/** JSON schemas for the inputs queries share. */
export const SHOPIFY_INPUTS = { day, after } as const;

// Checked when a key is pasted: which shop it is, and every scope the app was granted.
export const WHO = gql`
  query AgentWhoAmI { shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } }
`;

// A day's orders for any store: totals, whether the customer is new, and the lines. No names or addresses.
const BETWEEN = gql`
  query AgentOrdersBetween($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, query: $query) {
      nodes {
        id name tags cancelledAt
        totalPriceSet { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        customer { numberOfOrders }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Core's Shopify tools: what every business on Shopify can read. */
export const CORE_SHOPIFY: readonly ShopifyQuery[] = [
  {
    tool: "shopify_orders_between",
    description: "Orders from one day up to another (the app's time zone), 100 a page, with totals and line items. No names or addresses.",
    inputSchema: { type: "object", required: ["start", "end"], properties: { start: day, end: day, after } },
    doc: BETWEEN,
    variables: (a) => {
      const start = dayArg(a, "start"), end = dayArg(a, "end"), cur = afterArg(a);
      if (cur === undefined) return { problem: "after must be a cursor from the last page" };
      if (!start || !end || end <= start) return { problem: "start and end must be YYYY-MM-DD, end after start" };
      return { variables: { query: createdBetween(start, end), after: cur } };
    },
  },
];
