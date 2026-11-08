// Calendar dates in Chicago, where One Two works. Vercel Cron runs in UTC.
export const TZ = "America/Chicago";

/** "2026-10-27" for the Chicago calendar day `daysAgo` before now. */
export function chicagoDate(daysAgo = 1, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now.getTime() - daysAgo * 864e5));
}
/** Chicago's UTC offset on a given day, "-05:00" or "-06:00". */
export const offsetOn = (date: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-06:00";
export const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** "Thu, Oct 29" for a Chicago calendar date like "2026-10-29". */
export const dayTitle = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
