// One Two's reads on our Shopify server: the storefront's own fields (namespace "blended": green
// lots, our coffees, the roasting board, each order's green usage). Pure. Each tool is one fixed read
// query, held to the same rules as core's (core/shopify-rules.ts): no caller writes a search, every
// document is checked read-only, and none reads customer names, emails or addresses. Registered in
// templates/registry.ts; field contract with the storefront in ./README.md.
import { CORE_SHOPIFY, SHOPIFY_INPUTS, afterArg, dayArg, gql, type ShopifyQuery } from "@/core/shopify-rules";

const { day, after } = SHOPIFY_INPUTS;
const none = { type: "object", properties: {} };

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

// Morgan's day of orders: core's day of orders plus the green each order took.
const GREEN_BETWEEN = gql`
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

const coreBetween = CORE_SHOPIFY.find((q) => q.tool === "shopify_orders_between")!;
const sinceVars = (a: Record<string, unknown>, query: (since: string) => string, paged: boolean) => {
  const since = dayArg(a, "since"), cur = afterArg(a);
  if (cur === undefined) return { problem: "after must be a cursor from the last page" };
  if (!since) return { problem: "since must be YYYY-MM-DD" };
  return { variables: paged ? { query: query(since), after: cur } : { query: query(since) } };
};

export const ONE_TWO_SHOPIFY: readonly ShopifyQuery[] = [
  { tool: "shopify_green_lots", description: "Every green lot (products tagged blended-green, not archived) with grams in stock and its blended.* fields.", inputSchema: none, doc: GREEN_LOTS,
    variables: () => ({ variables: { query: "tag:blended-green AND -status:archived" } }) },
  { tool: "shopify_stock_coffees", description: "The products in Our coffees, with variants, prices and blended.* fields.", inputSchema: none, doc: STOCK,
    variables: (_a, ctx) => {
      const handle = ctx.stockCollection || "our-coffees";
      return /^[a-z0-9-]{1,100}$/.test(handle) ? { variables: { handle } } : { problem: "SHOPIFY_STOCK_COLLECTION isn't a collection handle" };
    } },
  { tool: "shopify_shop_settings", description: "The storefront's settings (shop metafield blended.settings).", inputSchema: none, doc: SHOP, variables: () => ({ variables: {} }) },
  { tool: "shopify_recent_orders", description: "Up to 100 orders since a day, newest first, with green usage and line items. No customer details.", inputSchema: { type: "object", required: ["since"], properties: { since: day } }, doc: RECENT,
    variables: (a) => sinceVars(a, (s) => `created_at:>=${s}`, false) },
  { tool: "shopify_board_orders", description: "Storefront orders since a day with their tags and fulfillment status, 100 a page. No customer details.", inputSchema: { type: "object", required: ["since"], properties: { since: day, after } }, doc: BOARD,
    variables: (a) => sinceVars(a, (s) => `tag:blended created_at:>=${s}`, true) },
  { tool: "shopify_green_orders_between", description: "Orders from one day up to another, 100 a page, with totals, line items and green usage. No names or addresses.", inputSchema: coreBetween.inputSchema, doc: GREEN_BETWEEN,
    variables: coreBetween.variables },
];
