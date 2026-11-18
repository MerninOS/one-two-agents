import "server-only";
// Receipt files onto an existing Mercury charge (docs/mcp-everywhere.md, slices 5b and 8). Mercury's
// MCP server can only upload a receipt and let Mercury pick the charge, so this one write runs on our
// own small server in the app. Its key (a Mercury Custom token with transaction write scope) is
// pasted on Connections into the token vault, and only core/gateway reaches it, through
// callWriteTool, after an approver approves. One tool: attach a file to the charge named. No endpoint that
// creates, cancels or moves money is here, and none may be added. Only integrations/mcp.ts imports
// this file (lint enforces it).
import { MCP_PROTOCOL, checkedTools } from "@/core/mcp-rules";
import { checkReceiptArgs, looksLikeMercuryToken } from "@/core/mercury-rules";

const BASE = "https://api.mercury.com/api/v1";
const TIMEOUT_MS = 25_000;
const OFFERED = checkedTools("mercury_files");

/** Before the key is kept: its shape, and that Mercury accepts it (401 = refused). Says whether it can also read. */
export async function checkMercuryFilesKey(key: string): Promise<{ name: string; workspace: string }> {
  if (!looksLikeMercuryToken(key)) throw new Error("not a Mercury API token (secret-token:mercury_…)");
  const res = await fetch(`${BASE}/accounts`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  if (res.status === 401) throw new Error("Mercury 401: the token wasn't accepted");
  return { name: "Mercury receipt token", workspace: res.ok ? "it can also read accounts" : "write only" };
}

/** A JSON-RPC handler for one call, with the key the vault opened. */
export function mercuryFilesServer(key: string) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-mercury-files", version: "1" } });
      case "tools/list":
        return reply(id, { tools: OFFERED.map((name) => ({ name, description: "Attaches one receipt file to an existing Mercury charge.", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!OFFERED.includes(name)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const a = checkReceiptArgs(req.params?.arguments);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          const form = new FormData();
          form.append("file", new Blob([a.bytes as BlobPart], { type: a.type }), a.name);
          form.append("attachmentType", "receipt");
          const res = await fetch(`${BASE}/transaction/${a.transactionId}/attachments`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: form });
          if (!res.ok) throw new Error(`Mercury ${res.status} on attach receipt: ${(await res.text().catch(() => "")).slice(0, 200)}`);
          const j = await res.json().catch(() => ({})) as { attachmentId?: string };
          return reply(id, { structuredContent: { result: { attachmentId: j.attachmentId ?? null } }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
