import "server-only";
// Shopify Admin GraphQL client for the read-only app "One Two Agents (read)".
// Read-only by construction: scripts/validate-graphql.mjs fails the build if any
// document in this repo is a mutation, and the app's scopes are read_* only.
import { env } from "@/core/env";

/** Identity tag so scripts/validate-graphql.mjs can find and check every document. */
export const gql = String.raw;

export class ShopifyError extends Error {
  constructor(message: string, public details?: unknown, public status?: number) { super(message); }
}

// Either a static token, or Dev Dashboard app credentials exchanged with the
// client-credentials grant (tokens are short lived, cached here per instance).
let cached: { token: string; exp: number } | null = null;
async function exchangeToken(): Promise<{ token: string; exp: number }> {
  if (!env.shopifyDomain || !env.shopifyClientId || !env.shopifyClientSecret) {
    throw new ShopifyError("Shopify not configured: set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET");
  }
  const res = await fetch(`https://${env.shopifyDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.shopifyClientId, client_secret: env.shopifyClientSecret }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const reason = body.match(/Oauth error ([a-z_]+)/i)?.[1] ?? body.match(/"error"\s*:\s*"([^"]+)"/)?.[1];
    throw new ShopifyError(`Admin token exchange failed (${res.status}${reason ? `: ${reason}` : ""})`, body);
  }
  const j = await res.json() as { access_token: string; expires_in?: number };
  return { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}
async function adminToken(fresh = false): Promise<string> {
  if (env.shopifyAdminToken) return env.shopifyAdminToken;
  if (!fresh && cached && cached.exp > Date.now() + 60_000) return cached.token;
  cached = await exchangeToken();
  return cached.token;
}

async function post<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.shopifyDomain) throw new ShopifyError("SHOPIFY_STORE_DOMAIN is not set");
  const res = await fetch(`https://${env.shopifyDomain}/admin/api/${env.shopifyApiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new ShopifyError(`Shopify ${res.status} ${res.statusText}`, await res.text().catch(() => null), res.status);
  const json = await res.json() as { data?: T; errors?: unknown };
  if (json.errors) {
    const msg = Array.isArray(json.errors) ? json.errors.map((e: { message?: string }) => e.message).filter(Boolean).join("; ") : "";
    throw new ShopifyError(`Shopify GraphQL error${msg ? `: ${msg}` : ""}`, json.errors);
  }
  return json.data as T;
}

/** Run an Admin API query. */
export async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  try {
    return await post<T>(await adminToken(), query, variables);
  } catch (e) {
    // A cached token keeps the scopes it was issued with and dies if the app is
    // reinstalled; on either, get a fresh one and try once more.
    const stale = e instanceof ShopifyError && (e.status === 401 || /access denied/i.test(e.message));
    if (env.shopifyAdminToken || !stale) throw e;
    return post<T>(await adminToken(true), query, variables);
  }
}
