import { OUTSIDE_POINTER } from "./pointer";

// Plans (docs/company-mode.md, slice 4): a head's week for its department. Pure: no database, no
// network, so `npm run check:plans` can test it.
//
// A plan is the head's words (its run's result) plus up to 8 lines. Each line names who does it:
// a teammate under the head (the line becomes a 7-day focus note for that teammate, never
// authority), an open seat (a job nobody holds yet; the head proposes a hire separately), or the owner
// (a person's job; the head only suggests, the owner marks it done). Who is matched in code against the
// chart, never taken from the model as an id.

export const MAX_PLAN_LINES = 8;
export const FOCUS_DAYS = 7;
export const MAX_FOCUS = 280;

export type LineKind = "agent" | "seat" | "owner";
export interface PlanItem {
  n: number;
  title: string;
  kind: LineKind;
  /** The teammate or open seat, by name, as the chart had it. "You" for the owner. */
  who: string;
  agentId?: string;
  seatId?: string;
  /** The focus for the teammate, or the note for the owner. */
  words: string;
  /** The focus note saved for the teammate. */
  memoryId?: string;
  doneAt?: string;
}

const one = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const OWNER = /^(you|me|owner|the owner|a person)$/i;

/** The Monday (Chicago calendar date) of the week a date is in. */
export function weekOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10);
}
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Checks one plan line the head handed in. */
export function checkLine(input: Record<string, unknown>): { line: { title: string; who: string; words: string } } | { problem: string } {
  const title = one(input.title, 120);
  if (title.length < 3) return { problem: "title must say what the job is" };
  const who = one(input.who, 60);
  if (!who) return { problem: "who must name a teammate under you, an open seat, or the owner" };
  const words = one(input.words, MAX_FOCUS);
  if (words.length < 10) return { problem: "words must say what to focus on, in a sentence" };
  if (OUTSIDE_POINTER.test(title) || OUTSIDE_POINTER.test(words)) return { problem: "a plan line can't hold an address, a phone number or a link" };
  return { line: { title, who, words } };
}

export interface Reach { team: { id: string; name: string }[]; openSeats: { id: string; title: string }[] }

/** Who a line names, matched against the head's team and its department's open seats. */
export function resolveWho(who: string, reach: Reach): { kind: "owner" } | { kind: "agent"; agentId: string; name: string } | { kind: "seat"; seatId: string; title: string } | { problem: string } {
  if (OWNER.test(who.trim())) return { kind: "owner" };
  const a = reach.team.find((t) => same(t.name, who) || same(t.id, who));
  if (a) return { kind: "agent", agentId: a.id, name: a.name };
  const s = reach.openSeats.find((x) => same(x.title, who));
  if (s) return { kind: "seat", seatId: s.id, title: s.title };
  return { problem: `${who} isn't a teammate under you, an open seat in your department, or the owner` };
}

/** The 7-day focus note a teammate carries into its runs. */
export function focusText(head: string, until: string, words: string): string {
  const t = `Focus from ${head}, until ${shortDay(until)}: ${words}`;
  return t.length > MAX_FOCUS ? `${t.slice(0, MAX_FOCUS - 1)}…` : t;
}

/** Turns checked lines into plan items. Lines that name nobody it can reach are dropped with why. */
export function planItems(lines: { title: string; who: string; words: string }[], reach: Reach): { items: PlanItem[]; dropped: string[] } {
  const items: PlanItem[] = [], dropped: string[] = [];
  for (const l of lines.slice(0, MAX_PLAN_LINES)) {
    const w = resolveWho(l.who, reach);
    if ("problem" in w) { dropped.push(`${l.title}: ${w.problem}`); continue; }
    const base = { n: items.length + 1, title: l.title, words: l.words };
    if (w.kind === "owner") items.push({ ...base, kind: "owner", who: "You" });
    else if (w.kind === "agent") {
      if (items.some((i) => i.agentId === w.agentId)) { dropped.push(`${l.title}: ${w.name} already has a focus this week`); continue; }
      items.push({ ...base, kind: "agent", who: w.name, agentId: w.agentId });
    } else items.push({ ...base, kind: "seat", who: w.title, seatId: w.seatId });
  }
  return { items, dropped };
}

/** "Plan" when the department has no plan this week yet, else "review". Shown to the head by the This week tool. */
export const runMode = (hasPlan: boolean): "plan" | "review" => (hasPlan ? "review" : "plan");

/** The jobs a plan gives the owner that nobody has marked done. */
export const openJobs = (items: PlanItem[]) => items.filter((i) => i.kind === "owner" && !i.doneAt);
