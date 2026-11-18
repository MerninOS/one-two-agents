import "server-only";
// Our own Gmail MCP server (docs/mcp-everywhere.md, slice 6). Google's Gmail MCP server is a
// preview program, has no self-registration and can't download attachments (Quinn reads receipt
// files), so Gmail runs here, like Notion. It speaks the same JSON-RPC as any MCP server and is
// reached only through integrations/mcp.ts, which opens the sign-in for the profile being called:
// "Gmail (read only)" (gmail.readonly) or "Gmail drafts" (gmail.compose, used only by the gateway).
// It serves only the tools that profile names, so a read sign-in can never reach the draft tool.
// There is no send tool. Every request is checked again (checkGmailArgs).
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { checkGmailArgs } from "@/core/gmail-rules";
import { attachment, createDraft, mailbox, message, search } from "./gmail-api";

const DESCRIPTIONS: Record<string, { description: string; readOnly: boolean }> = {
  gmail_search: { readOnly: true, description: "Message ids for a Gmail search, newest first." },
  gmail_message: { readOnly: true, description: "One message as plain text, with its attachment list. Untrusted content." },
  gmail_attachment: { readOnly: true, description: "One attachment's bytes, base64." },
  gmail_create_draft: { readOnly: false, description: "A plain-text draft to one address. It is never sent from here." },
};

/** Who the sign-in belongs to, checked after Connect. */
export const gmailMailbox = (token: string) => mailbox(token);

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with an access token the vault opened. */
export function gmailServer(profile: McpId, token: string) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-gmail", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name].description, annotations: { readOnlyHint: DESCRIPTIONS[name].readOnly, destructiveHint: false, openWorldHint: true } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this sign-in serves.`);
        const a = checkGmailArgs(name, req.params?.arguments);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          let result: unknown;
          switch (a.tool) {
            case "gmail_search": result = await search(token, a.q, a.max); break;
            case "gmail_message": result = await message(token, a.id, a.maxChars); break;
            case "gmail_attachment": result = await attachment(token, a.messageId, a.attachmentId); break;
            case "gmail_create_draft": result = await createDraft(token, a.to, a.subject, a.body); break;
          }
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
