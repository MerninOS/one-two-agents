// Shopify on our own MCP server (docs/mcp-everywhere.md, slice 7). Pure: every query our Shopify
// server may run, one per tool, and the checks on each tool's inputs, so `npm run check:mcp` can
// test them. There is no "run any GraphQL" tool: a model or agent picks a tool, never a query, and
// each tool's variables are built here from checked inputs. Every document is a read
// (`assertReadOnly`, and scripts/validate-graphql.mjs against Shopify's schema), and the app's key
// is refused at paste time if it carries any scope that isn't a read.
import { offsetOn } from "@/core/time";

/** Identity tag so scripts/validate-graphql.mjs can find and check every document. */
export const gql = String.raw;

const GREEN_LOTS = gql`
  query AgentGreenLots($query: String!) {
    products(first: 250, query: $query, sortKey: TITLE) {
      nodes {
        id handle title status
        variants(first: 1) { nodes { inventoryQuantity } }
        origin: metafield(namespace: "blended", key: "origin") { value }
        lot_code: metafield(namespace: "blended", key: "lot_code") { value }
        process: metafield(namespace: "blended", key: "process") { value }
        roast_level: metafield(namespace: "blended", key: "roast_level") { value }
        green_price: metafield(namespace: "blended", key: "green_price") { value }
        wholesale_price: metafield(namespace: "blended", key: "wholesale_price") { value }
        retail_price: metafield(namespace: "blended", key: "retail_price") { value }
      }
    }
  }
`;

const STOCK = gql`
  query AgentStockCoffees($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) {
      products(first: 50, sortKey: COLLECTION_DEFAULT) {
        nodes {
          id handle title description status
          variants(first: 10) { nodes { id price availableForSale selectedOptions { name value } } }
          roast: metafield(namespace: "blended", key: "roast_level") { value }
          wholesale: metafield(namespace: "blended", key: "wholesale_price") { value }
          subtitle: metafield(namespace: "blended", key: "subtitle") { value }
          kind: metafield(namespace: "blended", key: "kind") { value }
          recipe: metafield(namespace: "blended", key: "recipe") { value }
        }
      }
    }
  }
`;

const SHOP = gql`
  query AgentShopSettings { shop { metafield(namespace: "blended", key: "settings") { value } } }
`;

const RECENT = gql`
  query AgentGreenRecentOrders($query: String!) {
    orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        id name createdAt tags cancelledAt
        usage: metafield(namespace: "blended", key: "green_usage") { value }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
    }
  }
`;

// Only what the brief counts: no customer names, emails or addresses.
const BOARD = gql`
  query AgentBoardOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes { id name tags cancelledAt displayFulfillmentStatus }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Morgan's day of orders: totals, whether the customer is new, and the green each order took. No names or addresses.
const BETWEEN = gql`
  query CfoOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, query: $query) {
      nodes {
        id name tags cancelledAt
        totalPriceSet { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        customer { numberOfOrders }
        usage: metafield(namespace: "blended", key: "green_usage") { value }
        lineItems(first: 100) { nodes { quantity sku variant { id } customAttributes { key value } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Checked when a key is pasted: which shop it is, and every scope the app was granted.
export const WHO = gql`
  query AgentWhoAmI { shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } }
`;

/** Each tool's one document, by tool name (the profile's read tools in core/mcp-rules.ts). */
export const SHOPIFY_DOCS = {
  shopify_green_lots: GREEN_LOTS,
  shopify_stock_coffees: STOCK,
  shopify_shop_settings: SHOP,
  shopify_recent_orders: RECENT,
  shopify_board_orders: BOARD,
  shopify_orders_between: BETWEEN,
} as const;
export type ShopifyTool = keyof typeof SHOPIFY_DOCS;

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

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,500}$/;
type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});

/** The checked variables for one tool, or why not. `stockHandle` comes from settings, never a caller. */
export function shopifyVariables(tool: string, raw: unknown, stockHandle: string): { tool: ShopifyTool; variables: Record<string, unknown> } | { problem: string } {
  const a = obj(raw);
  const day = (k: string) => (typeof a[k] === "string" && DAY.test(a[k] as string) && !Number.isNaN(Date.parse(a[k] as string)) ? (a[k] as string) : null);
  const after = a.after == null ? null : typeof a.after === "string" && CURSOR.test(a.after) ? a.after : undefined;
  if (after === undefined) return { problem: "after must be a cursor from the last page" };
  switch (tool) {
    case "shopify_green_lots": return { tool, variables: { query: "tag:blended-green AND -status:archived" } };
    case "shopify_stock_coffees":
      if (!/^[a-z0-9-]{1,100}$/.test(stockHandle)) return { problem: "SHOPIFY_STOCK_COLLECTION isn't a collection handle" };
      return { tool, variables: { handle: stockHandle } };
    case "shopify_shop_settings": return { tool, variables: {} };
    case "shopify_recent_orders": {
      const since = day("since");
      return since ? { tool, variables: { query: `created_at:>=${since}` } } : { problem: "since must be YYYY-MM-DD" };
    }
    case "shopify_board_orders": {
      const since = day("since");
      return since ? { tool, variables: { query: `tag:blended created_at:>=${since}`, after } } : { problem: "since must be YYYY-MM-DD" };
    }
    case "shopify_orders_between": {
      const start = day("start"), end = day("end");
      if (!start || !end || end <= start) return { problem: "start and end must be YYYY-MM-DD, end after start" };
      return { tool, variables: { query: `created_at:>='${start}T00:00:00${offsetOn(start)}' created_at:<'${end}T00:00:00${offsetOn(end)}'`, after } };
    }
    default:
      return { problem: `${tool} isn't a Shopify tool` };
  }
}

/** The pasted key: the app's Admin API access token, or the client secret of a Dev Dashboard app (its client id is SHOPIFY_CLIENT_ID). */
export function shopifyKeyKind(key: string): "token" | "secret" | null {
  if (/^shpat_[A-Za-z0-9]{20,100}$/.test(key)) return "token";
  if (/^(shpss_)?[A-Za-z0-9_-]{24,100}$/.test(key)) return "secret";
  return null;
}
