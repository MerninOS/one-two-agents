// Which run alerts Zak has already looked at. Kept in a cookie per browser: agent id -> time of the last look.
export const SEEN_COOKIE = "cr_seen";
export type Seen = Record<string, number>;

export function parseSeen(raw: string | undefined): Seen {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw));
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === "number")) as Seen;
  } catch {
    return {};
  }
}
