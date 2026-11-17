// Control Room sessions (docs/tenancy.md, slice 2): each person signs in as themselves with an
// emailed link, and gets an HMAC-signed cookie naming their member id. The cookie says who; every
// page and action reads the member again (dashboard/data.ts requireSession), so a removed member
// or a changed role takes effect on their next click. No SESSION_SECRET means nobody gets in.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "op_session";
export const SESSION_DAYS = 30;

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

export function newSessionToken(memberId: string, now = Date.now()) {
  if (!loginConfigured()) throw new Error("SESSION_SECRET isn’t set (at least 32 characters), so nobody can sign in yet.");
  if (!ID.test(memberId)) throw new Error("A session names a member id.");
  const payload = `v2.${memberId}.${now + SESSION_DAYS * 864e5}`;
  return `${payload}.${sign(payload)}`;
}

/** The member id a valid, unexpired cookie names; null otherwise. */
export function sessionMemberId(token: string | undefined, now = Date.now()): string | null {
  if (!token || !loginConfigured()) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const [v, id, exp, extra] = payload.split(".");
  if (v !== "v2" || extra !== undefined || !ID.test(id ?? "") || !(Number(exp) > now)) return null;
  return same(mac, sign(payload)) ? id : null;
}

export const validSessionToken = (token: string | undefined, now = Date.now()) => sessionMemberId(token, now) !== null;

export const sessionCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_DAYS * 86400 });

/** Controls that can spend money or wake an agent (real runs, back on the crew, budget changes). */
export const controlsOn = () => ["on", "1", "true"].includes((process.env.DASHBOARD_CONTROLS ?? "").trim().toLowerCase());
