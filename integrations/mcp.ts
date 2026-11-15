import "server-only";
// MCP connections (docs/company-mode.md, slice 6): our runner's own client for an MCP server
// (Streamable HTTP, JSON-RPC), and the sign-in that gives it a token. Only `callMcpTool` reaches a
// server's tools, and it calls only what core/mcp-rules.ts names for that server: read tools.
//
// Tokens live in mcp_connections, encrypted (AES-256-GCM) with a key made from the service role
// key, so a copy of the table alone can't be used. Rotating that key just means tapping Connect
// again. Tokens are never sent to the browser.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/core/db";
import { env } from "@/core/env";
import {
  MCP_PROTOCOL, MCP_SERVERS, authorizeUrl, discoveryUrls, mayCall, needsRefresh, parseRpc, readAuthServer, readTokens, resourceOf, toolPayload,
  type AuthServer, type McpId, type Tokens,
} from "@/core/mcp-rules";

const TIMEOUT_MS = 25_000;
const CLIENT_NAME = "One Two Control Room";

// ---- Encryption at rest.

function key(): Buffer {
  if (!env.supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY isn't set");
  return createHash("sha256").update(`mcp-connections:v1:${env.supabaseServiceKey}`).digest();
}
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function open<T>(sealed: string): T | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}

// ---- The stored connection.

interface Secret { clientId: string; clientSecret: string | null; tokenEndpoint: string; tokens: Tokens }
export interface McpStatus { connected: boolean; connectedAt: string | null; lastError: string | null; settings: Record<string, string> }
export const MCP_MISSING = "The MCP connections table isn't set up yet: apply supabase/migrations/20261125090000_mcp_connections.sql.";

async function row(id: McpId) {
  const { data, error } = await db().from("mcp_connections").select("id, secret, settings, connected_at, last_error").eq("id", id).maybeSingle();
  if (error) throw new Error(/relation .* does not exist|schema cache/i.test(error.message) ? MCP_MISSING : error.message);
  return data as { id: string; secret: string | null; settings: Record<string, string> | null; connected_at: string | null; last_error: string | null } | null;
}

/** Whether the server is signed in, and its saved choices (the email list). Null when the table is missing. */
export async function mcpStatus(id: McpId): Promise<McpStatus | null> {
  try {
    const r = await row(id);
    return { connected: !!r?.secret, connectedAt: r?.connected_at ?? null, lastError: r?.last_error ?? null, settings: r?.settings ?? {} };
  } catch { return null; }
}

export async function saveMcpSetting(id: McpId, name: string, value: string | null) {
  const r = await row(id);
  if (!r?.secret) throw new Error(`${MCP_SERVERS[id].name} isn't connected.`);
  const settings = { ...(r.settings ?? {}) };
  if (value == null) delete settings[name]; else settings[name] = value;
  const { error } = await db().from("mcp_connections").update({ settings, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

async function store(id: McpId, s: Secret) {
  const now = new Date().toISOString();
  const { error } = await db().from("mcp_connections").upsert({ id, secret: seal(s), connected_at: now, last_error: null, updated_at: now }, { onConflict: "id" });
  if (error) throw new Error(/relation .* does not exist|schema cache/i.test(error.message) ? MCP_MISSING : error.message);
}

/** Forgets the token (and the saved choices). The server's own app list may still show it until removed there. */
export async function disconnectMcp(id: McpId) {
  const { error } = await db().from("mcp_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

const noteError = async (id: McpId, e: string) => { await db().from("mcp_connections").update({ last_error: e.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id); };

// ---- HTTP helpers.

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function firstJson(urls: string[]): Promise<unknown> {
  for (const u of urls) {
    try { const r = await fetchJson(u, { headers: { Accept: "application/json" } }); if (r.ok && r.json) return r.json; } catch { /* try the next */ }
  }
  return null;
}

/** The server's sign-in details: from its protected-resource document, else its own origin. */
async function discover(serverUrl: string): Promise<AuthServer> {
  const d = discoveryUrls(serverUrl);
  const pr = await firstJson(d.resource) as { authorization_servers?: unknown } | null;
  const issuers = Array.isArray(pr?.authorization_servers) ? (pr!.authorization_servers as unknown[]).filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x)) : [];
  for (const issuer of [...issuers, new URL(serverUrl).origin]) {
    const a = readAuthServer(await firstJson(d.authServer(issuer)));
    if (a) return a;
  }
  throw new Error("couldn't find the server's sign-in details");
}

const b64url = (b: Buffer) => b.toString("base64url");

/** What the browser keeps (sealed, in a short-lived cookie) between leaving for the sign-in page and coming back. */
interface Pending { id: McpId; state: string; verifier: string; clientId: string; clientSecret: string | null; tokenEndpoint: string; redirectUri: string; at: number }
export const PENDING_COOKIE = "cr_mcp_pending";
export const PENDING_MINUTES = 10;

/** Registers the Control Room with the server and returns where to send Zak, plus the sealed pending state. */
export async function startConnect(id: McpId, redirectUri: string): Promise<{ url: string; pending: string }> {
  const server = MCP_SERVERS[id];
  const a = await discover(server.url);
  if (!a.registration_endpoint) throw new Error("the server doesn't let apps register themselves, so it can't be connected this way yet");
  const reg = await fetchJson(a.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  const client = (reg.json ?? {}) as { client_id?: string; client_secret?: string };
  if (!reg.ok || !client.client_id) throw new Error(`the server didn't register the app (${reg.status}): ${reg.text.slice(0, 160)}`);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(18));
  const url = authorizeUrl(a, { clientId: client.client_id, redirectUri, challenge, state, resource: resourceOf(server.url), scope: a.scopes_supported?.join(" ") || undefined });
  const p: Pending = { id, state, verifier, clientId: client.client_id, clientSecret: client.client_secret ?? null, tokenEndpoint: a.token_endpoint, redirectUri, at: Date.now() };
  return { url, pending: seal(p) };
}

async function tokenRequest(endpoint: string, clientId: string, clientSecret: string | null, form: Record<string, string>) {
  const body = new URLSearchParams({ ...form, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) });
  return fetchJson(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
}

/** Back from the sign-in page: checks the state, trades the code for a token and keeps it. */
export async function finishConnect(id: McpId, sealedPending: string | undefined, q: { code?: string | null; state?: string | null; error?: string | null }) {
  if (q.error) throw new Error(`the sign-in was not finished (${q.error.slice(0, 80)})`);
  const p = sealedPending ? open<Pending>(sealedPending) : null;
  if (!p || p.id !== id || Date.now() - p.at > PENDING_MINUTES * 60_000) throw new Error("the sign-in took too long or was started elsewhere. Tap Connect again.");
  if (!q.code || !q.state || q.state !== p.state) throw new Error("the sign-in didn't match the one started here. Tap Connect again.");
  const r = await tokenRequest(p.tokenEndpoint, p.clientId, p.clientSecret, { grant_type: "authorization_code", code: q.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, resource: resourceOf(MCP_SERVERS[id].url) });
  const tokens = r.ok ? readTokens(r.json, Date.now()) : null;
  if (!tokens) throw new Error(`the server didn't hand over a token (${r.status}): ${r.text.slice(0, 160)}`);
  await store(id, { clientId: p.clientId, clientSecret: p.clientSecret, tokenEndpoint: p.tokenEndpoint, tokens });
}

/** A token good for at least a minute, refreshed (and kept) when it's about to run out. */
async function accessToken(id: McpId): Promise<string> {
  const r = await row(id);
  const s = r?.secret ? open<Secret>(r.secret) : null;
  if (!s) throw new Error(`${MCP_SERVERS[id].name} isn't connected. Tap Connect on Connections.`);
  if (!needsRefresh(s.tokens, Date.now())) return s.tokens.accessToken;
  if (!s.tokens.refreshToken) throw new Error(`${MCP_SERVERS[id].name}'s sign-in ran out. Tap Connect on Connections.`);
  const t = await tokenRequest(s.tokenEndpoint, s.clientId, s.clientSecret, { grant_type: "refresh_token", refresh_token: s.tokens.refreshToken, resource: resourceOf(MCP_SERVERS[id].url) });
  const tokens = t.ok ? readTokens(t.json, Date.now(), s.tokens.refreshToken) : null;
  if (!tokens) {
    const e = `${MCP_SERVERS[id].name}'s sign-in couldn't be renewed (${t.status}). Tap Connect on Connections.`;
    await noteError(id, e);
    throw new Error(e);
  }
  const { error } = await db().from("mcp_connections").update({ secret: seal({ ...s, tokens }), last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  return tokens.accessToken;
}

// ---- The MCP client: initialize, then one tools/call. A short session per call keeps it simple
// on serverless, where nothing stays warm between runs.

async function rpc(url: string, token: string, session: string | null, id: number | null, method: string, params: unknown) {
  const res = await fetch(url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL, ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify(id == null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`the server refused the sign-in (${res.status}). Tap Connect on Connections.`);
  if (!res.ok && id != null) throw new Error(`the server answered ${res.status}: ${text.slice(0, 160)}`);
  return { session: res.headers.get("mcp-session-id") ?? session, reply: id == null ? null : parseRpc(res.headers.get("content-type"), text, id) };
}

/**
 * Calls one of the read tools core/mcp-rules.ts names for this server, and returns its data.
 * Anything else is refused before a request is made.
 */
export async function callMcpTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!mayCall(id, tool)) throw new Error(`${tool} isn't on the list of ${MCP_SERVERS[id].name} tools code may call.`);
  const url = MCP_SERVERS[id].url;
  const token = await accessToken(id);
  const init = await rpc(url, token, null, 1, "initialize", { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: CLIENT_NAME, version: "1" } });
  if (init.reply && "error" in init.reply) throw new Error(`${MCP_SERVERS[id].name}: ${init.reply.error}`);
  await rpc(url, token, init.session, null, "notifications/initialized", {}).catch(() => undefined);
  const call = await rpc(url, token, init.session, 2, "tools/call", { name: tool, arguments: args });
  if (!call.reply || "error" in call.reply) throw new Error(`${MCP_SERVERS[id].name} ${tool}: ${call.reply && "error" in call.reply ? call.reply.error : "no answer"}`);
  const out = toolPayload(call.reply.result);
  if ("error" in out) throw new Error(`${MCP_SERVERS[id].name} ${tool}: ${out.error}`);
  return out.data;
}
