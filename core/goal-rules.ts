import { chicagoDate } from "./time";
import { PACK_MEASURE_DEFS } from "@/templates/registry";

// Goals and measures (docs/company-mode.md, slice 2). Pure: no database, no network, so
// `npm run check:goals` can test it.
//
// A goal belongs to a department. Its measure is picked from MEASURES, a list in code, and is
// always counted in code (core/measures.ts), never by a model. Pace and status are worked out
// here from the reading, the target and the dates. A goal whose measure can't be counted yet
// shows "No measure yet" and says which read is missing.

/** Core's measures; a template pack adds its own keys (templates/registry.ts). */
export type CoreMeasureKey = "wholesale_won" | "revenue_month" | "orders_month" | "runway_months" | "email_list_size";
export type MeasureKey = CoreMeasureKey | (string & {});
/**
 * total: a count that grows, to reach by a date (pace from where it stood when the goal was set).
 * month: starts again each Chicago month, to reach by the month's end (the goal has no date).
 * floor: a level to stay at or above (a date is optional).
 */
export type MeasureShape = "total" | "month" | "floor";
export type Unit = "count" | "usd" | "days" | "months";

export interface MeasureDef {
  key: MeasureKey;
  label: string;
  /** "Measured in code: …" on the goal page. */
  how: string;
  unit: Unit;
  shape: MeasureShape;
  /** Word after "1 of 5", for a count. */
  noun?: string;
  /** Can code count it today? When not, `needs` says which read is missing. */
  available: boolean;
  needs?: string;
  /** Which department it usually belongs to, to sort the picker. */
  hint: string;
}

const CORE_MEASURES: readonly MeasureDef[] = [
  { key: "wholesale_won", label: "Wholesale accounts won", how: "leads at stage Won in the leads list.", unit: "count", shape: "total", noun: "won", available: true, hint: "sales" },
  { key: "revenue_month", label: "Revenue this month", how: "every order this month in Shopify (all channels, cancelled orders left out), added up.", unit: "usd", shape: "month", available: true, hint: "finance" },
  { key: "orders_month", label: "Orders this month", how: "orders this month in Shopify (all channels, cancelled orders left out).", unit: "count", shape: "month", noun: "orders", available: true, hint: "sales" },
  { key: "runway_months", label: "Months of runway", how: "cash in Mercury divided by the net burn per 30 days over the last 90 days.", unit: "months", shape: "floor", available: true, hint: "finance" },
  { key: "email_list_size", label: "Email list size", how: "profiles on the email list picked on Connections › Klaviyo, as Klaviyo counts them.", unit: "count", shape: "total", noun: "subscribers", available: true, hint: "marketing" },
];
/** Core's measures, then each pack's. A pack never replaces a core measure. */
export const MEASURES: readonly MeasureDef[] = [...CORE_MEASURES, ...PACK_MEASURE_DEFS.filter((m) => !CORE_MEASURES.some((c) => c.key === m.key))];
export const measureOf = (key: string | null | undefined): MeasureDef | null => MEASURES.find((m) => m.key === key) ?? null;

export const MAX_GOALS_PER_DEPT = 3;
export const MAX_GOAL_TITLE = 120;
const MAX_TARGET = 1e9;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type GoalState = "active" | "paused" | "done" | "dropped";
export interface GoalInput { title?: unknown; measure?: unknown; target?: unknown; dueOn?: unknown }
export interface GoalPlan { title: string; measure: MeasureKey | null; target: number | null; dueOn: string | null }

/** Whole days from one "YYYY-MM-DD" to another. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const validDate = (d: string) => DATE.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Checks what the owner typed for a goal. `today` is the Chicago date. A measure code can't count yet is
 * kept (so the goal says what's missing) with no target needed.
 */
export function planGoal(input: GoalInput, today: string): { plan: GoalPlan } | { error: string } {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return { error: "Say what the goal is, like “Land 5 wholesale accounts by Mar 31”." };
  if (title.length > MAX_GOAL_TITLE) return { error: `Keep the goal to ${MAX_GOAL_TITLE} characters.` };
  if (/https?:\/\/|www\./i.test(title)) return { error: "A goal can't hold a link." };
  const raw = input.measure == null || input.measure === "" ? null : String(input.measure);
  const m = raw == null ? null : measureOf(raw);
  if (raw != null && !m) return { error: "Pick a measure from the list." };

  const due = input.dueOn == null || input.dueOn === "" ? null : String(input.dueOn);
  if (due != null) {
    if (!validDate(due)) return { error: "Pick a real date for when it's due." };
    if (daysBetween(today, due) < 1) return { error: "The due date has to be after today." };
    if (daysBetween(today, due) > 3 * 366) return { error: "Pick a due date within 3 years." };
  }
  if (!m || !m.available) return { plan: { title, measure: m?.key ?? null, target: null, dueOn: due } };

  const target = typeof input.target === "number" ? input.target : Number(String(input.target ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(target) || target <= 0) return { error: `Give a target above zero for “${m.label}”.` };
  if (target > MAX_TARGET) return { error: "That target is too big." };
  if ((m.unit === "count" || m.unit === "days") && !Number.isInteger(target)) return { error: `${m.label} is a whole number.` };
  const t = m.unit === "usd" ? Math.round(target * 100) / 100 : m.unit === "months" ? Math.round(target * 10) / 10 : target;
  if (m.shape === "total" && due == null) return { error: `“${m.label}” needs a date to reach it by.` };
  // a monthly measure resets each month, so a date means nothing
  return { plan: { title, measure: m.key, target: t, dueOn: m.shape === "month" ? null : due } };
}

/** What code read for a measure. `unbounded` is for runway when nothing is burning. */
export type Reading = { value: number; unbounded?: boolean; asOf?: string } | { error: string };

export interface GoalRow {
  measure: string | null; target: number | null; start_value: number | null; due_on: string | null;
  state: GoalState;
  /** When pace starts: the day the goal was set, or the day its measure last changed. */
  paced_from: string;
}
export type GoalStatus = "on_track" | "behind" | "reached" | "missed" | "no_measure" | "unreadable" | "paused" | "done";
export interface Progress {
  status: GoalStatus;
  value: number | null;
  /** 0..100, for the bar; null when there's nothing to draw. */
  pct: number | null;
  /** "1 of 5 won", "$1,240 of $3,000 this month", "48 days, at least 45". */
  line: string;
  /** "One more every 26 days to get there. At the current rate, about 3 by Mar 31." */
  pace: string | null;
}

export const STATUS_WORDS: Record<GoalStatus, string> = {
  on_track: "On track", behind: "Behind", reached: "Reached", missed: "Missed", no_measure: "No measure yet", unreadable: "Couldn't read", paused: "Paused", done: "Done",
};

export function fmt(n: number, unit: Unit): string {
  const r = (x: number, d = 0, min = 0) => x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: min });
  if (unit === "usd") return n < 100 ? `$${r(n, 2, 2)}` : `$${r(n)}`;
  if (unit === "days") return `${r(n)} day${n === 1 ? "" : "s"}`;
  if (unit === "months") return `${r(n, 1)} month${n === 1 ? "" : "s"}`;
  return r(n);
}
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthDays = (today: string) => { const [y, m] = today.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/**
 * Where a goal stands, from what code read. `today` is the Chicago date. Everything here is plain
 * arithmetic on the reading, the target and the dates.
 */
export function progress(g: GoalRow, reading: Reading | null, today: string): Progress {
  const m = measureOf(g.measure);
  const blank = (status: GoalStatus, line: string): Progress => ({ status, value: null, pct: null, line, pace: null });
  if (!m || !m.available || g.target == null) return blank(g.state === "done" ? "done" : "no_measure", m && !m.available ? `Code can't count ${m.label.toLowerCase()} until ${m.needs} exists.` : "Pick a measure so code can count it.");
  if (!reading) return blank("unreadable", "Not read yet.");
  if ("error" in reading) return { ...blank(g.state === "paused" ? "paused" : g.state === "done" ? "done" : "unreadable", `Couldn't count it: ${reading.error}`) };
  const v = reading.value, t = g.target, u = m.unit;
  const held = (s: GoalStatus): GoalStatus => (g.state === "paused" ? "paused" : g.state === "done" ? "done" : s);

  if (m.shape === "floor") {
    if (reading.unbounded) return { status: held("on_track"), value: null, pct: 100, line: `No net burn, so no runway limit (needs at least ${fmt(t, u)})`, pace: null };
    const ok = v >= t;
    const pace = !ok ? `${fmt(Math.round((t - v) * 100) / 100, u)} under the line.` : null;
    return { status: held(ok ? "on_track" : "behind"), value: v, pct: Math.max(0, Math.min(100, (v / t) * 100)), line: `${fmt(v, u)}, at least ${fmt(t, u)}`, pace };
  }

  if (m.shape === "month") {
    const days = monthDays(today), day = Number(today.slice(8));
    // days already over: on the 1st nothing is expected yet
    const expected = (t * (day - 1)) / days;
    const reached = v >= t;
    const onPace = Math.round(((v / day) * days) * 100) / 100;
    const s: GoalStatus = reached ? "reached" : v >= expected ? "on_track" : "behind";
    const pace = reached ? null : `On pace for ${fmt(u === "count" ? Math.round(onPace) : onPace, u)} by the month's end.`;
    return { status: held(s), value: v, pct: Math.min(100, (v / t) * 100), line: `${fmt(v, u)} of ${fmt(t, u)}${m.noun && u === "count" ? ` ${m.noun}` : ""} this month`, pace };
  }

  // total: reach the target by the due date, paced from where it stood when the goal was set
  const start = Math.min(g.start_value ?? 0, t);
  const set = chicagoDate(0, new Date(g.paced_from)), due = g.due_on ?? addDays(set, 90);
  const span = Math.max(1, daysBetween(set, due));
  const elapsed = Math.max(0, Math.min(span, daysBetween(set, today)));
  const line = `${fmt(v, u)} of ${fmt(t, u)}${m.noun ? ` ${m.noun}` : ""}`;
  const pct = Math.max(0, Math.min(100, (v / t) * 100));
  if (v >= t) return { status: held("reached"), value: v, pct, line, pace: null };
  if (daysBetween(today, due) < 0) return { status: held("missed"), value: v, pct, line, pace: `Due ${shortDate(due)} and not reached.` };
  const expected = start + ((t - start) * elapsed) / span;
  const s: GoalStatus = v >= Math.floor(expected) ? "on_track" : "behind";
  const left = t - v, daysLeft = Math.max(1, daysBetween(today, due));
  const per = daysLeft / left;
  const need = u === "count" ? (per >= 1 ? `One more every ${Math.round(per)} day${Math.round(per) === 1 ? "" : "s"} to get there.` : `About ${Math.ceil((left / daysLeft) * 7)} a week to get there.`) : `${fmt(left, u)} to go in ${daysLeft} days.`;
  const gained = v - start;
  const proj = elapsed >= 7 && gained > 0 ? ` At the current rate, about ${fmt(Math.floor(start + (gained / elapsed) * span), u)} by ${shortDate(due)}.` : "";
  return { status: held(s), value: v, pct, line, pace: need + proj };
}
