// MCP connection rules (docs/company-mode.md, slice 6): `npm run check:mcp`. Pure: no network.
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { LEGACY_ID, keyIdOf, legacyKey, open, seal, vaultKey } from "../core/vault";
import {
  MCP_EVENTS, MCP_SERVERS, pickScopes, scrubSecrets, authorizeUrl, discoveryUrls, listSize, mayCall, namedRows, needsRefresh, nextCursor, parseRpc, readAuthServer, readTokens, reportRows, reportTotals, resourceOf, toolPayload,
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
assert.deepEqual([...MCP_EVENTS].sort(), ["connected", "disconnected", "refresh_failed", "refreshed", "refused", "resealed", "revoke_failed", "revoked"]);

console.log("mcp: ok");
