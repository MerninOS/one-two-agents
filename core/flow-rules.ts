// The crew flow rules (docs/agent-setup.md, slice 5), with no database access so the Crew canvas
// can check a draft in the browser; core/flow.ts adds loading and saving.
//
// The crew flow: which agents run when, and which agent starts
// after another. A flow is a list of chains. Each chain has one start (a schedule, the Run
// button, or an approval being decided) and one to three agent steps. A step after the first
// can wait for the step before it to finish OK or failed (or either), only go on if a number
// the code computed passes a check, only run on some days, wait until a time, and pass the
// earlier step's summary along as facts.
//
// A flow is choices from the palette below, never authority. Every run it starts goes through
// withRun (on duty, daily budget), a skipped run stops the chain, and nothing here can turn an
// agent on. Inbound email and web pages never choose what runs next: only the saved flow does.
import { chicagoDate, nextDay, offsetOn } from "@/core/time";

export const MAX_STEPS = 3;
export const MAX_CHAINS = 12;
export type Days = "daily" | "weekdays";
export type When = "ok" | "failed" | "any";
export type Op = ">=" | ">" | "<=" | "<" | "=";

export type Start =
  | { type: "schedule"; days: Days; time: string }
  | { type: "button" }
  | { type: "approval"; tool: string; decision: "approve" | "reject" | "any" };

export interface Step {
  agent: string;
  /** How the step before must have ended. Ignored on the first step. */
  when?: When;
  /** Only go on when this number, computed in code by the step before, passes. */
  check?: { metric: string; op: Op; value: number };
  /** Only on these days (Chicago). */
  days?: Days;
  /** Wait until this Chicago time ("HH:MM") if the step before finished earlier. */
  notBefore?: string;
  /** Hand the step before's summary and numbers to this agent as facts. */
  passAlong?: boolean;
}

export interface Chain { key: string; name: string; on: boolean; start: Start; steps: Step[] }
export interface Flow { chains: Chain[] }

// ---- The palette: everything a flow may pick. Code, on purpose.

/** Numbers an agent's run reports (RunResult.metrics), which a check may test. */
export const METRICS: Record<string, { key: string; label: string }[]> = {
  wholesale_hunter: [{ key: "new_leads", label: "New leads" }, { key: "drafts", label: "Gmail drafts" }],
  bookkeeper: [{ key: "proposals", label: "Changes proposed" }, { key: "open", label: "Receipts still missing" }],
  cfo: [{ key: "orders", label: "Orders yesterday" }],
};
/** Agents that read a hand-off (JobOpts.handoff) as facts. The rest ignore it, so the palette doesn't offer it. */
export const TAKES_HANDOFF = new Set(["chief_of_staff"]);
/**
 * Agents that run only by hand (agents/registry.ts manualOnly: Rowan costs about $1 a run, Quinn
 * proposes Mercury changes). They may only be in a chain started with the Run chain button.
 */
export const BUTTON_ONLY = new Set(["wholesale_hunter", "bookkeeper"]);
/** Gateway action types an approval start may name (core/gateway/policy.ts TOOLS). */
export const APPROVAL_TOOLS = ["mercury.annotate_transaction"];
export const APPROVAL_LABELS: Record<string, string> = { "mercury.annotate_transaction": "Quinn’s receipt, category and memo changes" };
const OPS: Op[] = [">=", ">", "<=", "<", "="];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Why a flow can't be saved, one line per problem; [] when it is fine. `agents` is the list of
 * agent ids the app can run (agents/registry.ts).
 */
export function flowProblems(f: unknown, agents: readonly string[]): string[] {
  const out: string[] = [];
  const x = (f ?? {}) as { chains?: unknown };
  if (!Array.isArray(x.chains)) return ["The flow has no chain list."];
  if (x.chains.length > MAX_CHAINS) out.push(`At most ${MAX_CHAINS} chains.`);
  const keys = new Set<string>();
  x.chains.forEach((c: Chain, i: number) => {
    const at = `Chain ${i + 1}${typeof c?.name === "string" && c.name ? ` (${c.name})` : ""}`;
    if (!c || typeof c !== "object") { out.push(`${at} is not a chain.`); return; }
    if (typeof c.key !== "string" || !/^[a-z0-9_-]{1,40}$/.test(c.key)) out.push(`${at} has no key.`);
    else if (keys.has(c.key)) out.push(`${at}: two chains share the key ${c.key}.`); else keys.add(c.key);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 60) out.push(`${at} needs a name of up to 60 characters.`);
    if (typeof c.on !== "boolean") out.push(`${at}: on must be true or false.`);
    const s = c.start as Start;
    if (s?.type === "schedule") {
      if (s.days !== "daily" && s.days !== "weekdays") out.push(`${at}: the schedule runs daily or on weekdays.`);
      if (typeof s.time !== "string" || !TIME.test(s.time)) out.push(`${at}: the schedule time must be HH:MM.`);
      else if (Number(s.time.slice(3)) % 15) out.push(`${at}: the dispatcher runs every 15 minutes, so pick :00, :15, :30 or :45.`);
    } else if (s?.type === "approval") {
      if (!APPROVAL_TOOLS.includes(s.tool)) out.push(`${at}: unknown approval type ${String(s.tool)}.`);
      if (!["approve", "reject", "any"].includes(s.decision)) out.push(`${at}: the approval start needs approve, reject or any.`);
    } else if (s?.type !== "button") out.push(`${at}: the start must be a schedule, the Run button or an approval.`);
    if (!Array.isArray(c.steps) || !c.steps.length) { out.push(`${at} has no agents.`); return; }
    if (c.steps.length > MAX_STEPS) out.push(`${at}: at most ${MAX_STEPS} agents in a chain.`);
    const seen = new Set<string>();
    c.steps.forEach((st: Step, k: number) => {
      const sat = `${at}, step ${k + 1}`;
      if (!st || !agents.includes(st.agent)) { out.push(`${sat}: unknown agent.`); return; }
      if (seen.has(st.agent)) out.push(`${sat}: ${st.agent} is already in this chain. No loops.`); seen.add(st.agent);
      if (BUTTON_ONLY.has(st.agent) && s?.type !== "button") out.push(`${sat}: ${st.agent} runs only by hand, so it can only be in a chain started with the Run chain button.`);
      if (st.when !== undefined && !["ok", "failed", "any"].includes(st.when)) out.push(`${sat}: when must be ok, failed or any.`);
      if (st.days !== undefined && st.days !== "daily" && st.days !== "weekdays") out.push(`${sat}: days must be daily or weekdays.`);
      if (st.notBefore !== undefined && (typeof st.notBefore !== "string" || !TIME.test(st.notBefore) || Number(st.notBefore.slice(3)) % 15)) out.push(`${sat}: not before must be HH:MM on a quarter hour.`);
      if (st.passAlong !== undefined && typeof st.passAlong !== "boolean") out.push(`${sat}: pass along must be true or false.`);
      if (st.passAlong && !TAKES_HANDOFF.has(st.agent)) out.push(`${sat}: ${st.agent} can't read a hand-off yet.`);
      if (st.check !== undefined) {
        const prev = k > 0 ? c.steps[k - 1]?.agent : undefined;
        if (k === 0) out.push(`${sat}: the first step has nothing before it to check.`);
        else if (!METRICS[prev!]?.some((m) => m.key === st.check!.metric)) out.push(`${sat}: ${prev} doesn't report ${String(st.check.metric)}.`);
        if (!OPS.includes(st.check.op) || typeof st.check.value !== "number" || !Number.isFinite(st.check.value)) out.push(`${sat}: the check needs a comparison and a number.`);
      }
    });
  });
  return out;
}

/** A flow from the database, with anything malformed dropped (and said so) rather than run. */
export function readFlow(raw: unknown, agents: readonly string[]): { flow: Flow; problems: string[] } {
  const chains = Array.isArray((raw as Flow)?.chains) ? (raw as Flow).chains : [];
  const ok: Chain[] = [], problems: string[] = [];
  for (const c of chains) {
    const p = flowProblems({ chains: [c] }, agents);
    if (p.length) problems.push(...p); else ok.push(c);
  }
  return { flow: { chains: ok }, problems };
}

// ---- Time: schedules and waits are Chicago wall-clock times.

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const onDay = (days: Days | undefined, date: string) => !days || days === "daily" || (weekday(date) >= 1 && weekday(date) <= 5);
export const chicagoAt = (date: string, time: string) => Date.parse(`${date}T${time}:00${offsetOn(date)}`);

/**
 * The scheduled firings of a chain that fall in (from, to]. The dispatcher asks about the last
 * hour every 15 minutes; chain_fires makes sure each firing starts once.
 */
export function firingsBetween(c: Chain, from: number, to: number): number[] {
  if (c.start.type !== "schedule") return [];
  const out: number[] = [];
  let d = chicagoDate(0, new Date(from));
  for (let i = 0; i < 3; i++, d = nextDay(d)) {
    if (!onDay(c.start.days, d)) continue;
    const t = chicagoAt(d, c.start.time);
    if (t > from && t <= to) out.push(t);
  }
  return out;
}

/** The next firings of a chain from `now`, for the canvas. */
export function nextFirings(c: Chain, now = Date.now(), n = 3): number[] {
  if (c.start.type !== "schedule") return [];
  const out: number[] = [];
  let d = chicagoDate(0, new Date(now));
  for (let i = 0; i < 14 && out.length < n; i++, d = nextDay(d)) {
    if (!onDay(c.start.days, d)) continue;
    const t = chicagoAt(d, c.start.time);
    if (t > now) out.push(t);
  }
  return out;
}

/** Runs per 30 days of a chain's first step, for the monthly cost: 30 for daily, about 22 for weekdays, 0 for other starts. */
export const runsPerMonth = (c: Chain) => (c.start.type !== "schedule" ? 0 : c.start.days === "daily" ? 30 : 22);

// ---- Going on after a step

export interface Ended { status: "ok" | "skipped" | "failed"; metrics?: Record<string, number> }

const pass = (op: Op, a: number, b: number) => (op === ">=" ? a >= b : op === ">" ? a > b : op === "<=" ? a <= b : op === "<" ? a < b : a === b);

/**
 * What happens after step `k` of a chain ended: stop (with why), start step k+1 now, or wait
 * until a time. A skipped step always stops the chain: the agent was off duty or over budget.
 */
export function afterStep(c: Chain, k: number, ended: Ended, now = Date.now()): { go: false; why: string } | { go: true; step: number; at: number | null } {
  const next = c.steps[k + 1];
  if (!next) return { go: false, why: "That was the last step." };
  if (ended.status === "skipped") return { go: false, why: "The step was skipped (off duty or over budget), so the chain stops." };
  const when = next.when ?? "ok";
  if (when === "ok" && ended.status !== "ok") return { go: false, why: `${next.agent} only runs when the step before worked.` };
  if (when === "failed" && ended.status !== "failed") return { go: false, why: `${next.agent} only runs when the step before failed.` };
  if (next.check) {
    const v = ended.metrics?.[next.check.metric];
    if (v === undefined) return { go: false, why: `The step before didn't report ${next.check.metric}, so the check can't pass.` };
    if (!pass(next.check.op, v, next.check.value)) return { go: false, why: `${next.check.metric} was ${v}, not ${next.check.op} ${next.check.value}.` };
  }
  const today = chicagoDate(0, new Date(now));
  if (!onDay(next.days, today)) return { go: false, why: `${next.agent} only runs on weekdays.` };
  const at = next.notBefore ? chicagoAt(today, next.notBefore) : null;
  return { go: true, step: k + 1, at: at && at > now ? at : null };
}

/**
 * Why `next` is looser than `now`: a chain that starts running on its own (turned on, or new and
 * on), or a chain that is on and gains an agent. That needs a confirm and DASHBOARD_CONTROLS=on.
 * Turning a chain off, or dropping a step, never does.
 */
export function flowLooser(now: Flow, next: Flow): string[] {
  const out: string[] = [];
  for (const c of next.chains) {
    if (!c.on) continue;
    const was = now.chains.find((x) => x.key === c.key);
    if (!was || !was.on) out.push(`${c.name} starts running on its own`);
    else {
      const added = c.steps.filter((s) => !was.steps.some((w) => w.agent === s.agent)).map((s) => s.agent);
      if (added.length) out.push(`${c.name} now also runs ${added.join(", ")}`);
      if (c.start.type !== was.start.type || JSON.stringify(c.start) !== JSON.stringify(was.start)) out.push(`${c.name} starts at a different time or on a different event`);
    }
  }
  return out;
}
