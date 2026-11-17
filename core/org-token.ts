// Org tokens (docs/tenancy.md, slice 2b): a short-lived token that the database holds to one org.
// db() reads and writes with it, and a policy on every table (20261204090000_org_policies.sql)
// lets it reach only rows of that org. Signed with our own ES256 key, imported into Supabase as
// its signing key. Pure apart from node:crypto: no env, no network (`npm run check:tenancy`).
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export interface SigningKey { kid: string; key: KeyObject }

/** How long a token lives; db() makes a new one when less than REFRESH_MS is left. */
export const TOKEN_MS = 60 * 60 * 1000;
export const REFRESH_MS = 5 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const b64 = (x: string | Buffer) => Buffer.from(x).toString("base64url");

/** The private key, as the JWK `supabase gen signing-key --algorithm ES256` prints. Anything else is refused. */
export function parseSigningKey(raw: string): SigningKey {
  let jwk: Record<string, unknown>;
  try { jwk = JSON.parse(raw); } catch { throw new Error("SUPABASE_SIGNING_KEY isn’t JSON: paste the whole key the CLI printed."); }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") throw new Error("SUPABASE_SIGNING_KEY must be an ES256 private key (kty EC, crv P-256, with d).");
  if (typeof jwk.kid !== "string" || !jwk.kid) throw new Error("SUPABASE_SIGNING_KEY needs its kid, the same one imported into Supabase.");
  return { kid: jwk.kid, key: createPrivateKey({ key: jwk as never, format: "jwk" }) };
}

/** A token for one org: role authenticated, org_id and sub set to the org, expiring in TOKEN_MS. */
export function orgToken(k: SigningKey, orgId: string, now = Date.now()): { token: string; exp: number } {
  if (!UUID.test(orgId)) throw new Error("An org token needs an org id (a uuid).");
  const iat = Math.floor(now / 1000), exp = iat + TOKEN_MS / 1000;
  const head = b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid: k.kid }));
  const body = b64(JSON.stringify({ role: "authenticated", aud: "authenticated", sub: orgId, org_id: orgId, iat, exp }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: k.key, dsaEncoding: "ieee-p1363" });
  return { token: `${head}.${body}.${b64(sig)}`, exp: exp * 1000 };
}
