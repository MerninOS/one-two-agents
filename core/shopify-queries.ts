// Every tool our own Shopify MCP server serves (docs/mcp-everywhere.md, slice 7): core's
// (core/shopify-rules.ts), one fixed read query each. Pure, so `npm run check:mcp` can test them. The Shopify profile's read tools
// (core/mcp-rules.ts) are exactly these names.
import { CORE_SHOPIFY, type ShopifyCtx, type ShopifyQuery } from "@/core/shopify-rules";

export { WHO, assertReadOnly, gql, shopifyKeyKind, writeScopes } from "@/core/shopify-rules";

/** Core's tools, each named shopify_… and served once. */
export const SHOPIFY_QUERIES: readonly ShopifyQuery[] = (() => {
  const all = [...CORE_SHOPIFY];
  const seen = new Set<string>();
  for (const q of all) {
    if (!/^shopify_[a-z_]{2,60}$/.test(q.tool)) throw new Error(`${q.tool}: a Shopify tool is named shopify_…`);
    if (seen.has(q.tool)) throw new Error(`${q.tool} is served twice`);
    seen.add(q.tool);
  }
  return all;
})();
export const SHOPIFY_TOOLS: readonly string[] = SHOPIFY_QUERIES.map((q) => q.tool);
/** Each tool's one document, by tool name. */
export const SHOPIFY_DOCS: Readonly<Record<string, string>> = Object.fromEntries(SHOPIFY_QUERIES.map((q) => [q.tool, q.doc]));

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The checked variables for one tool, or why not. `ctx` comes from settings, never a caller. */
export function shopifyVariables(tool: string, raw: unknown, ctx: ShopifyCtx): { tool: string; doc: string; variables: Record<string, unknown> } | { problem: string } {
  const q = SHOPIFY_QUERIES.find((x) => x.tool === tool);
  if (!q) return { problem: `${tool} isn't a Shopify tool` };
  const v = q.variables(obj(raw), ctx);
  return "problem" in v ? v : { tool, doc: q.doc, variables: v.variables };
}
