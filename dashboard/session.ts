// Control Room login: one password (DASHBOARD_PASSWORD) and an HMAC-signed cookie.
// No password set means nobody gets in. Used by proxy.ts and by every data function
// and server action, so a page that slips past the proxy still reads nothing.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "cr_session";
export const SESSION_DAYS = 30;

const password = () => process.env.DASHBOARD_PASSWORD?.trim() || "";
// Changing the password signs everyone out.
const key = () => createHash("sha256").update(`one-two-control-room:${password()}`).digest();
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const loginConfigured = () => password().length > 0;

export function checkPassword(input: string) {
  if (!loginConfigured()) return false;
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  return same(h(input), h(password()));
}

export function newSessionToken(now = Date.now()) {
  const payload = `v1.${now + SESSION_DAYS * 864e5}`;
  return `${payload}.${sign(payload)}`;
}

export function validSessionToken(token: string | undefined, now = Date.now()) {
  if (!token || !loginConfigured()) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const [v, exp] = payload.split(".");
  return v === "v1" && Number(exp) > now && same(mac, sign(payload));
}

/** Controls that can spend money or wake an agent (real runs, back on the crew, budget changes). */
export const controlsOn = () => ["on", "1", "true"].includes((process.env.DASHBOARD_CONTROLS ?? "").trim().toLowerCase());
