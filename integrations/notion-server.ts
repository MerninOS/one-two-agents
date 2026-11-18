import "server-only";
// Our own Notion MCP server (docs/mcp-everywhere.md, slice 4). It runs in the app, speaks the same
// JSON-RPC as any MCP server (initialize, tools/list, tools/call), and is reached only through
// integrations/mcp.ts callLocalTool, which opens the key from the token vault for each call.
//
// Why our own: Notion's hosted server signs in as a person, reaches their whole workspace and has
// no read-only switch. This one uses the agents' internal integration key, so it sees only pages
// shared with that integration, and it offers only the tools named in core/mcp-rules.ts: two read
// tools, and four report tools that code (never a model) uses to write pages and rows the owner reads.
// Every request is checked again here (checkNotionArgs) before anything reaches Notion.
import { MCP_PROTOCOL, MCP_SERVERS } from "@/core/mcp-rules";
import { checkNotionArgs } from "@/core/notion-blocks";
import { archiveRow, createPage, createRow, me, pageText, rowOn, updateRow } from "./notion-api";

const P = MCP_SERVERS.notion;
const id32 = { type: "string", pattern: "^[0-9a-fA-F-]{32,36}$" };
const blocks = { type: "array", maxItems: 100, items: { type: "object", required: ["type"] } };
const props = { type: "object", minProperties: 1 };

/** What tools/list offers: exactly the profile's read and report tools. */
const TOOLS: Record<string, { description: string; readOnly: boolean; inputSchema: unknown }> = {
  notion_page_text: { readOnly: true, description: "A shared page's title and text (top level and one level down), cut at maxChars.", inputSchema: { type: "object", required: ["pageId"], properties: { pageId: id32, maxChars: { type: "integer", minimum: 100, maximum: 20000 } } } },
  notion_row_on: { readOnly: true, description: "The newest row of a shared database whose date property is that day, or null.", inputSchema: { type: "object", required: ["databaseId", "dateProp", "date"], properties: { databaseId: id32, dateProp: { type: "string", maxLength: 100 }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } } },
  notion_create_page: { readOnly: false, description: "A report page under a shared page.", inputSchema: { type: "object", required: ["parentId", "title"], properties: { parentId: id32, title: { type: "string" }, children: blocks } } },
  notion_create_row: { readOnly: false, description: "A report row in a shared database.", inputSchema: { type: "object", required: ["databaseId", "properties"], properties: { databaseId: id32, properties: props, children: blocks } } },
  notion_update_row: { readOnly: false, description: "Changes properties of a row in a shared database.", inputSchema: { type: "object", required: ["pageId", "properties"], properties: { pageId: id32, properties: props } } },
  notion_archive_row: { readOnly: false, description: "Moves a row of a shared database to Notion's trash (restorable for 30 days).", inputSchema: { type: "object", required: ["pageId"], properties: { pageId: id32 } } },
};
const OFFERED = [...P.readTools, ...P.reportTools] as readonly string[];

/** Checks a key before it is kept: Notion's key shape is checked by the caller, this asks Notion who it is. */
export const checkNotionKey = (token: string) => me(token);

/** A JSON-RPC handler for one call, with the key the vault opened. */
export function notionServer(token: string) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-notion", version: "1" } });
      case "tools/list":
        return reply(id, { tools: OFFERED.map((name) => ({ name, description: TOOLS[name].description, inputSchema: TOOLS[name].inputSchema, annotations: { readOnlyHint: TOOLS[name].readOnly, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!OFFERED.includes(name)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const a = checkNotionArgs(name, req.params?.arguments);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          let result: unknown;
          switch (a.tool) {
            case "notion_page_text": result = await pageText(token, a.pageId, a.maxChars); break;
            case "notion_row_on": result = await rowOn(token, a.databaseId, a.dateProp, a.date); break;
            case "notion_create_page": result = await createPage(token, a.parentId, a.title, a.children); break;
            case "notion_create_row": result = await createRow(token, a.databaseId, a.properties, a.children); break;
            case "notion_update_row": result = await updateRow(token, a.pageId, a.properties); break;
            case "notion_archive_row": result = await archiveRow(token, a.pageId); break;
          }
          return reply(id, { structuredContent: { result }, content: [{ type: "text", text: JSON.stringify({ result }) }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
