// Control Room sessions (docs/tenancy.md, slices 2 and 8.1): each person signs in as themselves and
// gets an HMAC-signed cookie naming their member id and the org that membership is in. The cookie
// says who and which business; every page and action reads the member again inside that org
// (dashboard/data.ts requireSession), so a removed member or a changed role takes effect on their
// next click. No SESSION_SECRET means nobody gets in. Pure apart from node:crypto.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "op_session";
export const SESSION_DAYS = 30;
/** The short-lived cookie between a sign-in and picking a business, for a person in more than one. */
export const PICK_COOKIE = "op_pick";
export const PICK_MINUTES = 10;

const secret = () => process.env.SESSION_SECRET?.trim() || "";
// Changing the secret signs everyone out.
const key = () => createHash("sha256").update(`operator-session:${secret()}`).digest();
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** A secret too short to trust signs nobody in. */
export const loginConfigured = () => secret().length >= 32;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Session { memberId: string; orgId: string }

export function newSessionToken(memberId: string, orgId: string, now = Date.now()) {
  if (!loginConfigured()) throw new Error("SESSION_SECRET isn’t set (at least 32 characters), so nobody can sign in yet.");
  if (!ID.test(memberId)) throw new Error("A session names a member id.");
  if (!ID.test(orgId)) throw new Error("A session names an org id.");
  const payload = `v3.${memberId}.${orgId}.${now + SESSION_DAYS * 864e5}`;
  return `${payload}.${sign(payload)}`;
}

/** The member and org a valid, unexpired v3 cookie names; null otherwise (older cookies sign in again, card 135). */
export function sessionOf(token: string | undefined, now = Date.now()): Session | null {
  if (!token || !loginConfigured()) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  if (!same(mac, sign(payload))) return null;
  const parts = payload.split(".");
  if (parts[0] === "v3" && parts.length === 4) {
    const [, memberId, orgId, exp] = parts;
    return ID.test(memberId) && ID.test(orgId) && Number(exp) > now ? { memberId, orgId } : null;
  }
  return null;
}

export const sessionMemberId = (token: string | undefined, now = Date.now()) => sessionOf(token, now)?.memberId ?? null;
export const validSessionToken = (token: string | undefined, now = Date.now()) => sessionOf(token, now) !== null;

export const sessionCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_DAYS * 86400 });

/**
 * The pick cookie: the memberships one verified sign-in may choose between, signed and short-lived.
 * It holds ids only; the pick page reads names again, and picking checks the choice is in the list.
 */
export function newPickToken(choices: Session[], now = Date.now()) {
  if (!loginConfigured()) throw new Error("SESSION_SECRET isn’t set (at least 32 characters), so nobody can sign in yet.");
  if (!choices.length || choices.some((c) => !ID.test(c.memberId) || !ID.test(c.orgId))) throw new Error("A pick names member and org ids.");
  const payload = `p1.${choices.map((c) => `${c.memberId}~${c.orgId}`).join("_")}.${now + PICK_MINUTES * 6e4}`;
  return `${payload}.${sign(payload)}`;
}

export function pickChoices(token: string | undefined, now = Date.now()): Session[] {
  if (!token || !loginConfigured()) return [];
  const i = token.lastIndexOf(".");
  if (i < 0) return [];
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  if (!same(mac, sign(payload))) return [];
  const [v, list, exp, extra] = payload.split(".");
  if (v !== "p1" || extra !== undefined || !(Number(exp) > now) || !list) return [];
  const out = list.split("_").map((pair) => { const [memberId, orgId] = pair.split("~"); return { memberId, orgId }; });
  return out.every((c) => ID.test(c.memberId ?? "") && ID.test(c.orgId ?? "")) ? out : [];
}

export const pickCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/auth", maxAge: PICK_MINUTES * 60 });
