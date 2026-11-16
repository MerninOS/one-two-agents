import "server-only";
// Gmail, read only, for the Bookkeeper's receipt search (docs/mcp-everywhere.md, slice 6). Calls our
// own Gmail server through integrations/mcp.ts on the "Gmail (read only)" sign-in, granted
// gmail.readonly alone: it searches and reads messages and attachments, and has no way to draft,
// send, label or delete. Everything it returns is untrusted content.
import { callMcpTool, localReady } from "./mcp";
import type { Mail } from "@/core/gmail-rules";

export type { Mail, MailAttachment } from "@/core/gmail-rules";

/** Whether the read-only Gmail sign-in is connected and not paused. */
export const hasGmailRead = () => localReady("gmail_read");

export class GmailReader {
  private constructor() {}
  static async open() {
    if (!(await hasGmailRead())) throw new Error("Gmail (read only) isn't connected: tap Connect on Connections, Gmail.");
    return new GmailReader();
  }

  /** Message ids for a Gmail search query, newest first. */
  async search(q: string, max = 3): Promise<string[]> {
    const ids = await callMcpTool("gmail_read", "gmail_search", { q, max });
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  }

  /** One message as plain text (HTML stripped), at most `maxChars`, plus its attachment list. */
  async read(id: string, maxChars = 6000): Promise<Mail> {
    return (await callMcpTool("gmail_read", "gmail_message", { id, maxChars })) as Mail;
  }

  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const a = (await callMcpTool("gmail_read", "gmail_attachment", { messageId, attachmentId })) as { base64?: unknown };
    if (typeof a?.base64 !== "string") throw new Error("Gmail sent no attachment");
    return Buffer.from(a.base64, "base64");
  }
}
