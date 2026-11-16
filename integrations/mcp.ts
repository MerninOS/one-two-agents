import "server-only";
// MCP connections (docs/company-mode.md, slice 6): our runner's own client for an MCP server
// (Streamable HTTP, JSON-RPC), and the sign-in that gives it a token. Only `callMcpTool` reaches a
// server's tools, and it calls only what core/mcp-rules.ts names for that server: read tools.
//
// Sign-ins are kept in the token vault (core/vault.ts, docs/mcp-everywhere.md slice 2): sealed in
// mcp_connections with MCP_SECRET_KEY, a key of its own. Tokens never reach a model, the browser,
// the run log or an error message (scrubSecrets), are never sent on after a redirect, and are
// revoked at the server on Disconnect where it allows. Every sign-in event is logged, without
// token values, in mcp_connection_events.
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/core/db";
import { env } from "@/core/env";
import {
  GOOGLE_AUTH, MCP_PROTOCOL, MCP_SERVERS, TOOL_CHECK_HOURS, authorizeUrl, grantedScopes, isGoogle, scopeProblem, usesConnect, checkTools, checkedTools, isHosted, mayWrite, listedTools, toolCheckNote, type ListedTool, discoveryUrls, mayCall, mayReport, needsRefresh, parseRpc, pickScopes, readAuthServer, readTokens, resourceOf, scrubSecrets, toolPayload,
  type AuthServer, type McpEvent, type McpId, type Tokens,
} from "@/core/mcp-rules";
import { MIN_SECRET_CHARS, keyIdOf, open as openWith, seal as sealWith, vaultKey, type VaultKey } from "@/core/vault";
import { looksLikeNotionKey } from "@/core/notion-blocks";
import { checkNotionKey, notionServer } from "./notion-server";
import { checkShopifyKey, shopifyServer } from "./shopify-server";
import { checkMercuryFilesKey, mercuryFilesServer } from "./mercury-files-server";
import { looksLikeMercuryToken } from "@/core/mercury-rules";
import { shopifyKeyKind } from "@/core/shopify-queries";
import { gmailMailbox, gmailServer } from "./gmail-server";

const TIMEOUT_MS = 25_000;
const CLIENT_NAME = "One Two Control Room";

// ---- The vault's keys.

const usable = (s: string | undefined) => !!s && s.length >= MIN_SECRET_CHARS;
export const VAULT_MISSING = `Set MCP_SECRET_KEY in Vercel (at least ${MIN_SECRET_CHARS} characters, made with openssl rand -base64 32) so sign-ins can be locked.`;

function keys(): { current: VaultKey | null; all: VaultKey[] } {
  const current = usable(env.mcpSecretKey) ? vaultKey(env.mcpSecretKey!) : null;
  const all: VaultKey[] = [];
  if (current) all.push(current);
  if (usable(env.mcpSecretKeyOld)) all.push(vaultKey(env.mcpSecretKeyOld!));
  return { current, all };
}
/** Whether MCP_SECRET_KEY is set and long enough. */
export const vaultReady = () => usable(env.mcpSecretKey);
function seal(value: unknown): string {
  const k = keys().current;
  if (!k) throw new Error(VAULT_MISSING);
  return sealWith(value, k);
}
function open<T>(sealed: string): T | null { return openWith<T>(sealed, keys().all); }

// ---- The stored connection.

interface Secret { clientId: string; clientSecret: string | null; tokenEndpoint: string; revocationEndpoint?: string | null; tokens: Tokens }
/** A key pasted on Connections, for a server we run ourselves. */
interface KeySecret { key: string }
export interface McpStatus { connected: boolean; paused: boolean; connectedAt: string | null; lastError: string | null; settings: Record<string, string>; toolsCheckedAt: string | null; toolsSeen: string[] }
export interface McpLogRow { event: McpEvent; detail: string | null; at: string }
export const MCP_MISSING = "The MCP tables aren't set up yet: apply the mcp_connections, mcp_vault and mcp_tool_check migrations in supabase/migrations.";
const missing = (m: string) => /relation .* does not exist|schema cache|column .* does not exist/i.test(m);

type Row = { id: string; secret: string | null; settings: Record<string, string> | null; connected_at: string | null; last_error: string | null; paused_at: string | null; tools_seen: Record<string, string> | null; tools_checked_at: string | null };

async function row(id: McpId): Promise<Row | null> {
  const { data, error } = await db().from("mcp_connections").select("id, secret, settings, connected_at, last_error, paused_at, tools_seen, tools_checked_at").eq("id", id).maybeSingle();
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  return data as Row | null;
}

/** One line in the sign-in log. Best effort: a missing log never stops a run. Never a token. */
async function logEvent(id: string, event: McpEvent, detail?: string, secrets: (string | null | undefined)[] = []) {
  try { await db().from("mcp_connection_events").insert({ connection_id: id, event, detail: detail ? scrubSecrets(detail, secrets).slice(0, 300) : null }); } catch { /* the log is a record, not a gate */ }
}

/** The last few sign-in events for one server, newest first. */
export async function mcpLog(id: McpId, limit = 6): Promise<McpLogRow[]> {
  const { data, error } = await db().from("mcp_connection_events").select("event, detail, at").eq("connection_id", id).order("at", { ascending: false }).limit(limit);
  return error ? [] : (data as McpLogRow[]);
}

/** Whether the server is signed in, and its saved choices (the email list). Null when the tables are missing. */
export async function mcpStatus(id: McpId): Promise<McpStatus | null> {
  try {
    const r = await row(id);
    return { connected: !!r?.secret, paused: !!r?.paused_at, connectedAt: r?.connected_at ?? null, lastError: r?.last_error ?? null, settings: r?.settings ?? {}, toolsCheckedAt: r?.tools_checked_at ?? null, toolsSeen: Object.keys(r?.tools_seen ?? {}) };
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
  const { error } = await db().from("mcp_connections").upsert({ id, secret: seal(s), connected_at: now, last_error: null, paused_at: null, updated_at: now }, { onConflict: "id" });
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
}

/** Stops a connection until Zak signs in again, so a dead sign-in isn't retried on every call. */
async function pause(id: McpId, e: string, event: McpEvent, secrets: (string | null | undefined)[]) {
  const text = scrubSecrets(e, secrets).slice(0, 300);
  await db().from("mcp_connections").update({ last_error: text, paused_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  await logEvent(id, event, text);
}

/** The sign-in, opened. Moves it onto the current key when an older key sealed it. */
async function readSecret<T = Secret>(id: McpId, r: Row): Promise<T | null> {
  if (!r.secret) return null;
  const s = open<T>(r.secret);
  if (!s) return null;
  const cur = keys().current;
  if (cur && keyIdOf(r.secret) !== cur.id) {
    const { error } = await db().from("mcp_connections").update({ secret: sealWith(s, cur), updated_at: new Date().toISOString() }).eq("id", id);
    if (!error) await logEvent(id, "resealed", `moved onto key ${cur.id}`);
  }
  return s;
}

export interface VaultState { keySet: boolean; tooShort: boolean; oldKeySet: boolean; keyId: string | null; onOtherKey: string[]; unreadable: string[] }

/** Is MCP_SECRET_KEY set, and is every saved sign-in sealed with it. Never shows a key. */
export async function vaultState(): Promise<VaultState | null> {
  const { current } = keys();
  const base = { keySet: !!current, tooShort: !!env.mcpSecretKey && !current, oldKeySet: usable(env.mcpSecretKeyOld), keyId: current?.id ?? null };
  const { data, error } = await db().from("mcp_connections").select("id, secret").not("secret", "is", null);
  if (error) return null;
  const rows = data as { id: string; secret: string }[];
  return {
    ...base,
    onOtherKey: rows.filter((r) => keyIdOf(r.secret) !== current?.id && open(r.secret) !== null).map((r) => r.id),
    unreadable: rows.filter((r) => open(r.secret) === null).map((r) => r.id),
  };
}

/** Re-seals every saved sign-in with MCP_SECRET_KEY. After this, MCP_SECRET_KEY_OLD can be removed. */
export async function resealAll(): Promise<{ moved: number; unreadable: string[] }> {
  const cur = keys().current;
  if (!cur) throw new Error(VAULT_MISSING);
  const { data, error } = await db().from("mcp_connections").select("id, secret").not("secret", "is", null);
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  let moved = 0;
  const unreadable: string[] = [];
  for (const r of data as { id: string; secret: string }[]) {
    if (keyIdOf(r.secret) === cur.id) continue;
    const s = open<Secret>(r.secret);
    if (!s) { unreadable.push(r.id); continue; }
    const u = await db().from("mcp_connections").update({ secret: sealWith(s, cur), updated_at: new Date().toISOString() }).eq("id", r.id);
    if (u.error) throw new Error(u.error.message);
    await logEvent(r.id, "resealed", `moved onto key ${cur.id}`);
    moved++;
  }
  return { moved, unreadable };
}

/**
 * Asks the server to cancel the sign-in (RFC 7009) where it has a revoke address, then forgets it
 * here either way. Says whether the server confirmed.
 */
export async function disconnectMcp(id: McpId): Promise<{ revoked: boolean; note: string | null }> {
  const r = await row(id);
  let revoked = false, note: string | null = null;
  if (!usesConnect(id)) {
    // a pasted key can't be cancelled through the API; it stops working when it is rotated at the service
    if (r?.secret) {
      note = `${MCP_SERVERS[id].name} keys can't be cancelled from here. To make this one stop working too, rotate it (or uninstall the app) in ${MCP_SERVERS[id].name}'s settings.`;
      await logEvent(id, "revoke_failed", note);
    }
    const { error } = await db().from("mcp_connections").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await logEvent(id, "disconnected");
    return { revoked, note };
  }
  const s = r ? await readSecret(id, r).catch(() => null) : null;
  if (s) {
    let endpoint = s.revocationEndpoint ?? null;
    if (!endpoint && isHosted(id)) { try { endpoint = (await discover(MCP_SERVERS[id].url)).revocation_endpoint ?? null; } catch { endpoint = null; } }
    const secrets = [s.tokens.accessToken, s.tokens.refreshToken, s.clientSecret];
    if (!endpoint) note = `${MCP_SERVERS[id].name} has no revoke address, so remove the app in its own settings too.`;
    else {
      try {
        const tries = [
          ...(s.tokens.refreshToken ? [{ token: s.tokens.refreshToken, token_type_hint: "refresh_token" }] : []),
          { token: s.tokens.accessToken, token_type_hint: "access_token" },
        ];
        // Google: cancelling the refresh token cancels its access tokens too, and takes only the token
        const res = isGoogle(id)
          ? [await fetchJson(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tries[0].token }) })]
          : await Promise.all(tries.map((t) => tokenRequest(endpoint!, s.clientId, s.clientSecret, t)));
        revoked = res.every((x) => x.ok);
        if (!revoked) note = scrubSecrets(`${MCP_SERVERS[id].name} didn't confirm the cancel (${res.map((x) => x.status).join(", ")}). Remove the app in its own settings too.`, secrets);
      } catch (e) {
        note = scrubSecrets(`${MCP_SERVERS[id].name} couldn't be reached to cancel the sign-in (${e instanceof Error ? e.message : String(e)}). Remove the app in its own settings too.`, secrets);
      }
    }
    await logEvent(id, revoked ? "revoked" : "revoke_failed", note ?? undefined, secrets);
  }
  const { error } = await db().from("mcp_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent(id, "disconnected");
  return { revoked, note };
}

// ---- HTTP helpers.

/**
 * Discovery documents may redirect; anything carrying a code, token or client secret may not
 * (`redirect: "error"`), so a sign-in value only ever goes to the address code chose.
 */
async function fetchJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, { redirect: "error", ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function firstJson(urls: string[]): Promise<unknown> {
  for (const u of urls) {
    try { const r = await fetchJson(u, { redirect: "follow", headers: { Accept: "application/json" } }); if (r.ok && r.json) return r.json; } catch { /* try the next */ }
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
interface Pending { id: McpId; state: string; verifier: string; clientId: string; clientSecret: string | null; tokenEndpoint: string; revocationEndpoint: string | null; redirectUri: string; at: number }
export const PENDING_COOKIE = "cr_mcp_pending";
export const PENDING_MINUTES = 10;

/** Registers the Control Room with the server and returns where to send Zak, plus the sealed pending state. */
export async function startConnect(id: McpId, redirectUri: string): Promise<{ url: string; pending: string }> {
  if (!usesConnect(id)) throw new Error(`${MCP_SERVERS[id].name} is connected by pasting its key on Connections.`);
  if (!keys().current) throw new Error(VAULT_MISSING);
  const server = MCP_SERVERS[id];
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(18));
  if (isGoogle(id)) {
    // our own Google OAuth client: its secret stays in Vercel and is never put in the cookie or the vault
    if (!env.gmailClientId || !env.gmailClientSecret) throw new Error("set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel (One Two's Google OAuth client) first");
    const url = authorizeUrl(GOOGLE_AUTH, { clientId: env.gmailClientId, redirectUri, challenge, state, scope: server.scopes.join(" "), extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" } });
    const p: Pending = { id, state, verifier, clientId: env.gmailClientId, clientSecret: null, tokenEndpoint: GOOGLE_AUTH.token_endpoint, revocationEndpoint: GOOGLE_AUTH.revocation_endpoint ?? null, redirectUri, at: Date.now() };
    return { url, pending: seal(p) };
  }
  const a = await discover(server.url);
  const { scope } = pickScopes(server.scopes, a.scopes_supported);
  if (!a.registration_endpoint) throw new Error("the server doesn't let apps register themselves, so it can't be connected this way yet");
  const reg = await fetchJson(a.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  const client = (reg.json ?? {}) as { client_id?: string; client_secret?: string };
  if (!reg.ok || !client.client_id) throw new Error(`the server didn't register the app (${reg.status}): ${scrubSecrets(reg.text).slice(0, 160)}`);
  const url = authorizeUrl(a, { clientId: client.client_id, redirectUri, challenge, state, resource: resourceOf(server.url), scope });
  const p: Pending = { id, state, verifier, clientId: client.client_id, clientSecret: client.client_secret ?? null, tokenEndpoint: a.token_endpoint, revocationEndpoint: a.revocation_endpoint ?? null, redirectUri, at: Date.now() };
  return { url, pending: seal(p) };
}

/** The client secret for a token request: Google's lives only in Vercel (GMAIL_CLIENT_SECRET). */
const clientSecretOf = (id: McpId, stored: string | null) => (isGoogle(id) ? env.gmailClientSecret ?? null : stored);
/** RFC 8707 resource: hosted MCP servers only (Google doesn't take it). */
const resourceFor = (id: McpId): Record<string, string> => (isHosted(id) ? { resource: resourceOf(MCP_SERVERS[id].url) } : {});

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
  const secret = clientSecretOf(id, p.clientSecret);
  const r = await tokenRequest(p.tokenEndpoint, p.clientId, secret, { grant_type: "authorization_code", code: q.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, ...resourceFor(id) });
  const tokens = r.ok ? readTokens(r.json, Date.now()) : null;
  if (!tokens) throw new Error(`the server didn't hand over a token (${r.status}): ${scrubSecrets(r.text, [q.code, secret, p.verifier]).slice(0, 160)}`);
  if (isGoogle(id)) {
    // exactly the profile's scope, or the sign-in is cancelled at Google and not kept
    const secrets = [tokens.accessToken, tokens.refreshToken, secret];
    const problem = scopeProblem(grantedScopes(r.json), MCP_SERVERS[id].scopes) ?? (tokens.refreshToken ? null : "Google didn't hand over a refresh token");
    let box = "";
    if (!problem) { try { box = await gmailMailbox(tokens.accessToken); } catch (e) { box = ""; await logEvent(id, "refused", `couldn't read the mailbox: ${e instanceof Error ? e.message : String(e)}`, secrets); } }
    if (problem || !box) {
      await fetchJson(GOOGLE_AUTH.revocation_endpoint!, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }) }).catch(() => undefined);
      const why = problem ?? "Gmail didn't say which mailbox this is";
      await logEvent(id, "refused", why, secrets);
      throw new Error(`${why}, so it was cancelled. Tap Connect again.`);
    }
    await store(id, { clientId: p.clientId, clientSecret: null, tokenEndpoint: p.tokenEndpoint, revocationEndpoint: p.revocationEndpoint, tokens });
    await db().from("mcp_connections").update({ settings: { mailbox: box } }).eq("id", id);
    await logEvent(id, "connected", `as ${box}`, secrets);
    return;
  }
  await store(id, { clientId: p.clientId, clientSecret: p.clientSecret, tokenEndpoint: p.tokenEndpoint, revocationEndpoint: p.revocationEndpoint, tokens });
  await logEvent(id, "connected");
  // signing in accepts the server's tools as they are now; a tool the profile needs that's gone still pauses it
  try { await toolCheck(id, true); } catch { /* unreachable now: the first call checks */ }
}

/** A token good for at least a minute, refreshed (and kept) when it's about to run out. */
async function accessToken(id: McpId): Promise<{ token: string; secrets: (string | null)[]; row: Row }> {
  const name = MCP_SERVERS[id].name;
  if (!usesConnect(id)) throw new Error(`${name} runs on our own server with a pasted key: use callLocalTool.`);
  const r = await row(id);
  if (r?.paused_at) throw new Error(`${name} is paused: ${r.last_error ?? "its sign-in stopped working"}. Tap Sign in again on Connections.`);
  const s = r ? await readSecret(id, r) : null;
  if (!s) throw new Error(r?.secret ? `${name}'s sign-in can't be unlocked with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD. Tap Sign in again on Connections.` : `${name} isn't connected. Tap Connect on Connections.`);
  const clientSecret = clientSecretOf(id, s.clientSecret);
  const secrets = [s.tokens.accessToken, s.tokens.refreshToken, clientSecret];
  if (!needsRefresh(s.tokens, Date.now())) return { token: s.tokens.accessToken, secrets, row: r! };
  if (!s.tokens.refreshToken) { await pause(id, `${name}'s sign-in ran out`, "refresh_failed", secrets); throw new Error(`${name}'s sign-in ran out. Tap Sign in again on Connections.`); }
  const t = await tokenRequest(s.tokenEndpoint, s.clientId, clientSecret, { grant_type: "refresh_token", refresh_token: s.tokens.refreshToken, ...resourceFor(id) });
  // a new refresh token replaces the old one at once; the old one is kept only when none is sent
  const tokens = t.ok ? readTokens(t.json, Date.now(), s.tokens.refreshToken) : null;
  if (!tokens) {
    const e = `${name}'s sign-in couldn't be renewed (${t.status})`;
    await pause(id, e, "refresh_failed", secrets);
    throw new Error(`${e}. Tap Sign in again on Connections.`);
  }
  const { error } = await db().from("mcp_connections").update({ secret: seal({ ...s, tokens }), last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent(id, "refreshed");
  return { token: tokens.accessToken, secrets: [tokens.accessToken, tokens.refreshToken, ...secrets], row: r! };
}

// ---- The MCP client: initialize, then one tools/call. A short session per call keeps it simple
// on serverless, where nothing stays warm between runs.

class Refused extends Error {}

async function rpc(url: string, token: string, session: string | null, id: number | null, method: string, params: unknown) {
  const res = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL, ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify(id == null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Refused(`the server refused the sign-in (${res.status})`);
  if (!res.ok && id != null) throw new Error(`the server answered ${res.status}: ${scrubSecrets(text, [token]).slice(0, 160)}`);
  return { session: res.headers.get("mcp-session-id") ?? session, reply: id == null ? null : parseRpc(res.headers.get("content-type"), text, id) };
}

/** One short session: initialize, then the requests `work` makes. Errors are scrubbed; a refused sign-in pauses the server. */
async function withSession<T>(id: McpId, work: (call: (method: string, params: unknown) => Promise<unknown>, row: Row) => Promise<T>): Promise<T> {
  const name = MCP_SERVERS[id].name;
  const url = MCP_SERVERS[id].url;
  const { token, secrets, row: r } = await accessToken(id);
  try {
    const init = await rpc(url, token, null, 1, "initialize", { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: CLIENT_NAME, version: "1" } });
    if (init.reply && "error" in init.reply) throw new Error(`${name}: ${init.reply.error}`);
    await rpc(url, token, init.session, null, "notifications/initialized", {}).catch(() => undefined);
    let n = 1;
    const call = async (method: string, params: unknown) => {
      const res = await rpc(url, token, init.session, ++n, method, params);
      if (!res.reply || "error" in res.reply) throw new Error(`${name} ${method}: ${res.reply && "error" in res.reply ? res.reply.error : "no answer"}`);
      return res.reply.result;
    };
    return await work(call, r);
  } catch (e) {
    const msg = scrubSecrets(e instanceof Error ? e.message : String(e), secrets);
    if (e instanceof Refused) { await pause(id, msg, "refused", secrets); throw new Error(`${name}: ${msg}. Tap Sign in again on Connections.`); }
    throw new Error(msg);
  }
}

async function listAll(call: (method: string, params: unknown) => Promise<unknown>): Promise<ListedTool[]> {
  const all: ListedTool[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = listedTools(await call("tools/list", cursor ? { cursor } : {}));
    all.push(...page.tools);
    cursor = page.next;
    if (!cursor) break;
  }
  return all;
}

/**
 * The tool check (slice 3): the profile's read tools must still be on the server, with the inputs
 * accepted last time. `accept` (signing in) takes the inputs as they are now. A failed check pauses
 * the server with what changed, until Zak signs in again.
 */
async function toolCheck(id: McpId, accept: boolean): Promise<void> {
  await withSession(id, async (call, r) => {
    const c = checkTools(checkedTools(id), await listAll(call), accept ? null : r.tools_seen);
    const note = toolCheckNote(c);
    const now = new Date().toISOString();
    if (note) {
      await db().from("mcp_connections").update({ paused_at: now, last_error: `${note}. Sign in again once you've checked it`, updated_at: now }).eq("id", id);
      await logEvent(id, "tools_changed", note);
      throw new Error(`${MCP_SERVERS[id].name} is paused: ${note}. Sign in again on Connections once you've checked it.`);
    }
    const { error } = await db().from("mcp_connections").update({ tools_seen: c.seen, tools_checked_at: now, updated_at: now }).eq("id", id);
    if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
    if (accept || !r.tools_checked_at) await logEvent(id, "tools_checked", `${Object.keys(c.seen).length} tools as expected`);
  });
}

const stale = (at: string | null) => !at || Date.now() - Date.parse(at) > TOOL_CHECK_HOURS * 3_600_000;

/**
 * Calls one of the read tools core/mcp-rules.ts names for this server, and returns its data.
 * Anything else is refused before a request is made. The tool check runs first when it's due.
 */
export async function callMcpTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!mayCall(id, tool)) throw new Error(`${tool} isn't on the list of ${MCP_SERVERS[id].name} tools code may call.`);
  if (isGoogle(id)) return callGoogleTool(id, tool, args);
  if (!isHosted(id)) return callLocalTool(id, tool, args);
  return callRemote(id, tool, args);
}

/**
 * Calls one of a server's write tools. Only core/gateway imports this (lint enforces it), and only
 * after Zak approved the action and the gateway re-checked it against live data.
 */
export async function callWriteTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!mayWrite(id, tool)) throw new Error(`${tool} isn't a write tool the gateway may call on ${MCP_SERVERS[id].name}.`);
  if (isGoogle(id)) return callGoogleTool(id, tool, args);
  if (isHosted(id)) return callRemote(id, tool, args);
  return localCall(id, tool, args, true);
}

/**
 * One tools/call to our own Gmail server (slice 6), with an access token the vault opens and renews
 * for this profile's sign-in. The server serves only this profile's tools. Errors are scrubbed; a
 * token Google no longer accepts pauses the sign-in.
 */
async function callGoogleTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const name = MCP_SERVERS[id].name;
  const { token, secrets } = await accessToken(id);
  const n = ++localSeq;
  const request = JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: tool, arguments: args } });
  const body = JSON.stringify(await gmailServer(id, token)(JSON.parse(request)));
  const rep = parseRpc("application/json", body, n);
  const out = "error" in rep ? { error: rep.error } : toolPayload(rep.result);
  if ("error" in out) {
    const msg = scrubSecrets(out.error, secrets);
    if (/^Gmail 401\b/.test(msg)) { await pause(id, `Google refused the sign-in (401)`, "refused", secrets); throw new Error(`${name}: Google refused the sign-in. Tap Sign in again on Connections.`); }
    throw new Error(`${name} ${tool}: ${msg}`);
  }
  return out.data;
}

async function callRemote(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const name = MCP_SERVERS[id].name;
  const r = await row(id);
  if (r?.secret && !r.paused_at && stale(r.tools_checked_at)) await toolCheck(id, false);
  return withSession(id, async (call) => {
    const out = toolPayload(await call("tools/call", { name: tool, arguments: args }));
    if ("error" in out) throw new Error(`${name} ${tool}: ${out.error}`);
    return out.data;
  });
}

// ---- Servers we run ourselves (slice 4), signed in with a key pasted on Connections.

type Handler = (raw: unknown) => Promise<unknown>;
const LOCAL: Partial<Record<McpId, { server: (key: string) => Handler; looksRight: (key: string) => boolean; who: (key: string) => Promise<{ name: string; workspace: string }> }>> = {
  notion: { server: notionServer, looksRight: looksLikeNotionKey, who: checkNotionKey },
  shopify: { server: shopifyServer, looksRight: (k) => !!shopifyKeyKind(k), who: checkShopifyKey },
  mercury_files: { server: mercuryFilesServer, looksRight: looksLikeMercuryToken, who: checkMercuryFilesKey },
};

/** Whether a server we run is connected and not paused. False when the tables are missing. */
export async function localReady(id: McpId): Promise<boolean> {
  const s = await mcpStatus(id);
  return !!s?.connected && !s.paused;
}

/**
 * Keeps a pasted key in the vault, after checking its shape and asking the service who it belongs
 * to. The key is never echoed back, logged or shown; a wrong key isn't kept.
 */
export async function saveMcpKey(id: McpId, pasted: string): Promise<{ name: string; workspace: string }> {
  const l = LOCAL[id];
  if (!l || usesConnect(id)) throw new Error(`${MCP_SERVERS[id].name} signs in on its own page, not with a key.`);
  if (!keys().current) throw new Error(VAULT_MISSING);
  const key = pasted.trim();
  if (!l.looksRight(key)) throw new Error(`That doesn't look like a ${MCP_SERVERS[id].name} integration key.`);
  let who: { name: string; workspace: string };
  try { who = await l.who(key); } catch (e) { throw new Error(`${MCP_SERVERS[id].name} didn't accept that key: ${scrubSecrets(e instanceof Error ? e.message : String(e), [key]).slice(0, 160)}`); }
  const now = new Date().toISOString();
  const { error } = await db().from("mcp_connections").upsert({ id, secret: seal({ key } satisfies KeySecret), connected_at: now, last_error: null, paused_at: null, updated_at: now }, { onConflict: "id" });
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  await logEvent(id, "connected", `as ${who.name}${who.workspace ? ` in ${who.workspace}` : ""}`, [key]);
  return who;
}

let localSeq = 0;

/**
 * One tools/call to a server we run, with the key the vault opens for this call. Read tools for
 * agents, report tools for code delivering a report. Request and reply cross as JSON and are read
 * like any server's reply. Errors are scrubbed; a key the service no longer accepts pauses it.
 */
export const callLocalTool = (id: McpId, tool: string, args: Record<string, unknown>) => localCall(id, tool, args, false);

/** `write`: only callWriteTool passes true, for a profile's write tool (the gateway, after Zak approves). */
async function localCall(id: McpId, tool: string, args: Record<string, unknown>, write: boolean): Promise<unknown> {
  const name = MCP_SERVERS[id].name;
  const l = LOCAL[id];
  if (!l || usesConnect(id)) throw new Error(`${name} isn't a server we run with a pasted key.`);
  if (write ? !mayWrite(id, tool) : !mayCall(id, tool) && !mayReport(id, tool)) throw new Error(`${tool} isn't on the list of ${name} tools code may call.`);
  const r = await row(id);
  if (r?.paused_at) throw new Error(`${name} is paused: ${r.last_error ?? "its key stopped working"}. Paste a new key on Connections.`);
  const s = r ? await readSecret<KeySecret>(id, r) : null;
  if (!s?.key) throw new Error(r?.secret ? `${name}'s key can't be unlocked with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD. Paste it again on Connections.` : `${name} isn't connected. Paste its key on Connections.`);
  const n = ++localSeq;
  const request = JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: tool, arguments: args } });
  const body = JSON.stringify(await l.server(s.key)(JSON.parse(request)));
  const rep = parseRpc("application/json", body, n);
  const out = "error" in rep ? { error: rep.error } : toolPayload(rep.result);
  if ("error" in out) {
    const msg = scrubSecrets(out.error, [s.key]);
    // 401 is a key the service no longer accepts; Notion's 403 and 404 are a page not shared with the integration
    if (/^(Notion|Shopify|Mercury) 401\b/.test(msg)) { await pause(id, `${name} refused the key (401)`, "refused", [s.key]); throw new Error(`${name} refused the key. Paste a new one on Connections.`); }
    throw new Error(`${name} ${tool}: ${msg}`);
  }
  return out.data;
}
