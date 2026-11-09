// Shift times in Central Time, mirrored from vercel.json (Vercel Schedules own the real timing).
import { chicagoDate, nextDay, offsetOn } from "@/core/time";
import type { Schedule } from "./crew";
import { t12 } from "./format";

/** The UTC instant for a Chicago calendar date and "HH:MM". */
export const chicagoAt = (date: string, time: string) => Date.parse(`${date}T${time}:00${offsetOn(date)}`);

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const fires = (s: Schedule, date: string) => s.kind === "daily" || (s.kind === "weekdays" && weekday(date) >= 1 && weekday(date) <= 5);

/** The scheduled firing on a Chicago date, if any. */
export function firingOn(s: Schedule | undefined, date: string) {
  return s && s.kind !== "manual" && s.time && fires(s, date) ? chicagoAt(date, s.time) : null;
}

export function nextRuns(s: Schedule | undefined, from = Date.now(), n = 5) {
  const out: number[] = [];
  if (!s || s.kind === "manual" || !s.time) return out;
  let d = chicagoDate(0, new Date(from));
  for (let i = 0; i < 30 && out.length < n; i++, d = nextDay(d)) {
    const t = firingOn(s, d);
    if (t && t > from) out.push(t);
  }
  return out;
}

/** The next seven Chicago dates, starting today. */
export function weekFrom(now = Date.now()) {
  const days = [chicagoDate(0, new Date(now))];
  while (days.length < 7) days.push(nextDay(days[days.length - 1]));
  return days;
}

export function schedWords(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "Manual only";
  return `${s.kind === "daily" ? "Daily" : "Weekdays"} ${t12(s.time)} CT`;
}

export function schedSentence(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "No automatic runs. Runs only when you press Run.";
  return `Runs every ${s.kind === "daily" ? "day" : "weekday"} at ${t12(s.time)} Central.`;
}
