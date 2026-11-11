// The gateway's rules in plain code, no I/O, so they can be read in one place and tested.
// Hard rule (tech spec, CLAUDE.md): Mercury writes are only a receipt attachment, a category
// and a memo on a transaction that already exists, only for CFO and Bookkeeper, and only
// after Zak approves (Draft tier). Nothing here can create, cancel or move money.

export type Tier = "Report" | "Draft" | "Act";

export const ANNOTATE = "mercury.annotate_transaction";

/** Every write tool the gateway knows. A tool not listed here is refused. */
export const TOOLS = {
  [ANNOTATE]: {
    agents: ["bookkeeper", "cfo"],
    // Draft: every action waits for Zak. Promotion to Act is a later, data-backed decision.
    tier: "Draft" as Tier,
    fields: ["attach", "receipt_path", "category_id", "category", "note"],
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

/** Why a proposed action is refused, or null when the gateway may queue it for approval. */
export function refuseProposal(agentId: string, tool: string, target: string, args: Record<string, unknown>, memoMax = 200): string | null {
  const def = TOOLS[tool as ToolName];
  if (!def) return `Unknown write tool "${tool}".`;
  if (!(def.agents as readonly string[]).includes(agentId)) return `${agentId} may not use ${tool}.`;
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
