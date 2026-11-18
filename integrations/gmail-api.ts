import "server-only";
// Gmail's REST API for our own Gmail MCP server (docs/mcp-everywhere.md, slice 6). Every function
// takes an access token as an argument: integrations/mcp.ts opens the sign-in from the token vault
// and renews it for each call. There is no send, trash, delete or label call here, and none may be
// added. Only integrations/gmail-server.ts imports this (lint enforces it).
import { draftRaw, fromB64url, readMail, type Mail } from "@/core/gmail-rules";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 25_000;

async function gmail<T>(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** The mailbox the sign-in belongs to. */
export const mailbox = async (token: string) => (await gmail<{ emailAddress?: string }>(token, "GET", "/profile")).emailAddress ?? "";

/** Message ids for a Gmail search query, newest first. */
export async function search(token: string, q: string, max: number): Promise<string[]> {
  const j = await gmail<{ messages?: { id: string }[] }>(token, "GET", `/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
  return (j.messages ?? []).map((m) => m.id);
}

/** One message as plain text with its attachment list. */
export const message = async (token: string, id: string, maxChars: number): Promise<Mail> =>
  readMail(await gmail(token, "GET", `/messages/${encodeURIComponent(id)}?format=full`), maxChars);

/** An attachment's bytes, as base64 (so it crosses as JSON). */
export async function attachment(token: string, messageId: string, attachmentId: string): Promise<{ base64: string; size: number }> {
  const j = await gmail<{ data: string }>(token, "GET", `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  const bytes = fromB64url(j.data);
  return { base64: bytes.toString("base64"), size: bytes.length };
}

/** A plain-text draft in the mailbox; the owner sends it from Gmail. Returns its draft id. */
export async function createDraft(token: string, to: string, subject: string, body: string): Promise<{ draftId: string }> {
  const j = await gmail<{ id: string }>(token, "POST", "/drafts", { message: { raw: draftRaw(to, subject, body) } });
  return { draftId: j.id };
}
