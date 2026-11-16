// The token vault (docs/mcp-everywhere.md, slice 2). Pure: keys come in as arguments, no
// database, no env, so `npm run check:mcp` can test it.
//
// Sign-ins are sealed with AES-256-GCM under a key of their own (MCP_SECRET_KEY), never one made
// from another secret. Each sealed value names the key it was sealed with (a short id made from the
// key, which says nothing about it), so a new key can be put in while the old one still opens
// what it sealed, and rows are moved onto the new key as they are read or by "Re-lock now".
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface VaultKey { id: string; key: Buffer }

/** The shortest MCP_SECRET_KEY accepted: `openssl rand -base64 32` gives 44 characters. */
export const MIN_SECRET_CHARS = 32;

/** A vault key from a secret. `label` keeps keys for different uses apart. */
export function vaultKey(secret: string, label = "mcp-connections:v2"): VaultKey {
  const key = createHash("sha256").update(`${label}:${secret}`).digest();
  return { id: createHash("sha256").update(key).digest("base64url").slice(0, 8), key };
}

/** `v2.<key id>.<iv>.<tag>.<body>`, all base64url. */
export function seal(value: unknown, k: VaultKey): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v2", k.id, ...[iv, c.getAuthTag(), body].map((b) => b.toString("base64url"))].join(".");
}

/** Which key sealed it: a key id, or null when it isn't sealed this way. */
export function keyIdOf(sealed: string): string | null {
  const p = sealed.split(".");
  if (p.length === 5 && p[0] === "v2" && p[1]) return p[1];
  return null;
}

/** Opens a sealed value with whichever of `keys` sealed it. Null when none did or it was changed. */
export function open<T>(sealed: string, keys: readonly VaultKey[]): T | null {
  const id = keyIdOf(sealed);
  const k = keys.find((x) => x.id === id);
  if (!id || !k) return null;
  const p = sealed.split(".");
  const [iv, tag, body] = p.slice(2).map((s) => Buffer.from(s, "base64url"));
  try {
    const d = createDecipheriv("aes-256-gcm", k.key, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}
