import "server-only";
// Our own Shopify MCP server (docs/mcp-everywhere.md, slice 7). Shopify's own MCP servers are for
// storefronts and building apps, not a read-only Admin view of one store, so Shopify runs here, like
// Notion and Gmail. It speaks the same JSON-RPC as any MCP server and is reached only through
// integrations/mcp.ts callLocalTool, which opens the read-only app's key from the token vault.
// Each tool runs one fixed query (core/shopify-queries.ts); there is no tool that takes GraphQL.
import { MCP_PROTOCOL, MCP_SERVERS } from "@/core/mcp-rules";
import { env } from "@/core/env";
import { SHOPIFY_QUERIES, shopifyKeyKind, shopifyVariables, writeScopes } from "@/core/shopify-queries";
import { shopifyQuery, whoIs } from "./shopify-api";

const OFFERED = MCP_SERVERS.shopify.readTools as readonly string[];
const TOOLS = Object.fromEntries(SHOPIFY_QUERIES.map((q) => [q.tool, q]));

/** Before a key is kept: its shape, which shop it opens, and that every scope it carries is a read. */
export async function checkShopifyKey(key: string): Promise<{ name: string; workspace: string }> {
  if (!shopifyKeyKind(key)) throw new Error("not an Admin API access token or a client secret");
  const w = await whoIs(key);
  const bad = writeScopes(w.scopes);
  if (bad.length) throw new Error(`this app can change the store (${bad.slice(0, 6).join(", ")}). Use the read-only app, with read scopes only`);
  if (env.shopifyDomain && w.domain !== env.shopifyDomain) throw new Error(`it opens ${w.domain}, not ${env.shopifyDomain}`);
  return { name: w.name, workspace: `${w.domain}, ${w.scopes.length} read scopes` };
}

/** A JSON-RPC handler for one call, with the key the vault opened. */
export function shopifyServer(key: string) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-shopify", version: "1" } });
      case "tools/list":
        return reply(id, { tools: OFFERED.map((name) => ({ name, description: TOOLS[name].description, inputSchema: TOOLS[name].inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!OFFERED.includes(name)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const v = shopifyVariables(name, req.params?.arguments, { stockCollection: env.shopifyStockCollection ?? "" });
        if ("problem" in v) return toolError(id, `Input refused: ${v.problem}`);
        try {
          const result = await shopifyQuery(key, v.doc, v.variables);
          return reply(id, { structuredContent: { result }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
