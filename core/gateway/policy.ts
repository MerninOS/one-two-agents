// The gateway's rules in plain code, no I/O, so they can be read in one place and tested.
// Hard rule (tech spec, CLAUDE.md): Mercury writes are only a receipt attachment, a category
// and a memo on a transaction that already exists, only for CFO and Bookkeeper, and only
// after Zak approves (Draft tier). Nothing here can create, cancel or move money.

export type Tier = "Report" | "Draft" | "Act";

export const ANNOTATE = "mercury.annotate_transaction";
/**
 * A plain-text draft in One Two's Gmail, to a lead on the leads list (slice 7). Zak still sends
 * it himself from Gmail. The recipient is never in the proposal: the gateway reads it from the
 * lead's row when it makes the draft. A first email to someone is always Draft and never promoted.
 */
export const DRAFT_EMAIL = "gmail.create_draft";

/** Every write tool the gateway knows. A tool not listed here is refused. */
export const TOOLS = {
  [ANNOTATE]: {
    agents: ["bookkeeper", "cfo"],
    // Draft: every action waits for Zak. Promotion to Act is a later, data-backed decision.
    tier: "Draft" as Tier,
    fields: ["attach", "receipt_path", "category_id", "category", "note"],
    promotable: true,
  },
  [DRAFT_EMAIL]: {
    agents: ["wholesale_hunter"],
    tier: "Draft" as Tier,
    fields: ["subject", "body"],
    // first contact with a person who has never heard from One Two: Draft for good (CLAUDE.md)
    promotable: false,
  },
} as const;
export type ToolName = keyof typeof TOOLS;

export interface AnnotateArgs {
  attach?: boolean;
  /** Object in the private receipts bucket; must sit under this transaction's own folder. */
  receipt_path?: string;
  category_id?: string;
  /** The category's name, for the preview only; the id is what is written. */
  category?: string;
  note?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECEIPT_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", heic: "image/heic", webp: "image/webp", txt: "text/plain" };
export const MAX_RECEIPT_BYTES = 10_000_000;

export const receiptPathOk = (target: string, path: string) => {
  const m = /^(\d{4})\/([^/]+)\/receipt\.([a-z]+)$/.exec(path);
  return !!m && m[2] === target && m[3] in RECEIPT_TYPES;
};

export interface DraftArgs { subject: string; body: string }
export const DRAFT_LIMITS = { subject: 150, body: 1500 };

/** Why a Gmail draft's text is refused: one-line subject, plain body, no links, no control characters. */
export function refuseDraft(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(TOOLS[DRAFT_EMAIL].fields as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A draft holds only a subject and a body; the recipient comes from the leads list.`;
  const { subject, body } = args as Partial<DraftArgs>;
  if (typeof subject !== "string" || !subject.trim()) return "The draft needs a subject.";
  if (subject.length > DRAFT_LIMITS.subject) return `The subject is longer than ${DRAFT_LIMITS.subject} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(subject)) return "The subject must be one line of plain text.";
  if (typeof body !== "string" || !body.trim()) return "The draft needs a body.";
  if (body.length > DRAFT_LIMITS.body) return `The body is longer than ${DRAFT_LIMITS.body} characters.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(body)) return "The body may not hold control characters.";
  if (/https?:\/\/|www\./i.test(subject + body)) return "A draft may not hold links: a web page could have put them there.";
  return null;
}

/** Whether One Two may draft an email to this lead: an address on the row, not suppressed, not a lead Zak closed. */
export function refuseDraftTo(lead: { email: string | null; stage: string } | null, suppressed: Set<string>): string | null {
  if (!lead) return "That lead isn't on the leads list.";
  const to = (lead.email ?? "").trim().toLowerCase();
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(to)) return "That lead has no email address on the leads list.";
  if (suppressed.has(to)) return `${to} asked not to be emailed.`;
  if (lead.stage === "lost" || lead.stage === "skip") return `That lead is marked ${lead.stage}.`;
  return null;
}

/** Why a proposed action is refused, or null when the gateway may queue it for approval. */
export function refuseProposal(agentId: string, tool: string, target: string, args: Record<string, unknown>, memoMax = 200): string | null {
  const def = TOOLS[tool as ToolName];
  if (!def) return `Unknown write tool "${tool}".`;
  if (!(def.agents as readonly string[]).includes(agentId)) return `${agentId} may not use ${tool}.`;
  if (tool === DRAFT_EMAIL) return UUID.test(target) ? refuseDraft(args) : "The target is not a lead on the leads list.";
  if (!UUID.test(target)) return "The target is not a Mercury transaction id.";
  const extra = Object.keys(args).filter((k) => !(def.fields as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. Only receipt, category and memo can be written.`;
  const a = args as AnnotateArgs;
  if (a.attach !== undefined && typeof a.attach !== "boolean") return "attach must be true or false.";
  if (a.attach && !(typeof a.receipt_path === "string" && receiptPathOk(target, a.receipt_path))) return "The receipt file must be this transaction's own file in the receipts bucket.";
  if (a.category_id !== undefined && !(typeof a.category_id === "string" && UUID.test(a.category_id))) return "category_id must be a Mercury category id.";
  if (a.note !== undefined) {
    if (typeof a.note !== "string" || !a.note.trim()) return "The memo must be text.";
    if (a.note.length > memoMax) return `The memo is longer than ${memoMax} characters.`;
    if (/[\u0000-\u001f]|https?:\/\//i.test(a.note)) return "The memo may not hold links or control characters.";
  }
  if (!a.attach && !a.category_id && !a.note) return "Nothing to write.";
  return null;
}

/** What Mercury shows for the transaction right now, as the gateway re-checks it. */
export interface LiveTxn {
  status: string;
  amount: number;
  note?: string | null;
  categoryData?: { id: string } | null;
  attachments?: unknown[];
}

export interface Plan {
  attach: boolean;
  categoryId?: string;
  note?: string;
  /** Fields left alone, and why. */
  skipped: string[];
}

/**
 * Decides at execution time what may still be written, against Mercury's live state.
 * Refuses (returns a string) when the transaction isn't the one that was approved.
 * Never replaces what is already there: a category or memo someone set, or an attachment.
 */
export function planWrite(args: AnnotateArgs, live: LiveTxn | null, expect: { amountUsd: number; status: string }, categoryIds: Set<string>): Plan | string {
  if (!live) return "Mercury doesn't know this transaction any more.";
  if (live.status !== "sent") return `The transaction is ${live.status}, not settled.`;
  if (!(live.amount < 0) || Math.round(Math.abs(live.amount) * 100) !== Math.round(expect.amountUsd * 100)) return "The amount in Mercury no longer matches what was approved.";
  if (expect.status === "personal" || expect.status === "not_needed") return `The charge is marked ${expect.status.replace("_", " ")}.`;
  const plan: Plan = { attach: false, skipped: [] };
  if (args.attach) {
    if (live.attachments?.length) plan.skipped.push("receipt: Mercury already has an attachment");
    else plan.attach = true;
  }
  if (args.category_id) {
    if (live.categoryData?.id) plan.skipped.push("category: already set in Mercury, never changed by an agent");
    else if (!categoryIds.has(args.category_id)) plan.skipped.push("category: not in Mercury's category list any more");
    else plan.categoryId = args.category_id;
  }
  if (args.note) {
    if (live.note?.trim()) plan.skipped.push("memo: Mercury already has a note, left as it is");
    else plan.note = args.note;
  }
  return plan;
}

export const planIsEmpty = (p: Plan) => !p.attach && !p.categoryId && !p.note;

// ---- Caps (CLAUDE.md: money, email and undo limits). Zak's values live in `policies`; each has
// a limit in code that no row can pass. "looser" says which way is riskier: a bigger purchase
// cap, more emails, or a shorter undo window. Tightening is always allowed.

export type CapKey = "max_purchase_usd" | "max_monthly_spend_usd" | "max_emails_per_day" | "undo_window_minutes";
export interface CapDef {
  label: string;
  /** Zak's starting value (Nov 11), used when the row is missing or unreadable. */
  start: number;
  /** The riskier direction. */
  looser: "up" | "down";
  /** The furthest a row may go in the looser direction: a ceiling for "up", a floor for "down". */
  limit: number;
  /** The furthest in the safe direction (0 means "nothing allowed"). */
  safest: number;
  unit: "usd" | "count" | "minutes";
  about: string;
}
export const CAPS: Record<CapKey, CapDef> = {
  max_purchase_usd: { label: "Per purchase", start: 500, looser: "up", limit: 500, safest: 0, unit: "usd", about: "The most any one payment may be. Payments go only to vendors you added." },
  max_monthly_spend_usd: { label: "Per calendar month", start: 1500, looser: "up", limit: 1500, safest: 0, unit: "usd", about: "All agents together, Chicago calendar month, counted from applied payments." },
  max_emails_per_day: { label: "Emails per day", start: 20, looser: "up", limit: 20, safest: 0, unit: "count", about: "Outbound emails from all agents together, Chicago day. Briefs and alerts to you don’t count." },
  undo_window_minutes: { label: "Undo window", start: 30, looser: "down", limit: 30, safest: 240, unit: "minutes", about: "How long you can undo an action at the middle trust level before it goes out." },
};
export const CAP_KEYS = Object.keys(CAPS) as CapKey[];

/** The value code enforces: the policy row, held inside the code limit; the start value when the row is missing or bad. */
export function effectiveCap(key: CapKey, raw: unknown): number {
  const d = CAPS[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return d.start;
  const lo = Math.min(d.limit, d.safest), hi = Math.max(d.limit, d.safest);
  return Math.min(hi, Math.max(lo, n));
}

export const fmtCap = (key: CapKey, v: number) => (CAPS[key].unit === "usd" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : CAPS[key].unit === "minutes" ? `${v} minutes` : `${v}`);

/** Why a new value for a cap can't be saved, or whether it is looser (a confirm and DASHBOARD_CONTROLS=on). */
export function capChange(key: string, now: number, next: number): { refuse: string } | { looser: boolean } {
  const d = CAPS[key as CapKey];
  if (!d) return { refuse: `Unknown cap ${key}.` };
  const k = key as CapKey;
  if (!Number.isFinite(next) || next < 0) return { refuse: "Pick a number of zero or more." };
  if (d.unit !== "usd" && !Number.isInteger(next)) return { refuse: "Pick a whole number." };
  if (d.unit === "usd" && Math.abs(Math.round(next * 100) - next * 100) > 1e-6) return { refuse: "Whole cents only." };
  if (d.looser === "up" && next > d.limit) return { refuse: `${d.label} can’t go above ${fmtCap(k, d.limit)}. That ceiling is in code (core/gateway/policy.ts).` };
  if (d.looser === "down" && next < d.limit) return { refuse: `${d.label} can’t go below ${fmtCap(k, d.limit)}. That floor is in code (core/gateway/policy.ts).` };
  if (d.looser === "down" && next > d.safest) return { refuse: `${d.label} can be at most ${fmtCap(k, d.safest)}.` };
  if (next === now) return { refuse: "That is already the value." };
  return { looser: d.looser === "up" ? next > now : next < now };
}

export interface Vendor { id: string; name: string; mercury_recipient_id: string | null }

/**
 * Whether a payment may be proposed. Refuses when the payee isn't in vendors, the amount is
 * over the per-purchase cap, or this month plus the amount is over the monthly cap. A first
 * payment to a vendor is flagged so it always waits for Zak (never promoted). Amounts are cents
 * in code; the payee comes from vendors, never from a web page, an email or model text.
 * A refusal is a cap breach: the caller passes it to onBreach (core/gateway/index.ts).
 */
export function checkPurchase(p: { amountUsd: number; vendorId: string; vendors: Vendor[]; monthSpentUsd: number; paidVendorIds: Set<string>; maxPurchaseUsd: number; maxMonthlyUsd: number }): { ok: false; reason: string } | { ok: true; firstPayment: boolean } {
  const cents = Math.round(p.amountUsd * 100);
  if (!Number.isFinite(p.amountUsd) || cents <= 0) return { ok: false, reason: "The amount must be more than $0." };
  const v = p.vendors.find((x) => x.id === p.vendorId);
  if (!v) return { ok: false, reason: "The payee isn’t on your vendors list." };
  if (!v.mercury_recipient_id) return { ok: false, reason: `${v.name} has no Mercury recipient yet.` };
  if (cents > Math.round(p.maxPurchaseUsd * 100)) return { ok: false, reason: `$${(cents / 100).toFixed(2)} is over the per-purchase cap of $${p.maxPurchaseUsd.toFixed(2)}.` };
  const month = Math.round(p.monthSpentUsd * 100) + cents;
  if (month > Math.round(p.maxMonthlyUsd * 100)) return { ok: false, reason: `This would make $${(month / 100).toFixed(2)} this month, over the monthly cap of $${p.maxMonthlyUsd.toFixed(2)}.` };
  return { ok: true, firstPayment: !p.paidVendorIds.has(v.id) };
}

/**
 * Whether an email may be proposed: never to a suppressed address, never past today's company
 * cap, and for an agent seated in a department, never past that department's cap (held at or
 * under the company cap: core/org-rules.ts deptEmailCap).
 */
export function checkEmail(p: { to: string; suppressed: Set<string>; sentToday: number; maxPerDay: number; dept?: { name: string; sentToday: number; maxPerDay: number } | null }): { ok: false; reason: string } | { ok: true } {
  const to = p.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, reason: "That isn’t an email address." };
  if (p.suppressed.has(to)) return { ok: false, reason: `${to} asked not to be emailed.` };
  if (p.sentToday >= p.maxPerDay) return { ok: false, reason: `Today’s email cap (${p.maxPerDay}) is used up.` };
  const d = p.dept;
  if (d && d.sentToday >= Math.min(d.maxPerDay, p.maxPerDay)) return { ok: false, reason: `${d.name}’s email cap for today (${Math.min(d.maxPerDay, p.maxPerDay)}) is used up.` };
  return { ok: true };
}
