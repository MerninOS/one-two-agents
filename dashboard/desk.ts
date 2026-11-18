// The Desk (docs/company-mode.md, slice 5): its greeting and summary line, counted in code. Pure, so
// `npm run check:chat` can test it.
import type { GoalStatus } from "@/core/goal-rules";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number, lower = false) => { const w = n <= 10 ? WORDS[n] : String(n); return lower ? w.toLowerCase() : w; };

/** "Good morning" before noon Central Time, "Good afternoon" until 5 PM, then "Good evening". */
export function deskGreeting(now: number): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(new Date(now)));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Two goals on track, one behind, one can't be measured yet. Three proposals need you." */
export function deskLine(statuses: GoalStatus[], proposals: number, otherNeeds: number): string {
  const n = (s: GoalStatus[]) => statuses.filter((x) => s.includes(x)).length;
  const counts: [number, string][] = ([[n(["on_track", "reached", "done"]), "on track"], [n(["behind", "missed"]), "behind"], [n(["no_measure", "unreadable"]), "can’t be measured yet"], [n(["paused"]), "paused"]] as [number, string][]).filter(([c]) => c > 0);
  const goals = !counts.length ? "No goals set yet." : `${counts.map(([c, t], i) => (i ? `${word(c, true)} ${t}` : `${word(c)} goal${c === 1 ? "" : "s"} ${t}`)).join(", ")}.`;
  const asks = proposals ? `${word(proposals)} proposal${proposals === 1 ? " needs" : "s need"} you` : "";
  const other = !otherNeeds ? "" : asks ? `and ${word(otherNeeds, true)} other thing${otherNeeds === 1 ? "" : "s"}` : `${word(otherNeeds)} thing${otherNeeds === 1 ? " needs" : "s need"} you`;
  const tail = asks || other ? `${[asks, other].filter(Boolean).join(" ")}.` : "Nothing needs you.";
  return `${goals} ${tail}`;
}

/** The first sentence of an agent's words, cut to a length, for a tile or a card. */
export function firstSentence(text: string | null | undefined, max = 160): string {
  const t = String(text ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
