// Control Room sessions: the cookie itself lives in core/session.ts (core/request-org.ts reads it
// to learn a request's org). Re-exported here for the pages and actions.
export { SESSION_COOKIE, SESSION_DAYS, loginConfigured, newSessionToken, sessionCookieOptions, sessionMemberId, sessionOf, validSessionToken } from "@/core/session";

/** Controls that can spend money or wake an agent (real runs, back on the crew, budget changes). */
export const controlsOn = () => ["on", "1", "true"].includes((process.env.DASHBOARD_CONTROLS ?? "").trim().toLowerCase());
