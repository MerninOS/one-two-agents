// MCP connections (docs/company-mode.md, slice 6). Pure: no database, no network, so
// `npm run check:mcp` can test it.
//
// Our runner calls an MCP server itself (never the model provider's server-side connector), so
// every call passes our gate: the agent's saved tools, the run log, the budget, untrusted labels.
// What we may call on each server is written here, tool by tool: read tools only. A tool the
// server adds later does nothing until it is named here in a pull request. A server's write tools
// are never called; a write would become a gateway action type that starts at Draft.

import { createHash } from "node:crypto";

/**
 * A server's profile (docs/mcp-everywhere.md, slice 3). It ships with the app and only a pull
 * request changes it: a business connects its own account, never edits what may be called.
 */
export interface McpServer {
  id: string;
  name: string;
  /**
   * How it is signed in. "oauth": the server's own sign-in page (Connect). "token": a key pasted
   * once on Connections, for a server we run ourselves in the app (integrations/mcp.ts LOCAL), used
   * where the service's hosted server would reach more than the profile needs.
   */
  auth: "oauth" | "token";
  /** The server's address (for a token server, the API our own server calls), with read-only switches on where it has them. */
  url: string;
  /** The only tools code may call on it, by the server's own names. Read tools only. */
  readTools: readonly string[];
  /**
   * Report tools: writes into One Two's own workspace (a page or row Zak reads), made by code after a
   * run, like an email to Zak. A model never calls one. Only a server we run ourselves has them.
   */
  reportTools: readonly string[];
  /** The sign-in scopes asked for: only what the read tools need, never the server's whole list. For a token server, what the key reaches, in words. */
  scopes: readonly string[];
  /**
   * Write tools, each with the gateway action type it becomes (starting at Draft). Code never calls
   * one directly: only core/gateway may, after Zak approves. Empty until a slice builds one.
   */
  writeTools: readonly { tool: string; actionType: string }[];
  /** Who should sign in, shown next to Connect. */
  signInHint: string;
}

export const MCP_SERVERS = {
  klaviyo: {
    id: "klaviyo",
    name: "Klaviyo",
    auth: "oauth",
    // read-only=true turns off every tool that can change the account; no profile reviews or other
    // user-written content (Klaviyo's MCP docs, 2026).
    url: "https://mcp.klaviyo.com/mcp?read-only=true&disable-tools-with-user-generated-content=true",
    readTools: ["get_lists", "get_list", "get_metrics", "get_campaign_report", "get_flow_report"],
    // Klaviyo's read scopes for those tools (lists, metrics, campaign and flow reports).
    scopes: ["accounts:read", "lists:read", "metrics:read", "campaigns:read", "flows:read"],
    reportTools: [],
    writeTools: [],
    signInHint: "Sign in as an Owner, Admin or Manager.",
  },
  mercury: {
    id: "mercury",
    name: "Mercury",
    // Mercury's hosted server (OAuth, dynamic client registration). Each write tool needs its own
    // scope, so this sign-in asks for `read` only: its token can't use a write tool even if code tried
    // (Mercury's MCP docs, 2026). Writes get a second, gateway-only sign-in in slice 5b.
    auth: "oauth",
    url: "https://mcp.mercury.com/mcp",
    readTools: ["getAccounts", "listTransactions", "listCategories", "getTransactionById", "getOrganization"],
    reportTools: [],
    scopes: ["read", "offline_access"],
    writeTools: [],
    signInHint: "Sign in as an admin of One Two’s business org, and pick One Two (not the household account) on Mercury’s page.",
  },
  mercury_write: {
    id: "mercury_write",
    name: "Mercury writes",
    // A second sign-in to the same server, held only by the gateway (slice 5b). It asks for
    // transactions:update alone: a charge's category and memo, after Zak approves. No payment,
    // transfer, receipt, budget or reimbursement scope, so its token can't use those tools.
    // Receipt files stay on MERCURY_WRITE_TOKEN: Mercury's MCP can't attach a file to a chosen charge.
    auth: "oauth",
    url: "https://mcp.mercury.com/mcp",
    readTools: [],
    reportTools: [],
    scopes: ["transactions:update", "offline_access"],
    writeTools: [{ tool: "updateTransaction", actionType: "mercury_annotate" }],
    signInHint: "Sign in to One Two’s business org again. This sign-in asks only to change a charge’s category and memo, and only the gateway uses it, after you approve.",
  },
  notion: {
    id: "notion",
    name: "Notion",
    // Our own server over Notion's REST API with the agents' internal integration key. Notion's hosted
    // MCP server signs in as a person and reaches their whole workspace with write tools on; this
    // key reaches only the pages shared with the integration (slice 4, Zak's choice 2026-11-16).
    auth: "token",
    url: "https://api.notion.com/v1",
    readTools: ["notion_page_text", "notion_row_on"],
    reportTools: ["notion_create_page", "notion_create_row", "notion_update_row", "notion_archive_row"],
    scopes: ["only the pages and databases shared with the integration"],
    writeTools: [],
    signInHint: "Paste the Internal Integration Secret of the agents’ Notion integration.",
  },
} as const satisfies Record<string, McpServer>;
export type McpId = keyof typeof MCP_SERVERS;
export const MCP_IDS = Object.keys(MCP_SERVERS) as McpId[];
export const isMcpId = (s: string): s is McpId => s in MCP_SERVERS;

/** Code calls only the tools named for that server. */
export function mayCall(id: string, tool: string): boolean {
  return isMcpId(id) && (MCP_SERVERS[id].readTools as readonly string[]).includes(tool);
}

/** A server's write tools: only core/gateway calls one, after Zak approves (integrations/mcp.ts callWriteTool). */
export function mayWrite(id: string, tool: string): boolean {
  return isMcpId(id) && (MCP_SERVERS[id].writeTools as readonly { tool: string }[]).some((w) => w.tool === tool);
}

/** Every tool the tool check watches on a server: its read tools and its write tools. */
export const checkedTools = (id: McpId): string[] => [...MCP_SERVERS[id].readTools, ...(MCP_SERVERS[id].writeTools as readonly { tool: string }[]).map((w) => w.tool)];

/** Report tools: code-delivered writes into One Two's own workspace, only on a server we run. */
export function mayReport(id: string, tool: string): boolean {
  return isMcpId(id) && MCP_SERVERS[id].auth === "token" && (MCP_SERVERS[id].reportTools as readonly string[]).includes(tool);
}

/** Servers signed in on their own page (Connect), and servers we run ourselves with a pasted key. */
export const isOauth = (id: McpId) => MCP_SERVERS[id].auth === "oauth";

export const MCP_PROTOCOL = "2025-06-18";

// ---- JSON-RPC over Streamable HTTP: a reply is plain JSON or a short event stream.

export type RpcReply = { result: unknown } | { error: string };

/** The reply to request `id`, from a JSON body or an event stream's data lines. */
export function parseRpc(contentType: string | null, body: string, id: number): RpcReply {
  const msgs: unknown[] = [];
  if ((contentType ?? "").includes("text/event-stream")) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { msgs.push(JSON.parse(data)); } catch { /* not JSON: skip */ }
    }
  } else {
    try { const j = JSON.parse(body); msgs.push(...(Array.isArray(j) ? j : [j])); } catch { return { error: `the server sent something that isn't JSON: ${body.slice(0, 120)}` }; }
  }
  const m = msgs.find((x) => !!x && typeof x === "object" && (x as { id?: unknown }).id === id) as { result?: unknown; error?: { message?: string } } | undefined;
  if (!m) return { error: "the server didn't answer the request" };
  if (m.error) return { error: String(m.error.message ?? "error").slice(0, 300) };
  return { result: m.result };
}

/**
 * What a tools/call gave back, as data: structuredContent when the server sends it, else the JSON
 * in its first text block, else the text. A single `result` wrapper is taken off.
 */
export function toolPayload(result: unknown): { data: unknown } | { error: string } {
  const r = (result ?? {}) as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text!).join("\n");
  if (r.isError) return { error: text.slice(0, 300) || "the tool failed" };
  let data: unknown = r.structuredContent;
  if (data === undefined) { try { data = JSON.parse(text); } catch { data = text; } }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1 && keys[0] === "result") data = (data as { result: unknown }).result;
  }
  return { data };
}

// ---- Reading Klaviyo's replies. Every number is taken from the raw reply and added up here.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown, max = 160): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Rows of a JSON:API list reply (lists, metrics): id and name. */
export function namedRows(payload: unknown): { id: string; name: string }[] {
  return arr(obj(payload).data).map((d) => ({ id: str(obj(d).id, 40), name: str(obj(obj(d).attributes).name) })).filter((r) => r.id);
}

/** The cursor for the next page, from links.next (`page[cursor]=…`), or null. */
export function nextCursor(payload: unknown): string | null {
  const next = obj(obj(payload).links).next;
  if (typeof next !== "string" || !next) return null;
  try { return new URL(next).searchParams.get("page[cursor]"); } catch { return null; }
}

/** A list's name and profile count from get_list with profile_count. */
export function listSize(payload: unknown): { id: string; name: string; profiles: number } | null {
  const d = obj(obj(payload).data);
  const a = obj(d.attributes);
  if (!str(d.id) || typeof a.profile_count !== "number" || !Number.isFinite(a.profile_count)) return null;
  return { id: str(d.id, 40), name: str(a.name), profiles: a.profile_count };
}

export const REPORT_PERIODS = ["last_7_days", "last_30_days", "last_90_days", "last_365_days"] as const;
export const REPORT_STATS = ["recipients", "delivered", "opens_unique", "clicks_unique", "conversions", "unsubscribes"] as const;
export interface ReportRow { name: string; channel: string; sent: string; recipients: number; delivered: number; opens: number; clicks: number; orders: number; revenue: number; unsubscribes: number }

/** One row per campaign or flow message, with the counts it reported. Names are One Two's own words, still shown as data. */
export function reportRows(payload: unknown, kind: "campaign" | "flow"): ReportRow[] {
  return arr(obj(obj(obj(payload).data).attributes).results).map((x) => {
    const r = obj(x), s = obj(r.statistics), g = obj(r.groupings);
    const det = obj(obj(kind === "campaign" ? r.campaign_details : r.flow_details).attributes);
    return {
      name: str(det.name) || str(g.flow_name) || str(g.campaign_message_name) || str(g[`${kind}_id`], 40),
      channel: str(g.send_channel, 30),
      sent: str(det.send_time, 40),
      recipients: num(s.recipients), delivered: num(s.delivered), opens: num(s.opens_unique), clicks: num(s.clicks_unique),
      orders: num(s.conversions), revenue: num(s.conversion_value), unsubscribes: num(s.unsubscribes),
    };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rate = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : 0);

/** Totals and rates over the rows, worked out here (rates in percent of delivered). */
export function reportTotals(rows: readonly ReportRow[]): Record<string, number> {
  const sum = (k: keyof ReportRow) => rows.reduce((t, r) => t + (r[k] as number), 0);
  const delivered = sum("delivered");
  return {
    messages: rows.length, recipients: sum("recipients"), delivered,
    opens: sum("opens"), clicks: sum("clicks"), orders: sum("orders"), revenue_usd: r2(sum("revenue")), unsubscribes: sum("unsubscribes"),
    open_rate_pct: rate(sum("opens"), delivered), click_rate_pct: rate(sum("clicks"), delivered), unsubscribe_rate_pct: rate(sum("unsubscribes"), delivered),
  };
}

// ---- Signing in (OAuth 2.1 with PKCE and dynamic client registration, as MCP's auth spec says).

/** Where to look for the server's sign-in details: the protected-resource document first, then the server's own origin. */
export function discoveryUrls(serverUrl: string): { resource: string[]; authServer: (issuer: string) => string[] } {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/+$/, "");
  return {
    resource: [`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`],
    authServer: (issuer: string) => {
      const i = new URL(issuer);
      const p = i.pathname.replace(/\/+$/, "");
      return p
        ? [`${i.origin}/.well-known/oauth-authorization-server${p}`, `${i.origin}/.well-known/openid-configuration${p}`, `${i.origin}${p}/.well-known/openid-configuration`]
        : [`${i.origin}/.well-known/oauth-authorization-server`, `${i.origin}/.well-known/openid-configuration`];
    },
  };
}

/** The server address without its query (what a token is for, RFC 8707). */
export const resourceOf = (serverUrl: string) => { const u = new URL(serverUrl); return `${u.origin}${u.pathname}`; };

export interface AuthServer { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; revocation_endpoint?: string; scopes_supported?: string[] }

/** The sign-in details, checked: every endpoint https. */
export function readAuthServer(j: unknown): AuthServer | null {
  const o = obj(j);
  const https = (x: unknown) => typeof x === "string" && /^https:\/\//.test(x);
  if (!https(o.authorization_endpoint) || !https(o.token_endpoint)) return null;
  if (o.registration_endpoint !== undefined && !https(o.registration_endpoint)) return null;
  return {
    authorization_endpoint: o.authorization_endpoint as string, token_endpoint: o.token_endpoint as string,
    registration_endpoint: o.registration_endpoint as string | undefined,
    // a revoke address that isn't https is ignored, not trusted
    revocation_endpoint: https(o.revocation_endpoint) ? (o.revocation_endpoint as string) : undefined,
    scopes_supported: Array.isArray(o.scopes_supported) ? (o.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string") : undefined,
  };
}

/** The address Zak's browser goes to, to say yes on the server's own sign-in page. */
export function authorizeUrl(a: AuthServer, o: { clientId: string; redirectUri: string; challenge: string; state: string; resource: string; scope?: string }): string {
  const u = new URL(a.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("code_challenge", o.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", o.state);
  u.searchParams.set("resource", o.resource);
  if (o.scope) u.searchParams.set("scope", o.scope);
  return u.toString();
}

export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: number | null }

/** A token reply, checked. `now` in ms. */
export function readTokens(j: unknown, now: number, keepRefresh: string | null = null): Tokens | null {
  const o = obj(j);
  if (typeof o.access_token !== "string" || !o.access_token) return null;
  const exp = typeof o.expires_in === "number" && o.expires_in > 0 ? now + o.expires_in * 1000 : null;
  return { accessToken: o.access_token, refreshToken: typeof o.refresh_token === "string" && o.refresh_token ? o.refresh_token : keepRefresh, expiresAt: exp };
}

/** Refresh a minute early. */
export const needsRefresh = (t: Tokens, now: number) => t.expiresAt != null && t.expiresAt - now < 60_000;

// ---- The tool check (slice 3): a server's tools must still be the ones code was written against.

/** A tool as the server lists it: its name and what inputs it takes. */
export interface ListedTool { name: string; inputSchema: unknown }

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;

/** A short fingerprint of a tool's inputs (key order doesn't matter; descriptions do, kept simple on purpose). */
export function toolFingerprint(t: ListedTool): string {
  return createHash("sha256").update(JSON.stringify(canon(t.inputSchema ?? null))).digest("base64url").slice(0, 16);
}

/** The tools in one tools/list reply, and the cursor for the next page. */
export function listedTools(result: unknown): { tools: ListedTool[]; next: string | null } {
  const r = obj(result);
  const tools = arr(r.tools).map((t) => ({ name: str(obj(t).name, 120), inputSchema: obj(t).inputSchema })).filter((t) => t.name);
  return { tools, next: typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : null };
}

export interface ToolCheck { missing: string[]; changed: string[]; seen: Record<string, string> }

/**
 * Compares the profile's read tools with what the server lists now. `missing`: gone from the
 * server. `changed`: inputs differ from the last accepted fingerprint. `seen`: the fingerprints now,
 * saved when the check passes or Zak signs in again.
 */
export function checkTools(readTools: readonly string[], listed: readonly ListedTool[], accepted: Record<string, string> | null): ToolCheck {
  const by = new Map(listed.map((t) => [t.name, t]));
  const seen: Record<string, string> = {};
  const missing: string[] = [], changed: string[] = [];
  for (const name of readTools) {
    const t = by.get(name);
    if (!t) { missing.push(name); continue; }
    seen[name] = toolFingerprint(t);
    if (accepted && accepted[name] && accepted[name] !== seen[name]) changed.push(name);
  }
  return { missing, changed, seen };
}

/** In words, for the paused note and the log. Empty when the check passed. */
export function toolCheckNote(c: ToolCheck): string {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`no longer offers ${c.missing.join(", ")}`);
  if (c.changed.length) parts.push(`changed the inputs of ${c.changed.join(", ")}`);
  return parts.length ? `the server ${parts.join(" and ")}` : "";
}

/** How long a passed check holds before the next call checks again. */
export const TOOL_CHECK_HOURS = 6;

// ---- Keeping sign-ins safe (docs/mcp-everywhere.md, slice 2).

/**
 * The scopes to ask for: the profile's own list, cut to what the server says it supports. When the
 * server supports none of them the sign-in is not started, rather than asking for everything.
 */
export function pickScopes(wanted: readonly string[], supported?: readonly string[]): { scope: string; missing: string[] } {
  if (!supported?.length) return { scope: wanted.join(" "), missing: [] };
  const ok = wanted.filter((s) => supported.includes(s));
  if (!ok.length) throw new Error(`the server offers none of the scopes code asks for (${wanted.join(", ")}); it offers: ${supported.slice(0, 20).join(", ")}`);
  return { scope: ok.join(" "), missing: wanted.filter((s) => !supported.includes(s)) };
}

const HIDDEN = "[hidden]";

/**
 * Takes sign-in values out of text before it is saved or shown: the given secrets wherever they
 * appear, bearer tokens, and token fields in JSON or form bodies a server may echo back.
 */
export function scrubSecrets(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join(HIDDEN);
  return out
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${HIDDEN}`)
    .replace(/("(?:access_token|refresh_token|id_token|client_secret|code|code_verifier|token)"\s*:\s*")[^"]*(")/gi, `$1${HIDDEN}$2`)
    .replace(/(\b(?:access_token|refresh_token|id_token|client_secret|code|code_verifier|token)=)[^&\s"]+/gi, `$1${HIDDEN}`);
}

/** What the sign-in log records. Never a token value. */
export const MCP_EVENTS = ["connected", "refreshed", "refresh_failed", "refused", "revoked", "revoke_failed", "disconnected", "resealed", "tools_changed", "tools_checked"] as const;
export type McpEvent = (typeof MCP_EVENTS)[number];
