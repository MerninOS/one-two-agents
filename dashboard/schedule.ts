// Shift times in Central Time, from each agent's place in the crew flow (dashboard/roster.ts scheduleOf).
// The dispatcher (app/api/dispatch) runs them while the org is on (docs/org-schedule.md).
import { DAY_WORDS, onDay } from "@/core/flow-rules";
import { chicagoDate, nextDay, offsetOn } from "@/core/time";
import type { Schedule } from "./crew";
import { t12 } from "./format";

/** The UTC instant for a Chicago calendar date and "HH:MM". */
export const chicagoAt = (date: string, time: string) => Date.parse(`${date}T${time}:00${offsetOn(date)}`);

const fires = (s: Schedule, date: string) => s.kind !== "manual" && onDay(s.kind, date);

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

export function schedWords(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "Manual only";
  return `${{ daily: "Daily", weekdays: "Weekdays", mondays: "Mondays" }[s.kind]} ${t12(s.time)} CT`;
}

export function schedSentence(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "No automatic runs. Runs only when you press Run.";
  return `Runs ${DAY_WORDS[s.kind]} at ${t12(s.time)} Central.`;
}
