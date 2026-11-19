// The rules every Shopify query on our own MCP server follows (docs/mcp-everywhere.md, slice 7).
// Pure, so the server and the checks can both build on it. There is no
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
/** Settings a query may use; they come from the business's settings, never a caller. */
export type ShopifyCtx = {
  /** The collections agents may read product facts from (Settings), by handle. */
  productCollections: readonly string[];
  /** The product fields (namespace.key) read with them (Settings). */
  productFields: readonly string[];
};

/**
 * Shopify returns every metafield when `keys` is empty, so a business that chose no fields sends a
 * key no store can have (namespaces must be at least 3 characters): no field leaves Shopify.
 */
export const NO_FIELDS_KEY = "__.none";
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

/** The pasted key: the app's Admin API access token, or the client secret of a Dev Dashboard app (its client id is on Settings). */
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
        id name tags cancelledAt sourceName
        totalPriceSet { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        customer { numberOfOrders }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// The same days' orders with each line's quantity and its product's unit cost in Shopify (today's
// cost), for cost of goods when the business picked Shopify's unit cost (docs/daily-numbers.md). A
// separate tool, so a key that can't read inventory costs never stops the orders read above.
const ORDER_COSTS = gql`
  query AgentOrderCosts($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, query: $query) {
      nodes {
        cancelledAt
        lineItems(first: 100) { nodes { quantity variant { inventoryItem { unitCost { amount } } } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Open orders that aren't fully shipped, by Shopify's own fulfillment status, for the morning brief.
// Order numbers and status only: no customer, address or money fields.
const OPEN_ORDERS = gql`
  query AgentOpenOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes { name cancelledAt displayFulfillmentStatus }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// The products in one collection the business chose, with only the product fields it chose. No
// customer, order or cost data, unless the business itself lists a cost field (Settings says not to).
const PRODUCT_FACTS = gql`
  query AgentProductFacts($handle: String!, $keys: [String!]!) {
    collectionByIdentifier(identifier: { handle: $handle }) {
      handle title
      products(first: 100, sortKey: COLLECTION_DEFAULT) {
        nodes {
          handle title description productType vendor tags status tracksInventory totalInventory
          priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
          metafields(first: 20, keys: $keys) { nodes { namespace key value } }
        }
      }
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
  {
    tool: "shopify_order_costs",
    description: "Orders from one day up to another, 100 a page, with each line's quantity and its product's unit cost in Shopify today. No names, addresses or prices.",
    inputSchema: { type: "object", required: ["start", "end"], properties: { start: day, end: day, after } },
    doc: ORDER_COSTS,
    variables: (a) => {
      const start = dayArg(a, "start"), end = dayArg(a, "end"), cur = afterArg(a);
      if (cur === undefined) return { problem: "after must be a cursor from the last page" };
      if (!start || !end || end <= start) return { problem: "start and end must be YYYY-MM-DD, end after start" };
      return { variables: { query: createdBetween(start, end), after: cur } };
    },
  },
  {
    tool: "shopify_open_orders",
    description: "Open orders placed since a day that aren't fully shipped, 100 a page: order number and Shopify's fulfillment status only.",
    inputSchema: { type: "object", required: ["since"], properties: { since: day, after } },
    doc: OPEN_ORDERS,
    variables: (a) => {
      const since = dayArg(a, "since"), cur = afterArg(a);
      if (cur === undefined) return { problem: "after must be a cursor from the last page" };
      if (!since) return { problem: "since must be YYYY-MM-DD" };
      return { variables: { query: `status:open AND created_at:>='${since}T00:00:00${offsetOn(since)}' AND (fulfillment_status:unshipped OR fulfillment_status:partial)`, after: cur } };
    },
  },
  {
    tool: "shopify_product_facts",
    description: "The active products in one collection the business chose on Settings, with only the product fields it chose. The collection must be one of those; nothing else is read.",
    inputSchema: { type: "object", required: ["collection"], properties: { collection: { type: "string", maxLength: 100 } } },
    doc: PRODUCT_FACTS,
    variables: (a, ctx) => {
      const handle = typeof a.collection === "string" ? a.collection.trim().toLowerCase() : "";
      if (!ctx.productCollections.length) return { problem: "no collections are chosen on Settings › What agents may say about your products" };
      if (!ctx.productCollections.includes(handle)) return { problem: "collection must be one of the collections chosen on Settings" };
      return { variables: { handle, keys: ctx.productFields.length ? [...ctx.productFields] : [NO_FIELDS_KEY] } };
    },
  },
];
