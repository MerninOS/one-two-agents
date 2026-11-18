import "server-only";
// MCP connections (docs/company-mode.md, slice 6): our runner's own client for an MCP server
// (Streamable HTTP, JSON-RPC), and the sign-in that gives it a token. Only `callMcpTool` reaches a
// server's tools, and it calls only what core/mcp-rules.ts names for that server: read tools.
//
// Sign-ins are kept in the token vault (core/vault.ts, docs/mcp-everywhere.md slice 2): sealed in
// mcp_connections with the org's own data key (org_keys, docs/tenancy.md slice 4), which is kept
// wrapped by MCP_SECRET_KEY, a key of its own. Tokens never reach a model, the browser,
// the run log or an error message (scrubSecrets), are never sent on after a redirect, and are
// revoked at the server on Disconnect where it allows. Every sign-in event is logged, without
// token values, in mcp_connection_events.
import { traced } from "@/core/trace";
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { db } from "@/core/db";
import { env } from "@/core/env";
import {
  GOOGLE_AUTH, MCP_IDS, MCP_PROTOCOL, MCP_SERVERS, TOOL_CHECK_HOURS, isMcpId, authorizeUrl, grantedScopes, isGoogle, scopeProblem, usesConnect, checkTools, checkedTools, isHosted, mayWrite, listedTools, toolCheckNote, type ListedTool, discoveryUrls, mayCall, mayReport, needsRefresh, parseRpc, pickScopes, readAuthServer, readTokens, resourceOf, scrubSecrets, toolPayload,
  type AuthServer, type McpEvent, type McpId, type Tokens,
} from "@/core/mcp-rules";
import { MIN_SECRET_CHARS, envWrapper, isBound, keyIdOf, newDataKey, open as openWith, seal as sealWith, vaultKey, type KeyWrapper, type VaultKey } from "@/core/vault";
import { orgId } from "@/core/tenancy";
import { looksLikeNotionKey } from "@/core/notion-blocks";
import { checkNotionKey, notionServer } from "./notion-server";
import { checkShopifyKey, shopifyServer } from "./shopify-server";
import { checkMercuryFilesKey, mercuryFilesServer } from "./mercury-files-server";
import { looksLikeMercuryToken } from "@/core/mercury-rules";
import { shopifyKeyKind } from "@/core/shopify-queries";
import { gmailMailbox, gmailServer } from "./gmail-server";
import {
  CUSTOM_ID, MAX_CUSTOM_SERVERS, acceptTools, cantTurnOn, customArgs, customReply, checkAddress, checkCustomTools, checkLabel, checkLine, checkPins, checkScopes, checkServerName, customCheckNote, isCustomId, isPublicIp, looksLikeKey, readToolList,
  type CustomAuth, type CustomServer, type CustomTool, type ToolOn,
} from "@/core/custom-mcp-rules";

const TIMEOUT_MS = 25_000;
/** A custom server gets less time per call than a built-in one. */
const CUSTOM_TIMEOUT_MS = 15_000;
const CLIENT_NAME = "OPERATOR Control Room";

// ---- The vault's keys.

const usable = (s: string | undefined) => !!s && s.length >= MIN_SECRET_CHARS;
export const VAULT_MISSING = `Set MCP_SECRET_KEY in Vercel (at least ${MIN_SECRET_CHARS} characters, made with openssl rand -base64 32) so sign-ins can be locked.`;

/** The env key and the old one: they wrap each org's data key, and open sign-ins sealed before slice 4 and the sign-in cookie. */
function keys(): { current: VaultKey | null; all: VaultKey[] } {
  const current = usable(env.mcpSecretKey) ? vaultKey(env.mcpSecretKey!) : null;
  const all: VaultKey[] = [];
  if (current) all.push(current);
  if (usable(env.mcpSecretKeyOld)) all.push(vaultKey(env.mcpSecretKeyOld!));
  return { current, all };
}
/** Whether MCP_SECRET_KEY is set and long enough. */
export const vaultReady = () => usable(env.mcpSecretKey);
/** For the short-lived sign-in cookie only (it never reaches the database): the env key. */
function seal(value: unknown): string {
  const k = keys().current;
  if (!k) throw new Error(VAULT_MISSING);
  return sealWith(value, k);
}
function open<T>(sealed: string): T | null { return openWith<T>(sealed, keys().all); }

// ---- Each org's data key (docs/tenancy.md, slice 4). Wrapped by MCP_SECRET_KEY (a cloud KMS can
// stand in later: KeyWrapper), kept in org_keys, made the first time an org saves a sign-in.

function wrappers(): { current: KeyWrapper | null; all: KeyWrapper[] } {
  const current = usable(env.mcpSecretKey) ? envWrapper(env.mcpSecretKey!) : null;
  const all = current ? [current] : [];
  if (usable(env.mcpSecretKeyOld)) all.push(envWrapper(env.mcpSecretKeyOld!));
  return { current, all };
}

interface OrgKeyRow { key_id: string; wrapped: string; wrap_key_id: string }
const ORG_KEY_MS = 5 * 60_000;
const orgKeyCache = new Map<string, { key: VaultKey; at: number }>();

async function readOrgKeyRow(): Promise<OrgKeyRow | null> {
  const { data, error } = await db().from("org_keys").select("key_id, wrapped, wrap_key_id").maybeSingle();
  if (error) throw new Error(missing(error.message) ? "The org_keys table isn't set up yet: apply 20261206090000_org_keys.sql." : error.message);
  return (data as OrgKeyRow | null) ?? null;
}

/** Unwraps an org's data key with whichever wrapping key wrapped it, and rewraps it onto the current one. */
async function unwrapRow(row: OrgKeyRow, org: string): Promise<VaultKey | null> {
  const { current, all } = wrappers();
  const w = all.find((x) => x.id === row.wrap_key_id);
  const k = w ? await w.unwrap(row.wrapped, org) : null;
  if (!k || k.id !== row.key_id) return null;
  if (current && w !== current) {
    const { error } = await db().from("org_keys").update({ wrapped: await current.wrap(k, org), wrap_key_id: current.id, updated_at: new Date().toISOString() }).eq("key_id", row.key_id);
    if (error) console.error("[vault] rewrap", error.message);
  }
  return k;
}

/**
 * The current org's data key. With `make`, one is made (and wrapped) when the org has none.
 * Null when the org has none yet, or no wrapping key opens it.
 */
async function orgKey(make: boolean): Promise<VaultKey | null> {
  const org = await orgId();
  const hit = orgKeyCache.get(org);
  if (hit && Date.now() - hit.at < ORG_KEY_MS) return hit.key;
  let row = await readOrgKeyRow();
  if (!row && make) {
    const w = wrappers().current;
    if (!w) throw new Error(VAULT_MISSING);
    const k = newDataKey();
    const { error } = await db().from("org_keys").insert({ key_id: k.id, wrapped: await w.wrap(k, org), wrap_key_id: w.id });
    if (error && error.code !== "23505") throw new Error(error.message);
    row = await readOrgKeyRow();
  }
  if (!row) return null;
  const k = await unwrapRow(row, org);
  if (k) orgKeyCache.set(org, { key: k, at: Date.now() });
  return k;
}

/** Seals a sign-in for the database: the current org's data key, bound to the org. */
async function sealSecret(value: unknown): Promise<string> {
  const k = await orgKey(true);
  if (!k) throw new Error("This org's vault key can't be opened with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD.");
  return sealWith(value, k, await orgId());
}

/** Opens a saved sign-in: the org's data key for a v3 value, the env keys for one sealed before slice 4. */
async function openSecret<T>(sealed: string): Promise<T | null> {
  if (!isBound(sealed)) return openWith<T>(sealed, keys().all);
  const k = await orgKey(false);
  return k ? openWith<T>(sealed, [k], await orgId()) : null;
}

// ---- Who a connection is for: a built-in server's profile in code, or a custom server's row.

interface Prof { id: string; name: string; url: string; kind: "oauth" | "google" | "token" | "custom"; customAuth?: CustomAuth; scopes: readonly string[] }
const builtIn = (id: McpId): Prof => ({ id, name: MCP_SERVERS[id].name, url: MCP_SERVERS[id].url, kind: MCP_SERVERS[id].auth, scopes: MCP_SERVERS[id].scopes });
const customProf = (c: CustomServer): Prof => ({ id: c.id, name: c.name, url: c.url, kind: "custom", customAuth: c.auth, scopes: c.scopes });
/** Signed in on the server's own page with dynamic client registration: hosted servers and custom ones that use it. */
const signsInOwnPage = (p: Prof) => p.kind === "oauth" || (p.kind === "custom" && p.customAuth === "oauth");
/** A pasted key rather than a sign-in page. */
const usesKey = (p: Prof) => p.kind === "token" || (p.kind === "custom" && p.customAuth === "key");

// ---- The stored connection.

interface Secret { clientId: string; clientSecret: string | null; tokenEndpoint: string; revocationEndpoint?: string | null; tokens: Tokens }
/** A key pasted on Connections, for a server we run ourselves. */
interface KeySecret { key: string }
export interface McpStatus { connected: boolean; paused: boolean; connectedAt: string | null; lastError: string | null; settings: Record<string, string>; toolsCheckedAt: string | null; toolsSeen: string[] }
export interface McpLogRow { event: McpEvent; detail: string | null; at: string }
export const MCP_MISSING = "The MCP tables aren't set up yet: apply the mcp_connections, mcp_vault and mcp_tool_check migrations in supabase/migrations.";
const missing = (m: string) => /relation .* does not exist|schema cache|column .* does not exist/i.test(m);

type Row = { id: string; secret: string | null; settings: Record<string, string> | null; connected_at: string | null; last_error: string | null; paused_at: string | null; tools_seen: Record<string, string> | null; tools_checked_at: string | null };

async function row(id: string): Promise<Row | null> {
  const { data, error } = await db().from("mcp_connections").select("id, secret, settings, connected_at, last_error, paused_at, tools_seen, tools_checked_at").eq("id", id).maybeSingle();
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  return data as Row | null;
}

/** One line in the sign-in log. Best effort: a missing log never stops a run. Never a token. */
async function logEvent(id: string, event: McpEvent, detail?: string, secrets: (string | null | undefined)[] = []) {
  try { await db().from("mcp_connection_events").insert({ connection_id: id, event, detail: detail ? scrubSecrets(detail, secrets).slice(0, 300) : null }); } catch { /* the log is a record, not a gate */ }
}

/** The last few sign-in events for one server, newest first. */
export async function mcpLog(id: string, limit = 6): Promise<McpLogRow[]> {
  const { data, error } = await db().from("mcp_connection_events").select("event, detail, at").eq("connection_id", id).order("at", { ascending: false }).limit(limit);
  return error ? [] : (data as McpLogRow[]);
}

/** Whether the server is signed in, and its saved choices (the email list). Null when the tables are missing. */
export async function mcpStatus(id: string): Promise<McpStatus | null> {
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

async function store(id: string, s: Secret | KeySecret) {
  const now = new Date().toISOString();
  const { error } = await db().from("mcp_connections").upsert({ id, secret: await sealSecret(s), connected_at: now, last_error: null, paused_at: null, updated_at: now }, { onConflict: "id" });
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
}

/** Stops a connection until the owner signs in again, so a dead sign-in isn't retried on every call. */
async function pause(id: string, e: string, event: McpEvent, secrets: (string | null | undefined)[]) {
  const text = scrubSecrets(e, secrets).slice(0, 300);
  await db().from("mcp_connections").update({ last_error: text, paused_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  await logEvent(id, event, text);
}

/** The sign-in, opened. Moves it onto the org's data key when it is sealed any other way. */
async function readSecret<T = Secret>(id: string, r: Row): Promise<T | null> {
  if (!r.secret) return null;
  const s = await openSecret<T>(r.secret);
  if (!s) return null;
  const k = isBound(r.secret) ? await orgKey(false) : null;
  if (!k || keyIdOf(r.secret) !== k.id) {
    try {
      const sealed = await sealSecret(s);
      const { error } = await db().from("mcp_connections").update({ secret: sealed, updated_at: new Date().toISOString() }).eq("id", id);
      if (!error) await logEvent(id, "resealed", `moved onto this org's key ${keyIdOf(sealed)}`);
    } catch (e) { console.error("[vault] reseal", e instanceof Error ? e.message : e); }
  }
  return s;
}

export interface VaultState { keySet: boolean; tooShort: boolean; oldKeySet: boolean; keyId: string | null; onOtherKey: string[]; unreadable: string[] }

/** Is MCP_SECRET_KEY set, and is every saved sign-in sealed with this org's data key. Never shows a key. */
export async function vaultState(): Promise<VaultState | null> {
  const { current } = keys();
  const base = { keySet: !!current, tooShort: !!env.mcpSecretKey && !current, oldKeySet: usable(env.mcpSecretKeyOld) };
  const { data, error } = await db().from("mcp_connections").select("id, secret").not("secret", "is", null);
  if (error) return null;
  let k: VaultKey | null = null;
  try { k = await orgKey(false); } catch { return null; }
  const rows = data as { id: string; secret: string }[];
  const opened = await Promise.all(rows.map(async (r) => ({ id: r.id, ok: (await openSecret(r.secret)) !== null, onOrgKey: !!k && isBound(r.secret) && keyIdOf(r.secret) === k.id })));
  return {
    ...base,
    keyId: k?.id ?? null,
    onOtherKey: opened.filter((r) => r.ok && !r.onOrgKey).map((r) => r.id),
    unreadable: opened.filter((r) => !r.ok).map((r) => r.id),
  };
}

/**
 * Re-seals every saved sign-in of the current org with its data key (made if it has none), and
 * rewraps that key with MCP_SECRET_KEY. After this, MCP_SECRET_KEY_OLD can be removed.
 */
export async function resealAll(): Promise<{ moved: number; unreadable: string[] }> {
  if (!keys().current) throw new Error(VAULT_MISSING);
  const k = await orgKey(true);
  if (!k) throw new Error("This org's vault key can't be opened with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD.");
  const { data, error } = await db().from("mcp_connections").select("id, secret").not("secret", "is", null);
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  let moved = 0;
  const unreadable: string[] = [];
  for (const r of data as { id: string; secret: string }[]) {
    if (isBound(r.secret) && keyIdOf(r.secret) === k.id) continue;
    const s = await openSecret<Secret>(r.secret);
    if (!s) { unreadable.push(r.id); continue; }
    const u = await db().from("mcp_connections").update({ secret: sealWith(s, k, await orgId()), updated_at: new Date().toISOString() }).eq("id", r.id);
    if (u.error) throw new Error(u.error.message);
    await logEvent(r.id, "resealed", `moved onto this org's key ${k.id}`);
    moved++;
  }
  return { moved, unreadable };
}

/**
 * Asks the server to cancel the sign-in (RFC 7009) where it has a revoke address, then forgets it
 * here either way. Says whether the server confirmed.
 */
export const disconnectMcp = (id: McpId) => disconnectProf(builtIn(id));

async function disconnectProf(p: Prof): Promise<{ revoked: boolean; note: string | null }> {
  const id = p.id;
  const r = await row(id);
  let revoked = false, note: string | null = null;
  if (usesKey(p)) {
    // a pasted key can't be cancelled through the API; it stops working when it is rotated at the service
    if (r?.secret) {
      note = `${p.name} keys can't be cancelled from here. To make this one stop working too, rotate it (or uninstall the app) in ${p.name}'s settings.`;
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
    if (!endpoint && signsInOwnPage(p)) { try { endpoint = (await discover(p.url, p.kind === "custom")).revocation_endpoint ?? null; } catch { endpoint = null; } }
    const secrets = [s.tokens.accessToken, s.tokens.refreshToken, s.clientSecret];
    if (!endpoint) note = `${p.name} has no revoke address, so remove the app in its own settings too.`;
    else {
      try {
        if (p.kind === "custom") await assertPublic(endpoint);
        const tries = [
          ...(s.tokens.refreshToken ? [{ token: s.tokens.refreshToken, token_type_hint: "refresh_token" }] : []),
          { token: s.tokens.accessToken, token_type_hint: "access_token" },
        ];
        // Google: cancelling the refresh token cancels its access tokens too, and takes only the token
        const res = p.kind === "google"
          ? [await fetchJson(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tries[0].token }) })]
          : await Promise.all(tries.map((t) => tokenRequest(endpoint!, s.clientId, s.clientSecret, t)));
        revoked = res.every((x) => x.ok);
        if (!revoked) note = scrubSecrets(`${p.name} didn't confirm the cancel (${res.map((x) => x.status).join(", ")}). Remove the app in its own settings too.`, secrets);
      } catch (e) {
        note = scrubSecrets(`${p.name} couldn't be reached to cancel the sign-in (${e instanceof Error ? e.message : String(e)}). Remove the app in its own settings too.`, secrets);
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

/**
 * A custom server's host (or any address its sign-in details name) must resolve only to public
 * addresses, checked right before each request, so an address can't reach inside our hosting.
 */
async function assertPublic(url: string): Promise<void> {
  const c = checkAddress(url);
  if ("problem" in c) throw new Error(`${url.slice(0, 80)} can't be called: ${c.problem}`);
  const host = new URL(c.url).hostname;
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true, verbatim: true }); } catch { throw new Error(`couldn't find ${host}`); }
  if (!addrs.length || addrs.some((a) => !isPublicIp(a.address))) throw new Error(`${host} points at a private address, so it isn't called`);
}

/** `strict` (custom servers): no redirects, and every address is checked before it is fetched. */
async function firstJson(urls: string[], strict = false): Promise<unknown> {
  for (const u of urls) {
    try {
      if (strict) await assertPublic(u);
      const r = await fetchJson(u, { redirect: strict ? "error" : "follow", headers: { Accept: "application/json" } });
      if (r.ok && r.json) return r.json;
    } catch { /* try the next */ }
  }
  return null;
}

/**
 * The server's sign-in details: from its protected-resource document, else its own origin. For a
 * custom server (`strict`) every address the details name must be a public https host too.
 */
async function discover(serverUrl: string, strict = false): Promise<AuthServer> {
  const d = discoveryUrls(serverUrl);
  const pr = await firstJson(d.resource, strict) as { authorization_servers?: unknown } | null;
  const issuers = Array.isArray(pr?.authorization_servers) ? (pr!.authorization_servers as unknown[]).filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x) && (!strict || "url" in checkAddress(x))) : [];
  for (const issuer of [...issuers, new URL(serverUrl).origin]) {
    const a = readAuthServer(await firstJson(d.authServer(issuer), strict));
    if (!a) continue;
    if (strict) {
      const named = [a.authorization_endpoint, a.token_endpoint, a.registration_endpoint, a.revocation_endpoint].filter((x): x is string => !!x);
      const bad = named.find((x) => "problem" in checkAddress(x));
      if (bad) throw new Error(`the server's sign-in details point at an address that can't be used (${bad.slice(0, 80)})`);
    }
    return a;
  }
  throw new Error("couldn't find the server's sign-in details");
}

const b64url = (b: Buffer) => b.toString("base64url");

/** What the browser keeps (sealed, in a short-lived cookie) between leaving for the sign-in page and coming back. */
interface Pending { id: string; state: string; verifier: string; clientId: string; clientSecret: string | null; tokenEndpoint: string; revocationEndpoint: string | null; redirectUri: string; at: number }
export const PENDING_COOKIE = "cr_mcp_pending";
export const PENDING_MINUTES = 10;

/** Registers the Control Room with the server and returns where to send the owner, plus the sealed pending state. */
export async function startConnect(id: string, redirectUri: string): Promise<{ url: string; pending: string }> {
  const prof = await profOf(id);
  if (usesKey(prof)) throw new Error(`${prof.name} is connected by pasting its key on Connections.`);
  if (!keys().current) throw new Error(VAULT_MISSING);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(18));
  if (prof.kind === "google") {
    // our own Google OAuth client: its secret stays in Vercel and is never put in the cookie or the vault
    if (!env.gmailClientId || !env.gmailClientSecret) throw new Error("set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel (the business's Google OAuth client) first");
    const url = authorizeUrl(GOOGLE_AUTH, { clientId: env.gmailClientId, redirectUri, challenge, state, scope: prof.scopes.join(" "), extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" } });
    const p: Pending = { id, state, verifier, clientId: env.gmailClientId, clientSecret: null, tokenEndpoint: GOOGLE_AUTH.token_endpoint, revocationEndpoint: GOOGLE_AUTH.revocation_endpoint ?? null, redirectUri, at: Date.now() };
    return { url, pending: seal(p) };
  }
  const custom = prof.kind === "custom";
  const a = await discover(prof.url, custom);
  // a custom server: only the scopes the owner ticked, or none at all; never the server's whole list
  const scope = custom ? (prof.scopes.length ? prof.scopes.join(" ") : undefined) : pickScopes(prof.scopes, a.scopes_supported).scope;
  if (!a.registration_endpoint) throw new Error("the server doesn't let apps register themselves, so it can't be connected this way. Try adding it with a key instead");
  if (custom) await assertPublic(a.registration_endpoint);
  const reg = await fetchJson(a.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  const client = (reg.json ?? {}) as { client_id?: string; client_secret?: string };
  if (!reg.ok || !client.client_id) throw new Error(`the server didn't register the app (${reg.status}): ${scrubSecrets(reg.text).slice(0, 160)}`);
  const url = authorizeUrl(a, { clientId: client.client_id, redirectUri, challenge, state, resource: resourceOf(prof.url), scope });
  const p: Pending = { id, state, verifier, clientId: client.client_id, clientSecret: client.client_secret ?? null, tokenEndpoint: a.token_endpoint, revocationEndpoint: a.revocation_endpoint ?? null, redirectUri, at: Date.now() };
  return { url, pending: seal(p) };
}

/** The client secret for a token request: Google's lives only in Vercel (GMAIL_CLIENT_SECRET). */
const clientSecretOf = (p: Prof, stored: string | null) => (p.kind === "google" ? env.gmailClientSecret ?? null : stored);
/** RFC 8707 resource: servers that sign in on their own page only (Google doesn't take it). The token is for that address alone. */
const resourceFor = (p: Prof): Record<string, string> => (signsInOwnPage(p) ? { resource: resourceOf(p.url) } : {});

async function tokenRequest(endpoint: string, clientId: string, clientSecret: string | null, form: Record<string, string>) {
  const body = new URLSearchParams({ ...form, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) });
  return fetchJson(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
}

/** Back from the sign-in page: checks the state, trades the code for a token and keeps it. */
export async function finishConnect(id: string, sealedPending: string | undefined, q: { code?: string | null; state?: string | null; error?: string | null }) {
  if (q.error) throw new Error(`the sign-in was not finished (${q.error.slice(0, 80)})`);
  const p = sealedPending ? open<Pending>(sealedPending) : null;
  if (!p || p.id !== id || Date.now() - p.at > PENDING_MINUTES * 60_000) throw new Error("the sign-in took too long or was started elsewhere. Tap Connect again.");
  if (!q.code || !q.state || q.state !== p.state) throw new Error("the sign-in didn't match the one started here. Tap Connect again.");
  const prof = await profOf(id);
  const secret = clientSecretOf(prof, p.clientSecret);
  if (prof.kind === "custom") await assertPublic(p.tokenEndpoint);
  const r = await tokenRequest(p.tokenEndpoint, p.clientId, secret, { grant_type: "authorization_code", code: q.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, ...resourceFor(prof) });
  const tokens = r.ok ? readTokens(r.json, Date.now()) : null;
  if (!tokens) throw new Error(`the server didn't hand over a token (${r.status}): ${scrubSecrets(r.text, [q.code, secret, p.verifier]).slice(0, 160)}`);
  if (prof.kind === "google") {
    // exactly the profile's scope, or the sign-in is cancelled at Google and not kept
    const secrets = [tokens.accessToken, tokens.refreshToken, secret];
    const problem = scopeProblem(grantedScopes(r.json), prof.scopes) ?? (tokens.refreshToken ? null : "Google didn't hand over a refresh token");
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
  await logEvent(id, "connected", undefined, [tokens.accessToken, tokens.refreshToken]);
  // a custom server: read its tools (all off). Tools already on are checked, never accepted by signing in.
  if (prof.kind === "custom") { try { await checkCustomServer(id); } catch { /* shown on its page */ } return; }
  // signing in accepts the server's tools as they are now; a tool the profile needs that's gone still pauses it
  try { await toolCheck(id as McpId, true); } catch { /* unreachable now: the first call checks */ }
}

/** A token good for at least a minute, refreshed (and kept) when it's about to run out. */
async function accessToken(p: Prof, o: { evenIfPaused?: boolean } = {}): Promise<{ token: string; secrets: (string | null)[]; row: Row }> {
  const { id, name } = p;
  if (p.kind === "token") throw new Error(`${name} runs on our own server with a pasted key: use callLocalTool.`);
  const r = await row(id);
  if (r?.paused_at && !o.evenIfPaused) throw new Error(`${name} is paused: ${r.last_error ?? "its sign-in stopped working"}. ${usesKey(p) ? "Paste a new key" : "Tap Sign in again"} on Connections.`);
  if (usesKey(p)) {
    // a custom server's pasted key, sent as a bearer token to that server's address only
    const k = r ? await readSecret<KeySecret>(id, r) : null;
    if (!k?.key) throw new Error(r?.secret ? `${name}'s key can't be unlocked with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD. Paste it again on Connections.` : `${name} isn't connected. Paste its key on Connections.`);
    return { token: k.key, secrets: [k.key], row: r! };
  }
  const s = r ? await readSecret(id, r) : null;
  if (!s) throw new Error(r?.secret ? `${name}'s sign-in can't be unlocked with MCP_SECRET_KEY or MCP_SECRET_KEY_OLD. Tap Sign in again on Connections.` : `${name} isn't connected. Tap Connect on Connections.`);
  const clientSecret = clientSecretOf(p, s.clientSecret);
  const secrets = [s.tokens.accessToken, s.tokens.refreshToken, clientSecret];
  if (!needsRefresh(s.tokens, Date.now())) return { token: s.tokens.accessToken, secrets, row: r! };
  if (!s.tokens.refreshToken) { await pause(id, `${name}'s sign-in ran out`, "refresh_failed", secrets); throw new Error(`${name}'s sign-in ran out. Tap Sign in again on Connections.`); }
  if (p.kind === "custom") await assertPublic(s.tokenEndpoint);
  const t = await tokenRequest(s.tokenEndpoint, s.clientId, clientSecret, { grant_type: "refresh_token", refresh_token: s.tokens.refreshToken, ...resourceFor(p) });
  // a new refresh token replaces the old one at once; the old one is kept only when none is sent
  const tokens = t.ok ? readTokens(t.json, Date.now(), s.tokens.refreshToken) : null;
  if (!tokens) {
    const e = `${name}'s sign-in couldn't be renewed (${t.status})`;
    await pause(id, e, "refresh_failed", secrets);
    throw new Error(`${e}. Tap Sign in again on Connections.`);
  }
  const { error } = await db().from("mcp_connections").update({ secret: await sealSecret({ ...s, tokens }), last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent(id, "refreshed");
  return { token: tokens.accessToken, secrets: [tokens.accessToken, tokens.refreshToken, ...secrets], row: r! };
}

// ---- The MCP client: initialize, then one tools/call. A short session per call keeps it simple
// on serverless, where nothing stays warm between runs.

class Refused extends Error {}

async function rpc(url: string, token: string, session: string | null, id: number | null, method: string, params: unknown, timeout = TIMEOUT_MS) {
  const res = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout),
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
type Call = (method: string, params: unknown) => Promise<unknown>;

/** initialize, then the requests `work` makes, on one short session with a token code already holds. */
async function session<T>(p: Prof, token: string, work: (call: Call) => Promise<T>): Promise<T> {
  const custom = p.kind === "custom";
  const timeout = custom ? CUSTOM_TIMEOUT_MS : TIMEOUT_MS;
  if (custom) await assertPublic(p.url);
  const init = await rpc(p.url, token, null, 1, "initialize", { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: CLIENT_NAME, version: "1" } }, timeout);
  if (init.reply && "error" in init.reply) throw new Error(`${p.name}: ${init.reply.error}`);
  await rpc(p.url, token, init.session, null, "notifications/initialized", {}, timeout).catch(() => undefined);
  let n = 1;
  return work(async (method, params) => {
    const res = await rpc(p.url, token, init.session, ++n, method, params, timeout);
    if (!res.reply || "error" in res.reply) throw new Error(`${p.name} ${method}: ${res.reply && "error" in res.reply ? res.reply.error : "no answer"}`);
    return res.reply.result;
  });
}

async function withSession<T>(p: Prof, work: (call: Call, row: Row) => Promise<T>, o: { evenIfPaused?: boolean } = {}): Promise<T> {
  const { token, secrets, row: r } = await accessToken(p, o);
  try {
    return await session(p, token, (call) => work(call, r));
  } catch (e) {
    const msg = scrubSecrets(e instanceof Error ? e.message : String(e), secrets);
    if (e instanceof Refused) { await pause(p.id, msg, "refused", secrets); throw new Error(`${p.name}: ${msg}. ${usesKey(p) ? "Paste a new key" : "Tap Sign in again"} on Connections.`); }
    throw new Error(msg);
  }
}

async function listAll(call: Call): Promise<ListedTool[]> {
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

/** Every tool a server lists, as it sent them (names, descriptions, inputs, annotations), at most 10 pages. */
async function listRaw(call: Call): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r = (await call("tools/list", cursor ? { cursor } : {})) as { tools?: unknown; nextCursor?: unknown } | null;
    if (Array.isArray(r?.tools)) all.push(...r.tools);
    cursor = typeof r?.nextCursor === "string" && r.nextCursor ? r.nextCursor : null;
    if (!cursor) break;
  }
  return all;
}

/**
 * The tool check (slice 3): the profile's read tools must still be on the server, with the inputs
 * accepted last time. `accept` (signing in) takes the inputs as they are now. A failed check pauses
 * the server with what changed, until the owner signs in again.
 */
async function toolCheck(id: McpId, accept: boolean): Promise<void> {
  await withSession(builtIn(id), async (call, r) => {
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
  return traced("tool_call", { "operator.server": id, "operator.tool": tool, "operator.tool_kind": "read" }, () => {
    if (isGoogle(id)) return callGoogleTool(id, tool, args);
    if (!isHosted(id)) return callLocalTool(id, tool, args);
    return callRemote(id, tool, args);
  });
}

/**
 * Calls one of a server's write tools. Only core/gateway imports this (lint enforces it), and only
 * after an approver approved the action and the gateway re-checked it against live data.
 */
export async function callWriteTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!mayWrite(id, tool)) throw new Error(`${tool} isn't a write tool the gateway may call on ${MCP_SERVERS[id].name}.`);
  return traced("tool_call", { "operator.server": id, "operator.tool": tool, "operator.tool_kind": "write" }, () => {
    if (isGoogle(id)) return callGoogleTool(id, tool, args);
    if (isHosted(id)) return callRemote(id, tool, args);
    return localCall(id, tool, args, true);
  });
}

/**
 * One tools/call to our own Gmail server (slice 6), with an access token the vault opens and renews
 * for this profile's sign-in. The server serves only this profile's tools. Errors are scrubbed; a
 * token Google no longer accepts pauses the sign-in.
 */
async function callGoogleTool(id: McpId, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const name = MCP_SERVERS[id].name;
  const { token, secrets } = await accessToken(builtIn(id));
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
  return withSession(builtIn(id), async (call) => {
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
  const { error } = await db().from("mcp_connections").upsert({ id, secret: await sealSecret({ key } satisfies KeySecret), connected_at: now, last_error: null, paused_at: null, updated_at: now }, { onConflict: "id" });
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

/** `write`: only callWriteTool passes true, for a profile's write tool (the gateway, after an approver approves). */
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

// ---- Custom servers (docs/custom-servers.md, slice 1): added by the owner by address. Their
// profile is a mcp_custom_servers row; their sign-in sits in mcp_connections under the same id,
// sealed in the vault. Every tool starts off; the limits are in core/custom-mcp-rules.ts.

type CustomRow = { id: string; name: string; url: string; auth: CustomAuth; scopes: string[] | null; scopes_offered: string[] | null; tools: CustomTool[] | null; tools_on: Record<string, ToolOn> | null };
export const CUSTOM_MISSING = "The custom servers table isn't set up yet: apply supabase/migrations/20261130090000_custom_mcp_servers.sql.";
const CUSTOM_COLS = "id, name, url, auth, scopes, scopes_offered, tools, tools_on";
const toCustom = (r: CustomRow): CustomServer => ({ id: r.id, name: r.name, url: r.url, auth: r.auth, scopes: r.scopes ?? [], scopesOffered: r.scopes_offered ?? [], tools: r.tools ?? [], toolsOn: r.tools_on ?? {} });

/** Every custom server, oldest first. Empty when the table is missing. */
export async function listCustomServers(): Promise<CustomServer[]> {
  const { data, error } = await db().from("mcp_custom_servers").select(CUSTOM_COLS).order("created_at");
  if (error) return [];
  return (data as CustomRow[]).map(toCustom);
}

export async function getCustomServer(id: string): Promise<CustomServer | null> {
  if (!isCustomId(id)) return null;
  const { data, error } = await db().from("mcp_custom_servers").select(CUSTOM_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(missing(error.message) ? CUSTOM_MISSING : error.message);
  return data ? toCustom(data as CustomRow) : null;
}

async function profOf(id: string): Promise<Prof> {
  if (isMcpId(id)) return builtIn(id);
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  return customProf(c);
}

async function updateCustom(id: string, patch: Record<string, unknown>) {
  const { error } = await db().from("mcp_custom_servers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(missing(error.message) ? CUSTOM_MISSING : error.message);
}

/**
 * Adds a server by its address, with every tool off and nothing signed in yet. The address must be
 * a public https host. For a server that signs in on its own page, its sign-in details are read
 * now (and checked) so the owner can tick scopes before connecting.
 */
export async function addCustomServer(input: { name: string; url: string; auth: string }): Promise<string> {
  const n = checkServerName(input.name);
  if ("problem" in n) throw new Error(n.problem);
  const a = checkAddress(input.url);
  if ("problem" in a) throw new Error(a.problem);
  if (input.auth !== "oauth" && input.auth !== "key") throw new Error("Pick how the server signs in.");
  if (!keys().current) throw new Error(VAULT_MISSING);
  for (const id of MCP_IDS) if (resourceOf(MCP_SERVERS[id].url) === resourceOf(a.url)) throw new Error(`That’s the ${MCP_SERVERS[id].name} server, which is already on Connections.`);
  const have = await listCustomServers();
  if (have.length >= MAX_CUSTOM_SERVERS) throw new Error(`There are already ${MAX_CUSTOM_SERVERS} custom servers. Remove one first.`);
  if (have.some((c) => resourceOf(c.url) === resourceOf(a.url))) throw new Error("That server is already on Connections.");
  await assertPublic(a.url);
  let offered: string[] = [];
  if (input.auth === "oauth") {
    let auth: AuthServer;
    try { auth = await discover(a.url, true); } catch (e) { throw new Error(`Couldn’t read how ${n.name} signs in (${e instanceof Error ? e.message : String(e)}). If it gave you a key, add it with a key instead.`); }
    if (!auth.registration_endpoint) throw new Error(`${n.name} doesn’t let apps register themselves, so it can’t sign in on its own page from here. If it gave you a key, add it with a key instead.`);
    offered = (auth.scopes_supported ?? []).filter((s) => s.length <= 120 && !/\s/.test(s)).slice(0, 60);
  }
  let id = "";
  for (let i = 0; i < 5 && !id; i++) { const c = `c_${randomBytes(6).toString("hex").slice(0, 8)}`; if (CUSTOM_ID.test(c) && !have.some((h) => h.id === c)) id = c; }
  const { error } = await db().from("mcp_custom_servers").insert({ id, name: n.name, url: a.url, auth: input.auth, scopes_offered: offered });
  if (error) throw new Error(missing(error.message) ? CUSTOM_MISSING : error.message);
  await logEvent(id, "added", `${n.name} at ${new URL(a.url).host}, ${input.auth === "oauth" ? "signs in on its own page" : "with a key"}`);
  return id;
}

/** The scopes to ask for when connecting: only ones the owner ticked and the server offers. Nothing is ticked to start. */
export async function saveCustomScopes(id: string, chosen: string[]): Promise<void> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const s = checkScopes(chosen, c.scopesOffered);
  if ("problem" in s) throw new Error(s.problem);
  await updateCustom(id, { scopes: s.scopes });
}

/**
 * Locks a custom server's key in the vault, after the server accepts it (it must answer
 * initialize and tools/list with it). The key is never echoed back, logged or shown.
 */
export async function saveCustomKey(id: string, pasted: string): Promise<{ tools: number }> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  if (c.auth !== "key") throw new Error(`${c.name} signs in on its own page, not with a key.`);
  if (!keys().current) throw new Error(VAULT_MISSING);
  const key = pasted.trim().replace(/^Bearer\s+/i, "");
  if (!looksLikeKey(key)) throw new Error("That doesn’t look like a key: one line, no spaces.");
  let raw: unknown[];
  try { raw = await session(customProf(c), key, listRaw); } catch (e) {
    const msg = scrubSecrets(e instanceof Error ? e.message : String(e), [key]).slice(0, 160);
    throw new Error(e instanceof Refused ? `${c.name} didn’t accept that key.` : `Couldn’t reach ${c.name} with that key: ${msg}`);
  }
  await store(id, { key });
  await logEvent(id, "connected", `${raw.length} tools listed`, [key]);
  await saveSnapshot(c, readToolList(raw));
  return { tools: raw.length };
}

/** Keeps the server's tool list as seen now (new tools arrive off) and notes when it was checked. */
async function saveSnapshot(c: CustomServer, live: CustomTool[]) {
  await updateCustom(c.id, { tools: live });
  await db().from("mcp_connections").update({ tools_checked_at: new Date().toISOString() }).eq("id", c.id);
}

export interface CustomCheckResult { ok: boolean; note: string; tools: number; turnedOff: string[] }

/**
 * The tool check for a custom server: the tools turned on must be exactly as they were when the
 * owner turned them on (name, description, inputs, read-only). Any difference pauses the server
 * until the owner looks at it and accepts it (`accept`). Runs before every run that uses the
 * server (slice 2), and from the server's page.
 */
export async function checkCustomServer(id: string, accept = false, o: { quiet?: boolean } = {}): Promise<CustomCheckResult> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const r = await row(id);
  // accepting may clear a pause the tool check made, never one for a refused sign-in or the owner's own
  const toolsPause = !!r?.paused_at && (r.last_error ?? "").startsWith("the server ");
  const live = readToolList(await withSession(customProf(c), listRaw, { evenIfPaused: accept && toolsPause }));
  const now = new Date().toISOString();
  if (accept) {
    const a = acceptTools(c.toolsOn, live);
    await updateCustom(id, { tools: live, tools_on: a.on });
    await db().from("mcp_connections").update({ tools_checked_at: now, ...(toolsPause ? { paused_at: null, last_error: null } : {}), updated_at: now }).eq("id", id);
    await logEvent(id, "tools_accepted", a.turnedOff.length ? `accepted; turned off ${a.turnedOff.join(", ")}` : "accepted as they are now");
    return { ok: true, note: "", tools: live.length, turnedOff: a.turnedOff };
  }
  const note = customCheckNote(checkCustomTools(c.toolsOn, live));
  if (note) {
    // keep the list as the server has it now, so its page can show what changed next to what was accepted
    await updateCustom(id, { tools: live });
    await db().from("mcp_connections").update({ paused_at: now, last_error: `${note}. Look at the change, then accept it`, updated_at: now }).eq("id", id);
    await logEvent(id, "tools_changed", note);
    return { ok: false, note, tools: live.length, turnedOff: [] };
  }
  await saveSnapshot(c, live);
  // the check before every run is quiet when it passes, so the log keeps what matters
  if (!o.quiet) await logEvent(id, "tools_checked", `${Object.keys(c.toolsOn).length} turned-on tools as accepted, ${live.length} listed`);
  return { ok: true, note: "", tools: live.length, turnedOff: [] };
}

/**
 * Turns a tool on, with the name and line agents get and any pinned inputs, or off (`on` null).
 * Only a tool in the accepted list that only reads and takes plain inputs can be turned on, and
 * only while the server is connected and not paused. Turning a tool on grants it to nobody: that is
 * the builder's Tools step (slice 2).
 */
export async function setCustomTool(id: string, tool: string, on: { label: string; line: string; pins: Record<string, unknown> } | null): Promise<void> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const next = { ...c.toolsOn };
  if (!on) {
    if (!next[tool]) return;
    delete next[tool];
    await updateCustom(id, { tools_on: next });
    await logEvent(id, "tool_off", tool);
    return;
  }
  const s = await mcpStatus(id);
  if (!s?.connected) throw new Error(`Connect ${c.name} first.`);
  if (s.paused) throw new Error(`${c.name} is paused. Sort that out first.`);
  const t = c.tools.find((x) => x.name === tool);
  if (!t) throw new Error("That tool isn’t in the server’s list. Tap Check tools now.");
  const why = cantTurnOn(t);
  if (why) throw new Error(why);
  const l = checkLabel(on.label);
  if ("problem" in l) throw new Error(l.problem);
  const ln = checkLine(on.line);
  if ("problem" in ln) throw new Error(ln.problem);
  const pins = checkPins(t.inputs, on.pins);
  if ("problem" in pins) throw new Error(pins.problem);
  const was = !!next[tool];
  next[tool] = { label: l.label, line: ln.line, pins: pins.pins, fingerprint: t.fingerprint };
  await updateCustom(id, { tools_on: next });
  await logEvent(id, "tool_on", `${tool}${was ? " (edited)" : ""} as “${l.label}”${Object.keys(pins.pins).length ? `, pinned ${Object.keys(pins.pins).join(", ")}` : ""}`);
}

// ---- Slice 2: agents call turned-on custom tools. Only core/tools/custom.ts calls these.

export interface CustomReady { id: string; server: CustomServer | null; ok: boolean; why: string }

/**
 * Before a run that uses custom servers: each must still be on Connections, connected and not
 * paused, and its tool check must pass right now. A server that fails any of these offers the run
 * none of its tools.
 */
export async function readyCustomServers(ids: readonly string[]): Promise<CustomReady[]> {
  return Promise.all([...new Set(ids)].map(async (id): Promise<CustomReady> => {
    try {
      const c = await getCustomServer(id);
      if (!c) return { id, server: null, ok: false, why: "it isn’t on Connections any more" };
      const s = await mcpStatus(id);
      if (!s?.connected) return { id, server: c, ok: false, why: `${c.name} isn’t connected` };
      if (s.paused) return { id, server: c, ok: false, why: `${c.name} is paused (${s.lastError ?? "its sign-in stopped working"})` };
      const chk = await checkCustomServer(id, false, { quiet: true });
      if (!chk.ok) return { id, server: c, ok: false, why: `${c.name} is paused: ${chk.note}` };
      return { id, server: (await getCustomServer(id)) ?? c, ok: true, why: "" };
    } catch (e) {
      return { id, server: null, ok: false, why: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }));
}

/**
 * One call to a turned-on custom tool, with the agent's checked inputs and the owner's pins laid
 * over them. The tool must still be on and exactly as accepted. The reply is the server's: text,
 * cut to the limit, for the runner to hand over as untrusted data.
 */
export async function callCustomTool(id: string, tool: string, checked: Record<string, string | number>): Promise<string> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const on = c.toolsOn[tool], t = c.tools.find((x) => x.name === tool);
  if (!on || !t) throw new Error(`${tool} isn't turned on for ${c.name}.`);
  if (cantTurnOn(t) || t.fingerprint !== on.fingerprint) throw new Error(`${c.name} changed ${tool}. Accept the change on Connections first.`);
  const a = customArgs(t.inputs, on.pins, checked);
  if ("problem" in a) throw new Error(`Input refused: ${a.problem}`);
  return traced("tool_call", { "operator.server": "custom", "operator.tool": tool, "operator.tool_kind": "custom" }, () => withSession(customProf(c), async (call) => {
    const out = toolPayload(await call("tools/call", { name: tool, arguments: a.args }));
    if ("error" in out) throw new Error(`${c.name} ${tool}: ${out.error.slice(0, 200)}`);
    return customReply(out.data);
  }));
}

const OWNER_PAUSE = "Paused by you";

/** The owner's own pause for every agent, and lifting it. Lifting never clears a pause for a refused sign-in or changed tools. */
export async function pauseCustom(id: string, paused: boolean): Promise<void> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const r = await row(id);
  if (!r?.secret) throw new Error(`${c.name} isn’t connected.`);
  const now = new Date().toISOString();
  if (paused) {
    if (r.paused_at) return;
    await db().from("mcp_connections").update({ paused_at: now, last_error: OWNER_PAUSE, updated_at: now }).eq("id", id);
    await logEvent(id, "paused", "by you");
    return;
  }
  if (!r.paused_at) return;
  if (r.last_error !== OWNER_PAUSE) throw new Error(`${c.name} was paused because ${r.last_error ?? "its sign-in stopped working"}. Fix that instead.`);
  await db().from("mcp_connections").update({ paused_at: null, last_error: null, updated_at: now }).eq("id", id);
  await logEvent(id, "resumed", "by you");
}

/** Removes a custom server: the sign-in is cancelled where the server allows it and forgotten, then its row goes. The log stays. */
export async function removeCustomServer(id: string): Promise<{ revoked: boolean; note: string | null }> {
  const c = await getCustomServer(id);
  if (!c) throw new Error("That server isn't on Connections any more.");
  const r = await disconnectProf(customProf(c));
  const { error } = await db().from("mcp_custom_servers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return r;
}

// ---- The business's own Claude key (docs/tenancy.md, slice 8.1c). Not an MCP server: the key the
// runner calls the Claude API with. It lives in the vault like every other key, sealed with the
// org's data key, on a connection row of its own; only this file opens it.

export const CLAUDE_KEY_ID = "anthropic_key";
const looksLikeClaudeKey = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(k);

/** Keeps the business's Claude key in the vault, after Anthropic confirms it works. Never echoed back, logged or shown. */
export async function saveClaudeKey(pasted: string): Promise<void> {
  if (!keys().current) throw new Error(VAULT_MISSING);
  const key = pasted.trim();
  if (!looksLikeClaudeKey(key)) throw new Error("That doesn't look like a Claude API key (it starts with sk-ant-).");
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (e) { throw new Error(`Anthropic couldn't be reached to check the key: ${scrubSecrets(e instanceof Error ? e.message : String(e), [key]).slice(0, 120)}`); }
  if (res.status === 401 || res.status === 403) throw new Error("Anthropic didn't accept that key.");
  if (!res.ok) throw new Error(`Anthropic answered ${res.status} when checking the key. Try again in a minute.`);
  const now = new Date().toISOString();
  const { error } = await db().from("mcp_connections").upsert({ id: CLAUDE_KEY_ID, secret: await sealSecret({ key } satisfies KeySecret), connected_at: now, last_error: null, paused_at: null, updated_at: now }, { onConflict: "id" });
  if (error) throw new Error(missing(error.message) ? MCP_MISSING : error.message);
  await logEvent(CLAUDE_KEY_ID, "connected", "Claude API key", [key]);
}

/** Forgets the business's Claude key here. It keeps working at Anthropic until it is deleted there. */
export async function removeClaudeKey(): Promise<void> {
  const { error } = await db().from("mcp_connections").delete().eq("id", CLAUDE_KEY_ID);
  if (error) throw new Error(error.message);
  await logEvent(CLAUDE_KEY_ID, "disconnected");
}

/** The business's own Claude key, opened for one call; null when it has none or it is paused. Only integrations/anthropic.ts calls this. */
export async function claudeKey(): Promise<string | null> {
  const r = await row(CLAUDE_KEY_ID).catch(() => null);
  if (!r?.secret || r.paused_at) return null;
  const s = await readSecret<KeySecret>(CLAUDE_KEY_ID, r);
  return s?.key ?? null;
}

