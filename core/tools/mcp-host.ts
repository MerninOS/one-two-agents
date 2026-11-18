// The in-app MCP server (docs/mcp-everywhere.md, slice 1). Pure: it is handed the tool list, so
// `npm run check:mcp` can test it with made-up tools.
//
// Every read and calculate call the runner makes goes through MCP: a JSON-RPC tools/call to this
// server, and the reply read back with the same code that reads a remote server's replies
// (core/mcp-rules.ts parseRpc, toolPayload). Requests and replies cross as JSON, as they would
// over a wire, so nothing but data passes. Report and action tools are not MCP tools: code
// delivers reports after a run, and actions are staged for the gateway.
//
// The server checks every input again (checkInput) and only serves tools that read or work
// numbers out. What a tool returns is the same ToolResult as before: data, numbers worked out in
// code, and picks.
import { MCP_PROTOCOL, parseRpc, toolPayload } from "@/core/mcp-rules";
import { checkInput, inputSchema, paramsOf, type ToolCtx, type ToolDef, type ToolResult } from "./types";

export const HOST_NAME = "operator-tools";
/** Where the caller's context rides on a request (MCP's `_meta`): who is calling, and what the spec allows. */
export const CTX_META = "operator/ctx";

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});

/** A tool this server serves: code runs it, it writes nothing, and it isn't one of Claude's own server tools. */
export const served = (t: ToolDef | undefined): t is ToolDef => !!t && (t.kind === "read" || t.kind === "calculate") && !!t.run && !t.server;

const EMPTY_CTX: ToolCtx = { agentId: "", notionPages: [], outputSources: [] };
function ctxOf(params: Json): ToolCtx {
  const c = obj(obj(params._meta)[CTX_META]);
  return {
    agentId: typeof c.agentId === "string" ? c.agentId : "",
    notionPages: Array.isArray(c.notionPages) ? (c.notionPages as ToolCtx["notionPages"]) : [],
    outputSources: Array.isArray(c.outputSources) ? (c.outputSources as ToolCtx["outputSources"]) : [],
    reportPage: (c.reportPage as ToolCtx["reportPage"]) ?? null,
    runId: typeof c.runId === "string" ? c.runId : null,
    granted: Array.isArray(c.granted) ? (c.granted as string[]) : undefined,
  };
}

/** Only finite numbers cross; a NaN would come back as null. */
const finite = (n?: Record<string, number>) => (n ? Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) : undefined);

/** A JSON-RPC handler over the given tools: initialize, tools/list and tools/call. */
export function createHost(tools: Readonly<Record<string, ToolDef>>) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const toolError = (id: unknown, message: string) => reply(id, { isError: true, content: [{ type: "text", text: message }] });

  return async function handle(raw: unknown): Promise<unknown> {
    const req = obj(raw) as Rpc;
    const id = req.id ?? null;
    const params = obj(req.params);
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return fail(id, -32600, "not a JSON-RPC 2.0 request");
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: HOST_NAME, version: "1" } });
      case "tools/list": {
        const ctx = ctxOf(params);
        return reply(id, {
          tools: Object.values(tools).filter(served).map((t) => ({
            name: t.id, title: t.label, description: `${t.label}. ${t.detail}.`,
            inputSchema: inputSchema(paramsOf(t, ctx)),
            annotations: { readOnlyHint: true, openWorldHint: !t.trusted },
          })),
        });
      }
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const t = tools[name];
        if (!served(t)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const ctx = ctxOf(params);
        const checked = checkInput(paramsOf(t, ctx), params.arguments);
        if ("problem" in checked) return toolError(id, `Input refused: ${checked.problem}`);
        try {
          const out = await t.run!(checked.input, ctx);
          const structured = { data: out.data ?? null, numbers: finite(out.numbers), picks: out.picks };
          return reply(id, { structuredContent: structured, content: [{ type: "text", text: JSON.stringify(structured) }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return fail(id, -32601, `no method ${req.method}`);
    }
  };
}

export type Handle = ReturnType<typeof createHost>;

let seq = 0;

/** One tools/call through `handle`, as JSON both ways, read back like any MCP server's reply. Throws the tool's own error. */
export async function callThrough(handle: Handle, name: string, input: Record<string, string | number>, ctx: ToolCtx): Promise<ToolResult> {
  const id = ++seq;
  const request = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input, _meta: { [CTX_META]: ctx } } });
  const body = JSON.stringify(await handle(JSON.parse(request)));
  const r = parseRpc("application/json", body, id);
  if ("error" in r) throw new Error(r.error);
  const out = toolPayload(r.result);
  if ("error" in out) throw new Error(out.error);
  const d = obj(out.data);
  return { data: d.data ?? null, ...(d.numbers ? { numbers: d.numbers as Record<string, number> } : {}), ...(d.picks ? { picks: d.picks as ToolResult["picks"] } : {}) };
}

/** tools/list through `handle`: the names, schemas and read-only flags the server offers. */
export async function listThrough(handle: Handle, ctx: ToolCtx = EMPTY_CTX): Promise<{ name: string; description: string; inputSchema: unknown; annotations: Json }[]> {
  const id = ++seq;
  const body = JSON.stringify(await handle({ jsonrpc: "2.0", id, method: "tools/list", params: { _meta: { [CTX_META]: ctx } } }));
  const r = parseRpc("application/json", body, id);
  if ("error" in r) throw new Error(r.error);
  return (obj(r.result).tools as { name: string; description: string; inputSchema: unknown; annotations: Json }[]) ?? [];
}
