// The token vault (docs/mcp-everywhere.md, slice 2). Pure: keys come in as arguments, no
// database, no env, so `npm run check:mcp` can test it.
//
// Sign-ins are sealed with AES-256-GCM under a key of their own (MCP_SECRET_KEY), never one made
// from another secret. Each sealed value names the key it was sealed with (a short id made from the
// key, which says nothing about it), so a new key can be put in while the old one still opens
// what it sealed, and rows are moved onto the new key as they are read or by "Re-lock now".
//
// Per org (docs/tenancy.md, slice 4): each org has its own data key, made at random. A sign-in is
// sealed with its org's data key and bound to the org (v3: the org id is checked by GCM, so a row
// copied to another org opens for nobody). The data key is kept wrapped by a wrapping key: an env
// key made from MCP_SECRET_KEY here, a cloud KMS key later (KeyWrapper). Destroying an org's
// wrapped key makes every sign-in of that org unreadable.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface VaultKey { id: string; key: Buffer }

/** The shortest MCP_SECRET_KEY accepted: `openssl rand -base64 32` gives 44 characters. */
export const MIN_SECRET_CHARS = 32;

/** A vault key from a secret. `label` keeps keys for different uses apart. */
export function vaultKey(secret: string, label = "mcp-connections:v2"): VaultKey {
  const key = createHash("sha256").update(`${label}:${secret}`).digest();
  return { id: createHash("sha256").update(key).digest("base64url").slice(0, 8), key };
}

/** `v2.<key id>.<iv>.<tag>.<body>`, or with `bind` (an org id) `v3.…`, opened only for that org. All base64url. */
export function seal(value: unknown, k: VaultKey, bind?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.key, iv);
  if (bind) c.setAAD(Buffer.from(bind, "utf8"));
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [bind ? "v3" : "v2", k.id, ...[iv, c.getAuthTag(), body].map((b) => b.toString("base64url"))].join(".");
}

/** Which key sealed it: a key id, or null when it isn't sealed this way. */
export function keyIdOf(sealed: string): string | null {
  const p = sealed.split(".");
  if (p.length === 5 && (p[0] === "v2" || p[0] === "v3") && p[1]) return p[1];
  return null;
}

/** Whether it is bound to an org (v3). */
export const isBound = (sealed: string) => sealed.startsWith("v3.");

/**
 * Opens a sealed value with whichever of `keys` sealed it. A v3 value opens only with the `bind`
 * it was sealed with; a v2 value has none. Null when no key did, the bind differs, or it was changed.
 */
export function open<T>(sealed: string, keys: readonly VaultKey[], bind?: string): T | null {
  const id = keyIdOf(sealed);
  const k = keys.find((x) => x.id === id);
  if (!id || !k) return null;
  const bound = isBound(sealed);
  if (bound !== !!bind) return null;
  const p = sealed.split(".");
  const [iv, tag, body] = p.slice(2).map((s) => Buffer.from(s, "base64url"));
  try {
    const d = createDecipheriv("aes-256-gcm", k.key, iv);
    if (bound) d.setAAD(Buffer.from(bind!, "utf8"));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}

// ---- Per-org data keys (slice 4)

const idOf = (key: Buffer) => createHash("sha256").update(key).digest("base64url").slice(0, 8);

/** A new data key for an org: 32 random bytes, never made from another secret. */
export function newDataKey(): VaultKey {
  const key = randomBytes(32);
  return { id: idOf(key), key };
}

const wrapBind = (orgId: string) => `org-key:${orgId}`;

/**
 * What wraps an org's data key. Async, so a cloud KMS can stand in for the env key (ee). `id` names
 * the wrapping key, kept beside each wrapped key so a new wrapping key can be put in.
 */
export interface KeyWrapper {
  id: string;
  wrap(dataKey: VaultKey, orgId: string): Promise<string>;
  /** The data key, or null when this wrapper didn't wrap it or it is for another org. */
  unwrap(wrapped: string, orgId: string): Promise<VaultKey | null>;
}

/** The env wrapper: a vault key made from MCP_SECRET_KEY under its own label, so it is never the key a sign-in is sealed with. */
export function envWrapper(secret: string): KeyWrapper {
  const w = vaultKey(secret, "org-keys:v1");
  return {
    id: `env:${w.id}`,
    wrap: async (dk, orgId) => seal(dk.key.toString("base64url"), w, wrapBind(orgId)),
    unwrap: async (wrapped, orgId) => {
      const raw = open<string>(wrapped, [w], wrapBind(orgId));
      if (typeof raw !== "string") return null;
      const key = Buffer.from(raw, "base64url");
      return key.length === 32 ? { id: idOf(key), key } : null;
    },
  };
}
