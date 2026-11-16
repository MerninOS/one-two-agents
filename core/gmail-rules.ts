// Gmail shapes (docs/mcp-everywhere.md, slice 6). Pure: the checks our Gmail server makes on every
// request, reading a message, and building a draft, so `npm run check:mcp` can test them. Mail is
// untrusted content: nothing read here ever chooses a recipient (the gateway reads it from the lead).

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});

/** Gmail's own ids: hex-ish, short. Checked before they go into a URL. */
const GID = /^[A-Za-z0-9_-]{6,200}$/;
/** One plain address, no display name, no second recipient, no header injection. */
export const isPlainAddress = (s: string) => s.length <= 254 && /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);

export type GmailArgs =
  | { tool: "gmail_search"; q: string; max: number }
  | { tool: "gmail_message"; id: string; maxChars: number }
  | { tool: "gmail_attachment"; messageId: string; attachmentId: string }
  | { tool: "gmail_create_draft"; to: string; subject: string; body: string };

/** The checked arguments for one Gmail tool, or why not. */
export function checkGmailArgs(tool: string, raw: unknown): GmailArgs | { problem: string } {
  const a = obj(raw);
  const bad = (problem: string) => ({ problem });
  switch (tool) {
    case "gmail_search": {
      const max = a.max === undefined ? 3 : Number(a.max);
      if (typeof a.q !== "string" || !a.q.trim() || a.q.length > 500) return bad("q must be a Gmail search, at most 500 characters");
      if (!Number.isInteger(max) || max < 1 || max > 20) return bad("max must be 1 to 20");
      return { tool, q: a.q, max };
    }
    case "gmail_message": {
      const maxChars = a.maxChars === undefined ? 6000 : Number(a.maxChars);
      if (typeof a.id !== "string" || !GID.test(a.id)) return bad("id must be a Gmail message id");
      if (!Number.isInteger(maxChars) || maxChars < 100 || maxChars > 20000) return bad("maxChars must be 100 to 20000");
      return { tool, id: a.id, maxChars };
    }
    case "gmail_attachment": {
      if (typeof a.messageId !== "string" || !GID.test(a.messageId)) return bad("messageId must be a Gmail message id");
      if (typeof a.attachmentId !== "string" || !GID.test(a.attachmentId)) return bad("attachmentId must be a Gmail attachment id");
      return { tool, messageId: a.messageId, attachmentId: a.attachmentId };
    }
    case "gmail_create_draft": {
      const to = typeof a.to === "string" ? a.to.trim() : "";
      if (!isPlainAddress(to)) return bad("to must be one plain email address");
      if (typeof a.subject !== "string" || !a.subject.trim() || a.subject.length > 300) return bad("subject is required, at most 300 characters");
      if (typeof a.body !== "string" || !a.body.trim() || a.body.length > 20000) return bad("body is required, at most 20000 characters");
      return { tool, to, subject: a.subject.replace(/[\r\n]+/g, " "), body: a.body };
    }
    default:
      return bad(`${tool} isn't a Gmail tool`);
  }
}

export interface MailAttachment { id: string; filename: string; mimeType: string; size: number }
export interface Mail { id: string; from: string; subject: string; date: string; text: string; attachments: MailAttachment[] }

type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; headers?: { name: string; value: string }[] };

export const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/&[a-z#0-9]+;/gi, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");

function walk(p: Part, acc: { plain: string[]; html: string[]; att: MailAttachment[] }, depth = 0) {
  if (depth > 20) return;
  if (p.filename && p.body?.attachmentId) acc.att.push({ id: p.body.attachmentId, filename: p.filename.slice(0, 200), mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0 });
  else if (p.mimeType === "text/plain" && p.body?.data) acc.plain.push(fromB64url(p.body.data).toString("utf8"));
  else if (p.mimeType === "text/html" && p.body?.data) acc.html.push(strip(fromB64url(p.body.data).toString("utf8")));
  for (const c of p.parts ?? []) walk(c, acc, depth + 1);
}

/** One message (Gmail's format=full) as plain text, HTML stripped, at most `maxChars`, plus its attachment list. */
export function readMail(m: unknown, maxChars: number): Mail {
  const msg = obj(m) as { id?: string; payload?: Part };
  const payload = msg.payload ?? {};
  const h = (n: string) => (payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "").slice(0, 300);
  const acc = { plain: [] as string[], html: [] as string[], att: [] as MailAttachment[] };
  walk(payload, acc);
  const text = (acc.plain.join("\n").trim() || acc.html.join("\n")).slice(0, maxChars);
  return { id: String(msg.id ?? ""), from: h("from"), subject: h("subject"), date: h("date"), text, attachments: acc.att };
}

// RFC 2047 so non-ASCII subjects survive
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

/** A plain-text draft as Gmail's raw (base64url) MIME. `to` is one checked address. */
export function draftRaw(to: string, subject: string, body: string): string {
  if (!isPlainAddress(to)) throw new Error("not one plain email address");
  const mime = [
    `To: ${to}`,
    `Subject: ${header(subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}
