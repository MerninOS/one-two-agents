import "server-only";
// Gmail, read-only, for the Bookkeeper's receipt search. Uses its own refresh token
// granted only gmail.readonly: it searches and reads messages and attachments, and has
// no way to draft, send, label or delete. Everything it returns is untrusted content.
import { env } from "@/core/env";
import { accessToken } from "./gmail";

export const hasGmailRead = () => !!(env.gmailClientId && env.gmailClientSecret && env.gmailReceiptsRefreshToken);

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return res.json() as Promise<T>;
}

export interface MailAttachment { id: string; filename: string; mimeType: string; size: number }
export interface Mail { id: string; from: string; subject: string; date: string; text: string; attachments: MailAttachment[] }

type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; headers?: { name: string; value: string }[] };

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/&[a-z#0-9]+;/gi, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");

function walk(p: Part, acc: { plain: string[]; html: string[]; att: MailAttachment[] }) {
  if (p.filename && p.body?.attachmentId) acc.att.push({ id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0 });
  else if (p.mimeType === "text/plain" && p.body?.data) acc.plain.push(b64(p.body.data).toString("utf8"));
  else if (p.mimeType === "text/html" && p.body?.data) acc.html.push(strip(b64(p.body.data).toString("utf8")));
  for (const c of p.parts ?? []) walk(c, acc);
}

export class GmailReader {
  private constructor(private token: string) {}
  static async open() {
    if (!hasGmailRead()) throw new Error("GMAIL_RECEIPTS_REFRESH_TOKEN (and the Gmail OAuth client) must be set");
    return new GmailReader(await accessToken(env.gmailReceiptsRefreshToken));
  }

  /** Message ids for a Gmail search query, newest first. */
  async search(q: string, max = 3): Promise<string[]> {
    const j = await get<{ messages?: { id: string }[] }>(this.token, `/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
    return (j.messages ?? []).map((m) => m.id);
  }

  /** One message as plain text (HTML stripped), at most `maxChars`, plus its attachment list. */
  async read(id: string, maxChars = 6000): Promise<Mail> {
    const m = await get<{ id: string; payload: Part }>(this.token, `/messages/${encodeURIComponent(id)}?format=full`);
    const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const acc = { plain: [] as string[], html: [] as string[], att: [] as MailAttachment[] };
    walk(m.payload, acc);
    const text = (acc.plain.join("\n").trim() || acc.html.join("\n")).slice(0, maxChars);
    return { id: m.id, from: h("from"), subject: h("subject"), date: h("date"), text, attachments: acc.att };
  }

  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const j = await get<{ data: string }>(this.token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return b64(j.data);
  }
}
