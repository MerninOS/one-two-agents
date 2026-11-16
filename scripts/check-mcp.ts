// MCP connection rules (docs/company-mode.md, slice 6): `npm run check:mcp`. Pure: no network.
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CTX_META, callThrough, createHost, listThrough, served } from "../core/tools/mcp-host";
import type { ToolDef } from "../core/tools/types";
import { checkNotionArgs, looksLikeNotionKey, notionPageId } from "../core/notion-blocks";
import { SHOPIFY_DOCS, WHO, assertReadOnly, shopifyKeyKind, shopifyVariables, writeScopes } from "../core/shopify-queries";
import { checkGmailArgs, draftRaw, isPlainAddress, readMail } from "../core/gmail-rules";
import { cashOf, readAccounts, readCategories, readOneTxn, readOrgName, readTxnPage } from "../core/mercury-rules";
import { LEGACY_ID, keyIdOf, legacyKey, open, seal, vaultKey } from "../core/vault";
import {
  type McpServer, GOOGLE_AUTH, MCP_EVENTS, MCP_SERVERS, grantedScopes, isGoogle, scopeProblem, usesConnect, checkTools, listedTools, toolCheckNote, toolFingerprint, pickScopes, mayReport, isOauth, mayWrite, checkedTools, scrubSecrets, authorizeUrl, discoveryUrls, listSize, mayCall, namedRows, needsRefresh, nextCursor, parseRpc, readAuthServer, readTokens, reportRows, reportTotals, resourceOf, toolPayload,
} from "../core/mcp-rules";

// only named read tools, never a write; the server's own read-only switch is on
assert.ok(mayCall("klaviyo", "get_list"));
for (const t of ["create_campaign", "send_campaign", "update_profile", "delete_list", "subscribe_profile_to_marketing", "get_profiles"]) assert.ok(!mayCall("klaviyo", t), t);
assert.ok(!mayCall("shopify", "get_list"), "unknown server");
for (const t of MCP_SERVERS.klaviyo.readTools) assert.match(t, /^(get|query)_/, t);
assert.match(MCP_SERVERS.klaviyo.url, /read-only=true/);
assert.equal(resourceOf(MCP_SERVERS.klaviyo.url), "https://mcp.klaviyo.com/mcp");

// JSON-RPC replies: JSON or an event stream, matched by id
assert.deepEqual(parseRpc("application/json", JSON.stringify({ jsonrpc: "2.0", id: 2, result: { a: 1 } }), 2), { result: { a: 1 } });
assert.deepEqual(parseRpc("text/event-stream", `event: message\ndata: {"jsonrpc":"2.0","method":"note"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n`, 2), { result: { ok: true } });
assert.deepEqual(parseRpc("application/json", JSON.stringify({ jsonrpc: "2.0", id: 2, error: { message: "nope" } }), 2), { error: "nope" });
assert.ok("error" in parseRpc("application/json", "<html>", 2));
assert.ok("error" in parseRpc("application/json", JSON.stringify({ jsonrpc: "2.0", id: 9, result: {} }), 2), "wrong id");

// tool results: structured content, JSON text, the result wrapper, errors
assert.deepEqual(toolPayload({ structuredContent: { result: { data: [] } } }), { data: { data: [] } });
assert.deepEqual(toolPayload({ content: [{ type: "text", text: "{\"data\":[1]}" }] }), { data: { data: [1] } });
assert.deepEqual(toolPayload({ isError: true, content: [{ type: "text", text: "bad id" }] }), { error: "bad id" });

// Klaviyo replies, in the shapes its MCP server sends (checked against the live server, Nov 2026)
const lists = { data: [{ type: "list", id: "XZRviM", attributes: { name: "One Two Coffee Lab Email List" } }, { type: "list", id: "V8E3fQ", attributes: { name: "SMS List" } }], links: { next: "https://a.klaviyo.com/api/lists?page%5Bcursor%5D=abc123" } };
assert.deepEqual(namedRows(lists).map((r) => r.id), ["XZRviM", "V8E3fQ"]);
assert.equal(nextCursor(lists), "abc123");
assert.equal(nextCursor({ links: { next: null } }), null);
assert.deepEqual(listSize({ data: { type: "list", id: "XZRviM", attributes: { name: "Email", profile_count: 212 } } }), { id: "XZRviM", name: "Email", profiles: 212 });
assert.equal(listSize({ data: { id: "XZRviM", attributes: { name: "Email" } } }), null, "no count, no number");

const report = { data: { attributes: { results: [
  { groupings: { campaign_id: "c1", send_channel: "email" }, statistics: { recipients: 196, delivered: 186, opens_unique: 107, clicks_unique: 7, conversions: 0, conversion_value: 0, unsubscribes: 1 }, campaign_details: { attributes: { name: "Hidden Window", send_time: "November 15, 2025, 17:08" } } },
  { groupings: { campaign_id: "c2", send_channel: "email" }, statistics: { recipients: 182, delivered: 180, opens_unique: 83, clicks_unique: 7, conversions: 1, conversion_value: 51.96, unsubscribes: 0 }, campaign_details: { attributes: { name: "Cyber Monday Email" } } },
] } } };
const rows = reportRows(report, "campaign");
assert.equal(rows[0].name, "Hidden Window");
const t = reportTotals(rows);
assert.equal(t.delivered, 366);
assert.equal(t.opens, 190);
assert.equal(t.revenue_usd, 51.96);
assert.equal(t.open_rate_pct, 51.91);
assert.equal(reportTotals([]).open_rate_pct, 0, "no divide by zero");
const flow = reportRows({ data: { attributes: { results: [{ groupings: { flow_id: "f1", send_channel: "sms" }, statistics: { recipients: 3, delivered: 3 }, flow_details: { attributes: { name: "Exclusive Code" } } }] } } }, "flow");
assert.equal(flow[0].name, "Exclusive Code");
assert.equal(flow[0].orders, 0);

// signing in: discovery addresses, checked endpoints, PKCE authorize address, tokens
const d = discoveryUrls(MCP_SERVERS.klaviyo.url);
assert.deepEqual(d.resource, ["https://mcp.klaviyo.com/.well-known/oauth-protected-resource/mcp", "https://mcp.klaviyo.com/.well-known/oauth-protected-resource"]);
assert.deepEqual(d.authServer("https://auth.example.com"), ["https://auth.example.com/.well-known/oauth-authorization-server", "https://auth.example.com/.well-known/openid-configuration"]);
assert.equal(readAuthServer({ authorization_endpoint: "http://x.test/a", token_endpoint: "https://x.test/t" }), null, "https only");
const a = readAuthServer({ authorization_endpoint: "https://x.test/authorize", token_endpoint: "https://x.test/token", registration_endpoint: "https://x.test/register" })!;
const u = new URL(authorizeUrl(a, { clientId: "c", redirectUri: "https://room.test/connections/klaviyo/callback", challenge: "ch", state: "st", resource: "https://mcp.klaviyo.com/mcp" }));
assert.equal(u.searchParams.get("code_challenge_method"), "S256");
assert.equal(u.searchParams.get("resource"), "https://mcp.klaviyo.com/mcp");
assert.equal(u.searchParams.get("state"), "st");
const tok = readTokens({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000)!;
assert.equal(tok.expiresAt, 1000 + 3_600_000);
assert.equal(readTokens({ access_token: "b", expires_in: 60 }, 0, "keep")!.refreshToken, "keep", "a refresh that sends no new refresh token keeps the old one");
assert.equal(readTokens({ token_type: "bearer" }, 0), null);
assert.ok(needsRefresh(tok, 1000 + 3_600_000 - 30_000));
assert.ok(!needsRefresh(tok, 1000));

assert.equal(readTokens({ access_token: "c", refresh_token: "new", expires_in: 60 }, 0, "old")!.refreshToken, "new", "a rotated refresh token replaces the old one");

// ---- the token vault (slice 2)
const k1 = vaultKey("first-secret-that-is-long-enough-1234567890");
const k2 = vaultKey("second-secret-that-is-long-enough-0987654321");
assert.notEqual(k1.id, k2.id);
assert.equal(vaultKey("first-secret-that-is-long-enough-1234567890").id, k1.id, "same secret, same id");
const sealed = seal({ tokens: { accessToken: "tok-abc" } }, k1);
assert.equal(keyIdOf(sealed), k1.id);
assert.ok(!sealed.includes("tok-abc"), "nothing readable in a sealed value");
assert.deepEqual(open(sealed, [k1]), { tokens: { accessToken: "tok-abc" } });
assert.deepEqual(open(sealed, [k2, k1]), { tokens: { accessToken: "tok-abc" } }, "an old key still opens what it sealed");
assert.equal(open(sealed, [k2]), null, "the wrong key opens nothing");
const parts = sealed.split(".");
parts[4] = Buffer.from("tampered").toString("base64url");
assert.equal(open(parts.join("."), [k1]), null, "a changed value opens nothing");
assert.equal(keyIdOf("not sealed"), null);
assert.throws(() => seal({}, legacyKey("service-role")), /old key/);
// slice 6 rows (iv.tag.body under the service-role key) still open, so they can be moved
const lk = legacyKey("service-role-key");
assert.deepEqual(lk.key, createHash("sha256").update("mcp-connections:v1:service-role-key").digest());
const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", lk.key, iv);
const body = Buffer.concat([c.update(JSON.stringify({ a: 1 }), "utf8"), c.final()]);
const old = [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
assert.equal(keyIdOf(old), LEGACY_ID);
assert.deepEqual(open(old, [k1, lk]), { a: 1 });
assert.equal(open(old, [k1]), null, "without the old key it stays shut");

// scopes: only the profile's read scopes, never the server's whole list
for (const s of MCP_SERVERS.klaviyo.scopes) assert.match(s, /:read$/, s);
assert.equal(pickScopes(["lists:read", "flows:read"]).scope, "lists:read flows:read");
assert.deepEqual(pickScopes(["lists:read", "flows:read"], ["lists:read", "lists:write", "profiles:write"]), { scope: "lists:read", missing: ["flows:read"] });
assert.throws(() => pickScopes(["lists:read"], ["lists:write"]), /none of the scopes/);
assert.equal(readAuthServer({ authorization_endpoint: "https://x.test/a", token_endpoint: "https://x.test/t", revocation_endpoint: "https://x.test/revoke" })!.revocation_endpoint, "https://x.test/revoke");
assert.equal(readAuthServer({ authorization_endpoint: "https://x.test/a", token_endpoint: "https://x.test/t", revocation_endpoint: "http://x.test/revoke" })!.revocation_endpoint, undefined, "an http revoke address is ignored");

// scrubbing: secrets never reach a saved error
const leak = `401 {"error":"invalid","access_token":"eyJhbGciOi.abc","refresh_token":"rt_123456789"} Authorization: Bearer abcdefghijkl12 code=xyz789&state=s tok-plain-secret`;
const clean = scrubSecrets(leak, ["tok-plain-secret", null, "short"]);
for (const bad of ["eyJhbGciOi.abc", "rt_123456789", "abcdefghijkl12", "xyz789", "tok-plain-secret"]) assert.ok(!clean.includes(bad), bad);
assert.ok(clean.includes("state=s") && clean.includes("401"), "the rest stays readable");
assert.deepEqual([...MCP_EVENTS].sort(), ["connected", "disconnected", "refresh_failed", "refreshed", "refused", "resealed", "revoke_failed", "revoked", "tools_changed", "tools_checked"]);
// the log's database check lists the same events
const lastSql = readFileSync("supabase/migrations/20261127090000_mcp_tool_check.sql", "utf8");
for (const e of MCP_EVENTS) assert.ok(lastSql.includes(`'${e}'`), `migration allows ${e}`);

// ---- profiles and the tool check (slice 3)
for (const srv of Object.values(MCP_SERVERS) as McpServer[]) {
  const reads = new Set<string>(srv.readTools);
  for (const w of srv.writeTools) { assert.ok(!reads.has(w.tool), `${w.tool} is a write, not a read`); assert.ok(w.actionType, "every write names its gateway action type"); assert.ok(!mayCall(srv.id, w.tool), "code never calls a write tool"); }
  assert.ok(srv.scopes.length && srv.signInHint, srv.id);
}
const schema = { type: "object", properties: { id: { type: "string" }, fields: { type: "array" } } };
assert.equal(toolFingerprint({ name: "get_list", inputSchema: schema }), toolFingerprint({ name: "get_list", inputSchema: { properties: { fields: { type: "array" }, id: { type: "string" } }, type: "object" } }), "key order doesn't matter");
assert.notEqual(toolFingerprint({ name: "get_list", inputSchema: schema }), toolFingerprint({ name: "get_list", inputSchema: { ...schema, required: ["id"] } }));
const listed = listedTools({ tools: [{ name: "get_list", inputSchema: schema }, { name: "get_lists", inputSchema: {} }, { name: "create_campaign", inputSchema: {} }], nextCursor: "p2" });
assert.equal(listed.next, "p2");
const first = checkTools(["get_list", "get_lists"], listed.tools, null);
assert.deepEqual([first.missing, first.changed, Object.keys(first.seen)], [[], [], ["get_list", "get_lists"]], "signing in accepts what is there");
assert.equal(toolCheckNote(first), "");
const later = checkTools(["get_list", "get_lists", "get_metrics"], [{ name: "get_list", inputSchema: { ...schema, required: ["id"] } }, { name: "get_lists", inputSchema: {} }], first.seen);
assert.deepEqual([later.missing, later.changed], [["get_metrics"], ["get_list"]]);
assert.equal(toolCheckNote(later), "the server no longer offers get_metrics and changed the inputs of get_list");

// ---- Notion on our own server (slice 4)
assert.equal(MCP_SERVERS.notion.auth, "token");
assert.ok(isOauth("klaviyo") && !isOauth("notion"));
assert.deepEqual(MCP_SERVERS.klaviyo.reportTools, [], "a hosted server never gets report tools");
for (const t of MCP_SERVERS.notion.reportTools) { assert.ok(mayReport("notion", t), t); assert.ok(!mayCall("notion", t), `${t} is never a model's tool`); }
for (const t of MCP_SERVERS.notion.readTools) assert.ok(mayCall("notion", t) && !mayReport("notion", t), t);
assert.ok(!mayReport("klaviyo", "get_lists") && !mayReport("notion", "notion_search") && !mayCall("notion", "notion_delete_page"));
for (const t of [...MCP_SERVERS.notion.readTools, ...MCP_SERVERS.notion.reportTools]) assert.ok(!("problem" in checkNotionArgs(t, { pageId: "a".repeat(32), databaseId: "b".repeat(32), parentId: "c".repeat(32), title: "T", dateProp: "Date", date: "2026-11-16", properties: { Name: {} } })), `every profile tool has a check: ${t}`);
const dashed = "415de330-89c1-81fd-92e3-e770578cc707";
assert.deepEqual(checkNotionArgs("notion_page_text", { pageId: dashed }), { tool: "notion_page_text", pageId: "415de33089c181fd92e3e770578cc707", maxChars: 6000 });
for (const [tool, args, why] of [
  ["notion_page_text", { pageId: "../../users" }, /pageId/],
  ["notion_page_text", { pageId: "a".repeat(32), maxChars: 50000 }, /maxChars/],
  ["notion_row_on", { databaseId: "a".repeat(32), dateProp: "Date", date: "tomorrow" }, /YYYY-MM-DD/],
  ["notion_create_page", { parentId: "a".repeat(32), title: " " }, /title/],
  ["notion_create_page", { parentId: "a".repeat(32), title: "T", children: [{ no: "type" }] }, /type/],
  ["notion_create_row", { databaseId: "a".repeat(32), properties: {} }, /properties/],
  ["notion_search", {}, /isn't a Notion tool/],
] as const) { const r = checkNotionArgs(tool, args); assert.ok("problem" in r && why.test(r.problem), tool); }
const many = checkNotionArgs("notion_create_page", { parentId: "a".repeat(32), title: "T", children: Array.from({ length: 150 }, () => ({ type: "divider" })) });
assert.ok(!("problem" in many) && many.tool === "notion_create_page" && many.children.length === 100, "at most 100 blocks");
assert.ok(looksLikeNotionKey("ntn_" + "a1".repeat(20)) && looksLikeNotionKey("secret_" + "Z9".repeat(20)));
assert.ok(!looksLikeNotionKey("ntn_short") && !looksLikeNotionKey("Bearer ntn_" + "a".repeat(40)) && !looksLikeNotionKey("sk-" + "a".repeat(40)));
assert.equal(notionPageId("https://www.notion.so/Start-here-415de33089c181fd92e3e770578cc707?pvs=4"), "415de33089c181fd92e3e770578cc707");

// ---- Mercury over MCP (slice 5)
assert.deepEqual([...MCP_SERVERS.mercury.scopes], ["read", "offline_access"], "the agents' Mercury sign-in asks for read only");
assert.equal(MCP_SERVERS.mercury.auth, "oauth");
for (const t of MCP_SERVERS.mercury.readTools) assert.match(t, /^(get|list)[A-Z]/, t);
for (const bad of ["requestSendMoney", "requestTransferMoney", "approveReimbursement", "updateTransaction", "matchReceipt", "createCategory"]) assert.ok(!mayCall("mercury", bad), `never ${bad}`);
const accts = readAccounts({ accounts: [
  { id: "a1", availableBalance: 1000.105, status: "active", kind: "checking" },
  { id: "a2", availableBalance: "250.5", status: "active", kind: "savings" },
  { id: "c1", availableBalance: -300, status: "active", kind: "creditCard", isCredit: true },
  { id: "x1", availableBalance: 99, status: "archived" },
  { id: "bad", availableBalance: "n/a", status: "active" },
] });
assert.deepEqual(accts.map((a) => a.id), ["a1", "a2", "c1", "x1"], "a balance that isn't a number is dropped, not zero");
assert.equal(cashOf(accts, ["all"]), 1250.61);
assert.equal(cashOf(accts, ["a2"]), 250.5);
assert.throws(() => cashOf(accts, ["a1", "gone"]), /not found/);
const tid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pg = readTxnPage({ transactions: [{ id: tid(1), amount: -12.5, status: "sent", postedAt: "2026-11-02", categoryData: { id: "c", name: "Coffee" } }, { id: tid(2), amount: "oops", status: "sent" }, { amount: 5 }], page: { nextPage: tid(1) } });
assert.equal(pg.transactions.length, 1);
assert.deepEqual([pg.next, pg.truncatedAt, pg.datesDropped, pg.transactions[0].categoryData?.name], [tid(1), null, false, "Coffee"]);
assert.equal(readTxnPage({ transactions: [], truncatedAt: 120, totalFetched: 300 }).truncatedAt, 120, "a cut page says how many to ask for");
assert.equal(readTxnPage({ transactions: [], truncatedAt: 300, totalFetched: 300 }).truncatedAt, null);
assert.equal(readTxnPage({ transactions: [{ id: tid(3), amount: 1, status: "sent" }], _retryNote: "dates dropped" }).datesDropped, true, "rows outside the asked dates are noticed");
assert.equal(readTxnPage({ transactions: [], page: { nextPage: "not-a-cursor" } }).next, null);
assert.equal(readOneTxn({ transaction: { id: tid(4), amount: -3, status: "sent" } })?.id, tid(4));
assert.equal(readOneTxn({ id: tid(5), amount: -3, status: "sent" })?.id, tid(5));
assert.deepEqual(readCategories({ categories: [{ id: "k1", name: "Green coffee" }, { id: "k2" }] }).categories, [{ id: "k1", name: "Green coffee" }]);
assert.equal(readOrgName({ organization: { legalBusinessName: "One Two Coffee Lab LLC", ein: "12-3456789" } }), "One Two Coffee Lab LLC");

// ---- Mercury writes on the gateway's own sign-in (slice 5b)
assert.deepEqual([...MCP_SERVERS.mercury_write.scopes], ["transactions:update", "offline_access"], "the write sign-in asks for category and memo only");
assert.deepEqual(MCP_SERVERS.mercury_write.readTools, []);
assert.ok(mayWrite("mercury_write", "updateTransaction") && !mayCall("mercury_write", "updateTransaction"), "a write tool is never an agent's tool");
for (const bad of ["requestSendMoney", "requestTransferMoney", "approveReimbursement", "matchReceipt", "createReceiptUploadUrl", "createCategory"]) assert.ok(!mayWrite("mercury_write", bad) && !mayWrite("mercury", bad), `never ${bad}`);
assert.ok(!mayWrite("mercury", "updateTransaction"), "the agents' read sign-in has no write tools");
assert.deepEqual(checkedTools("mercury_write"), ["updateTransaction"], "the tool check watches the write tool too");
for (const srv of Object.values(MCP_SERVERS) as McpServer[]) for (const sc of srv.scopes) assert.ok(!/transfers|transactions:request|reimbursements|budgets|receipts/.test(sc), `${srv.id} never asks for ${sc}`);

// ---- Shopify on our own server (slice 7)
assert.equal(MCP_SERVERS.shopify.auth, "token");
assert.deepEqual([...MCP_SERVERS.shopify.readTools].sort(), Object.keys(SHOPIFY_DOCS).sort(), "every Shopify tool runs exactly one fixed query");
assert.deepEqual([MCP_SERVERS.shopify.writeTools, MCP_SERVERS.shopify.reportTools], [[], []], "Shopify is read-only here");
for (const [tool, doc] of Object.entries(SHOPIFY_DOCS)) { assert.doesNotThrow(() => assertReadOnly(doc), tool); assert.ok(!/\b(email|phone|address|firstName|lastName|displayName)\b/.test(doc), `${tool} reads no customer details`); }
assert.doesNotThrow(() => assertReadOnly(WHO));
for (const bad of ["mutation M { productDelete(input: {}) { deletedProductId } }", "query Q { shop { name } } mutation M { x }", "subscription S { x }", "{ shop { name } }"]) assert.throws(() => assertReadOnly(bad), bad);
assert.doesNotThrow(() => assertReadOnly('query Q { products(query: "mutation") { nodes { id } } }'), "a word inside a string is not an operation");
assert.deepEqual(writeScopes(["read_products", "read_orders", "unauthenticated_read_product_listings"]), []);
assert.deepEqual(writeScopes(["read_products", "write_products", "write_orders"]), ["write_products", "write_orders"], "a key with a write scope is refused");
assert.equal(shopifyKeyKind("shpat_" + "a1".repeat(16)), "token");
assert.equal(shopifyKeyKind("shpss_" + "b2".repeat(16)), "secret");
assert.equal(shopifyKeyKind("ntn_short"), null);
assert.equal(shopifyKeyKind("shpat_abc def"), null);
assert.deepEqual(shopifyVariables("shopify_green_lots", { query: "status:any" }, "our-coffees"), { tool: "shopify_green_lots", variables: { query: "tag:blended-green AND -status:archived" } }, "a caller never writes the search");
assert.deepEqual(shopifyVariables("shopify_stock_coffees", { handle: "secret-drops" }, "our-coffees"), { tool: "shopify_stock_coffees", variables: { handle: "our-coffees" } }, "the collection comes from settings");
assert.deepEqual(shopifyVariables("shopify_board_orders", { since: "2026-08-18" }, "x"), { tool: "shopify_board_orders", variables: { query: "tag:blended created_at:>=2026-08-18", after: null } });
const btw = shopifyVariables("shopify_orders_between", { start: "2026-11-15", end: "2026-11-16", after: "eyJsYXN0X2lkIjo1fQ==" }, "x");
assert.ok(!("problem" in btw) && /created_at:>='2026-11-15T00:00:00-06:00' created_at:<'2026-11-16T00:00:00-06:00'/.test(String(btw.variables.query)) && btw.variables.after === "eyJsYXN0X2lkIjo1fQ==");
for (const [tool, args, why] of [
  ["shopify_recent_orders", { since: "2026-11-01 OR tag:x" }, /since/],
  ["shopify_board_orders", { since: "2026-11-01", after: "x' OR '1" }, /after/],
  ["shopify_orders_between", { start: "2026-11-16", end: "2026-11-15" }, /end after start/],
  ["shopify_graphql", { query: "{ shop { name } }" }, /isn't a Shopify tool/],
] as const) { const r = shopifyVariables(tool, args, "our-coffees"); assert.ok("problem" in r && why.test(r.problem), tool); }

// ---- Gmail on our own server, signed in with Google (slice 6)
const RO = "https://www.googleapis.com/auth/gmail.readonly", COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
assert.ok(isGoogle("gmail_read") && isGoogle("gmail") && usesConnect("gmail") && !isOauth("gmail") && !usesConnect("notion"));
assert.deepEqual([...MCP_SERVERS.gmail_read.scopes], [RO], "the read sign-in is granted gmail.readonly alone");
assert.deepEqual([...MCP_SERVERS.gmail.scopes], [COMPOSE], "the drafts sign-in is granted gmail.compose alone");
assert.deepEqual(MCP_SERVERS.gmail_read.writeTools, [], "the read sign-in has no write tools");
assert.deepEqual(MCP_SERVERS.gmail.readTools, [], "the drafts sign-in reads nothing");
assert.deepEqual(checkedTools("gmail_read"), ["gmail_search", "gmail_message", "gmail_attachment"], "what our server serves to the read sign-in");
assert.deepEqual(checkedTools("gmail"), ["gmail_create_draft"], "what our server serves to the drafts sign-in");
assert.ok(mayWrite("gmail", "gmail_create_draft") && !mayCall("gmail", "gmail_create_draft") && !mayWrite("gmail_read", "gmail_create_draft"));
for (const srv of Object.values(MCP_SERVERS) as McpServer[]) for (const t of [...srv.readTools, ...srv.writeTools.map((w) => w.tool)]) assert.ok(!/send|trash|delete|modify|label|forward|reply/i.test(t), `no ${t}`);
for (const srv of Object.values(MCP_SERVERS) as McpServer[]) for (const sc of srv.scopes) assert.ok(!/mail\.google\.com|gmail\.send|gmail\.modify|gmail\.insert|gmail\.labels|gmail\.settings/.test(sc), `${srv.id} never asks for ${sc}`);
// Gmail's API: only our server calls it, and it has no send, trash, delete, modify or label call
const gapi = readFileSync("integrations/gmail-api.ts", "utf8");
assert.ok(!/\/send|\/trash|\/modify|\/labels|\/batchDelete|\/batchModify|"DELETE"|"PUT"|"PATCH"|\/import|\/insert/.test(gapi), "gmail-api.ts only searches, reads and drafts");
// Google sign-in: fixed addresses, our own client, no RFC 8707 resource, the scope granted is checked both ways
const gurl = new URL(authorizeUrl(GOOGLE_AUTH, { clientId: "cid", redirectUri: "https://x.example/connections/gmail/callback", challenge: "ch", state: "st", scope: COMPOSE, extra: { access_type: "offline", prompt: "consent" } }));
assert.equal(gurl.origin + gurl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
assert.deepEqual([gurl.searchParams.get("resource"), gurl.searchParams.get("scope"), gurl.searchParams.get("access_type"), gurl.searchParams.get("code_challenge_method")], [null, COMPOSE, "offline", "S256"]);
assert.deepEqual(grantedScopes({ scope: `${RO}  openid` }), [RO, "openid"]);
assert.equal(grantedScopes({}), null);
assert.equal(scopeProblem([RO], [RO]), null);
assert.match(scopeProblem([RO, COMPOSE], [RO]) ?? "", /more than it needs/, "an older grant riding along is refused");
assert.match(scopeProblem([], [RO]) ?? "", /wasn't granted/, "an unticked box is refused");
assert.match(scopeProblem(null, [RO]) ?? "", /didn't say/);
// every Gmail tool input is checked before it reaches a URL or a draft
assert.deepEqual(checkGmailArgs("gmail_search", { q: "$12.50 after:2026/11/01" }), { tool: "gmail_search", q: "$12.50 after:2026/11/01", max: 3 });
assert.deepEqual(checkGmailArgs("gmail_message", { id: "18c2a9f0e1b2c3d4" }), { tool: "gmail_message", id: "18c2a9f0e1b2c3d4", maxChars: 6000 });
for (const [tool, args, why] of [
  ["gmail_search", { q: "" }, /q must/],
  ["gmail_search", { q: "x", max: 500 }, /max/],
  ["gmail_message", { id: "../../drafts" }, /id must/],
  ["gmail_attachment", { messageId: "18c2a9f0e1b2", attachmentId: "a/b" }, /attachmentId/],
  ["gmail_create_draft", { to: "a@b.co, c@d.co", subject: "Hi", body: "x" }, /one plain/],
  ["gmail_create_draft", { to: "Zak <a@b.co>", subject: "Hi", body: "x" }, /one plain/],
  ["gmail_create_draft", { to: "a@b.co\r\nBcc: c@d.co", subject: "Hi", body: "x" }, /one plain/],
  ["gmail_create_draft", { to: "a@b.co", subject: " ", body: "x" }, /subject/],
  ["gmail_send", { to: "a@b.co" }, /isn't a Gmail tool/],
] as const) { const r = checkGmailArgs(tool, args); assert.ok("problem" in r && why.test(r.problem), `${tool} ${JSON.stringify(args)}`); }
const dr = checkGmailArgs("gmail_create_draft", { to: " lead@cafe.com ", subject: "Hello\r\nBcc: x@y.z", body: "Hi there" });
assert.ok(!("problem" in dr) && dr.tool === "gmail_create_draft" && dr.to === "lead@cafe.com" && !/[\r\n]/.test(dr.subject), "a subject can't add a header");
assert.ok(isPlainAddress("o'neil+wholesale@cafe.co.uk") && !isPlainAddress("a@b") && !isPlainAddress("a b@c.com"));
const mime = Buffer.from(draftRaw("lead@cafe.com", "Café ☕", "Hello"), "base64url").toString("utf8");
assert.match(mime, /^To: lead@cafe\.com\r\nSubject: =\?UTF-8\?B\?/);
assert.equal(mime.split("\r\n").filter((l) => /^(To|Cc|Bcc):/i.test(l)).length, 1, "one recipient header");
assert.throws(() => draftRaw("a@b.co, c@d.co", "x", "y"));
const b = (t: string) => Buffer.from(t).toString("base64url");
const mail = readMail({ id: "m1", payload: { headers: [{ name: "From", value: "Shop <r@shop.com>" }, { name: "Subject", value: "Your receipt" }], parts: [
  { mimeType: "text/html", body: { data: b("<p>Total &#36;12.50</p><script>x()</script>") } },
  { mimeType: "application/pdf", filename: "receipt.pdf", body: { attachmentId: "att123456", size: 2048 } },
] } }, 6000);
assert.deepEqual([mail.from, mail.subject, mail.text.trim(), mail.attachments], ["Shop <r@shop.com>", "Your receipt", "Total $12.50", [{ id: "att123456", filename: "receipt.pdf", mimeType: "application/pdf", size: 2048 }]]);

// ---- the in-app MCP server (slice 1): every read and calculate call goes through it
const hostChecks = (async () => {
  const seen: unknown[] = [];
  const tools: Record<string, ToolDef> = {
    lots: { id: "lots", label: "Lots", detail: "Green lots", kind: "read", group: "shopify", trusted: true, needs: [], costUsd: 0,
      params: [{ name: "days", type: "int", min: 1, max: 30, default: 7, description: "Days" }],
      run: async (input, ctx) => { seen.push({ input, agent: ctx.agentId, pages: ctx.notionPages.length }); return { data: { n: 2 }, numbers: { lots: 2, bad: NaN }, picks: { l1: { kind: "lot", id: "x", label: "X" } } }; } },
    math: { id: "math", label: "Math", detail: "Adds", kind: "calculate", group: "calculate", trusted: true, needs: [], costUsd: 0, params: [], run: async () => { throw new Error("no data for that period"); } },
    send: { id: "send", label: "Propose send", detail: "x", kind: "action", group: "gmail", trusted: true, needs: [], costUsd: 0, params: [], stage: () => ({ problem: "no" }) },
    brief: { id: "brief", label: "Brief", detail: "x", kind: "report", group: "email", trusted: true, needs: [], costUsd: 0, params: [], deliver: async () => "sent" },
    web: { id: "web", label: "Web", detail: "x", kind: "read", group: "web", trusted: false, needs: [], costUsd: 0, params: [], server: { type: "web_search_20260209", maxUses: 3 } },
  };
  const host = createHost(tools);
  const ctx = { agentId: "b_test", notionPages: [{ id: "p1", label: "Page" }], outputSources: [] };
  const out = await callThrough(host, "lots", { days: 3 }, ctx);
  assert.deepEqual(out, { data: { n: 2 }, numbers: { lots: 2 }, picks: { l1: { kind: "lot", id: "x", label: "X" } } }, "same result, NaN dropped");
  assert.deepEqual(seen.at(-1), { input: { days: 3 }, agent: "b_test", pages: 1 }, "the caller's context rides along");
  await assert.rejects(callThrough(host, "lots", { days: 99 }, ctx), /Input refused: days/, "the server checks input again");
  await assert.rejects(callThrough(host, "math", {}, ctx), /no data for that period/, "a tool's own error comes back as it was");
  for (const name of ["send", "brief", "web", "nope"]) await assert.rejects(callThrough(host, name, {}, ctx), /isn't a tool this server serves/, name);
  assert.ok(!served(tools.send) && !served(tools.brief) && !served(tools.web) && served(tools.lots) && served(tools.math));
  const list = await listThrough(host);
  assert.deepEqual(list.map((t) => t.name), ["lots", "math"], "only reads and calculations are listed");
  assert.equal(list[0].annotations.readOnlyHint, true);
  assert.deepEqual(await host({ jsonrpc: "2.0", id: 5, method: "resources/list" }), { jsonrpc: "2.0", id: 5, error: { code: -32601, message: "no method resources/list" } });
  assert.equal(CTX_META, "one-two/ctx");
})();

// only the in-app server runs a tool's code: nothing else calls `.run(` on a tool
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });
const direct = ["core", "agents", "dashboard", "app", "integrations"].flatMap(files).filter((f) => !f.endsWith("core/tools/mcp-host.ts") && /\bt\.run!?\(|\btool\.run!?\(|\.run!\(/.test(readFileSync(f, "utf8")));
assert.deepEqual(direct, [], "call tools through core/tools/call.ts");


// only the gateway calls a write tool
const writers = ["core", "agents", "dashboard", "app", "integrations", "scripts"].flatMap(files).filter((f) => !f.includes("core/gateway/") && !f.endsWith("integrations/mcp.ts") && !f.endsWith("scripts/check-mcp.ts") && /import[^;]*\bcallWriteTool\b[^;]*from/.test(readFileSync(f, "utf8")));
assert.deepEqual(writers, [], "callWriteTool is for core/gateway only");
// only our Gmail server imports Gmail's API, and only the MCP client imports our Gmail server
const importers = (mod: string) => ["core", "agents", "dashboard", "app", "integrations"].flatMap(files).filter((f) => new RegExp(`from "[^"]*/${mod}"`).test(readFileSync(f, "utf8")));
assert.deepEqual(importers("gmail-api"), ["integrations/gmail-server.ts"]);
assert.deepEqual(importers("gmail-server"), ["integrations/mcp.ts"]);
assert.deepEqual(importers("shopify-api"), ["integrations/shopify-server.ts"]);
assert.deepEqual(importers("shopify-server"), ["integrations/mcp.ts"]);
// no direct GraphQL path from agents: only our Shopify server posts to Shopify's API
const gqlPosters = ["core", "agents", "dashboard", "app", "integrations"].flatMap(files).filter((f) => /graphql\.json|admin\/oauth\/access_token/.test(readFileSync(f, "utf8")));
assert.deepEqual(gqlPosters, ["integrations/shopify-api.ts"]);

hostChecks.then(() => console.log("mcp: ok"), (e) => { console.error(e); process.exit(1); });
