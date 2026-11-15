// Goals (docs/company-mode.md, slice 2): a goal tile for Crew and the home page, and its status look.
// Plain markup, so both server pages and the client org chart can use it. Every number on it comes
// from code (core/measures.ts and core/goal-rules.ts).
import Link from "next/link";
import type { GoalStatus } from "@/core/goal-rules";
import type { Look } from "../status";
import type { GoalView } from "../goals";
import { Pill } from "./ui";

export const GOAL_LOOK: Record<GoalStatus, Look> = {
  on_track: { label: "On track", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  reached: { label: "Reached", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  done: { label: "Done", dot: "var(--mint)", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  behind: { label: "Behind", dot: "var(--yel)", bg: "var(--yel-soft)", fg: "var(--yel-ink)" },
  missed: { label: "Missed", dot: "var(--red)", bg: "var(--red-soft)", fg: "var(--red-ink)" },
  unreadable: { label: "Couldn't read", dot: "var(--red)", bg: "var(--red-soft)", fg: "var(--red-ink)" },
  no_measure: { label: "No measure yet", dot: "var(--mut2)", bg: "var(--soft)", fg: "var(--ink2)" },
  paused: { label: "Paused", dot: "var(--mut)", bg: "var(--soft)", fg: "var(--ink2)" },
};
const BAR: Partial<Record<GoalStatus, string>> = { on_track: "var(--mint)", reached: "var(--mint)", done: "var(--mint)", behind: "var(--yel)", missed: "var(--red)" };

/** One goal: its words, status, what code counted, and a bar. Links to the goal page. */
/** quote: the head's latest word on the Desk (its own report, so its words, not code's). */
export function GoalTile({ g, showDept, quote }: { g: GoalView; showDept?: boolean; quote?: { who: string; text: string } | null }) {
  return (
    <Link href={`/goals/${g.id}`} className="goal-tile" style={g.paused ? { opacity: 0.7 } : undefined}>
      <span className="row wrap" style={{ gap: 8 }}>
        {showDept && <span className="ted-k" style={{ flex: 1 }}>{g.deptName}</span>}
        <Pill look={GOAL_LOOK[g.status]} sm />
      </span>
      <b className="goal-t">{g.title}</b>
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{g.line}</span>
      {g.pct != null && (
        <div className="bar" style={{ height: 6, borderRadius: 999 }} role="img" aria-label={`${Math.round(g.pct)}% of the target`}>
          <span style={{ width: `${Math.max(2, g.pct)}%`, background: BAR[g.status] ?? "var(--mut2)" }} />
        </div>
      )}
      {quote?.text && <span style={{ fontSize: 12.5, lineHeight: 1.45 }} className="ink2">{quote.who}: “{quote.text}”</span>}
    </Link>
  );
}
