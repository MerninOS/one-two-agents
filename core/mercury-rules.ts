// Reading Mercury's MCP replies (docs/mcp-everywhere.md, slice 5). Pure: no network, so
// `npm run check:mcp` can test it. Every amount is taken from the raw reply as a number and added
// up in code; a row without an id or a finite amount is dropped, never guessed.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, max = 200): string | null => (typeof x === "string" && x.trim() ? x.replace(/\s+/g, " ").trim().slice(0, max) : null);
const fin = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);

export const MERCURY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MercuryAccount { id: string; availableBalance: number; status: string; kind: string | null; isCredit: boolean }

/** The accounts in a getAccounts reply. */
export function readAccounts(payload: unknown): MercuryAccount[] {
  return arr(obj(payload).accounts).flatMap((x) => {
    const a = obj(x);
    const id = str(a.id, 60), bal = fin(a.availableBalance);
    if (!id || bal == null) return [];
    return [{ id, availableBalance: bal, status: str(a.status, 30) ?? "", kind: str(a.kind, 30), isCredit: a.isCredit === true }];
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cash across the accounts the business picked on Settings ("all": every open account that isn't credit).
 * Throws when a named account isn't there, so a missing account never reads as $0.
 */
export function cashOf(accounts: readonly MercuryAccount[], ids: readonly string[]): number {
  const all = ids.length === 1 && ids[0].toLowerCase() === "all";
  const ours = all
    ? accounts.filter((a) => a.status !== "archived" && a.status !== "deleted" && !a.isCredit && a.kind !== "creditCard")
    : accounts.filter((a) => ids.includes(a.id));
  if (!all && ours.length !== ids.length) throw new Error("Mercury: an account picked on Settings was not found");
  return r2(ours.reduce((s, a) => s + a.availableBalance, 0));
}

export interface MercuryTxn {
  id: string;
  accountId?: string;
  amount: number;                 // negative = money out
  status: string;                 // pending | sent | cancelled | failed | reversed | blocked
  kind?: string;
  postedAt?: string | null;
  createdAt?: string;
  counterpartyName?: string | null;
  counterpartyNickname?: string | null;
  bankDescription?: string | null;
  note?: string | null;
  mercuryCategory?: string | null;
  categoryData?: { id: string; name: string } | null;
  attachments?: { fileName?: string; attachmentType?: string }[];
}

/** One transaction, checked. Null without an id or a finite amount. */
export function readTxn(x: unknown): MercuryTxn | null {
  const t = obj(x);
  const id = str(t.id, 60), amount = fin(t.amount);
  if (!id || amount == null) return null;
  const cat = obj(t.categoryData);
  return {
    id, amount, status: str(t.status, 30) ?? "",
    accountId: str(t.accountId, 60) ?? undefined, kind: str(t.kind, 60) ?? undefined,
    postedAt: str(t.postedAt, 40), createdAt: str(t.createdAt, 40) ?? undefined,
    counterpartyName: str(t.counterpartyName), counterpartyNickname: str(t.counterpartyNickname),
    bankDescription: str(t.bankDescription, 300), note: str(t.note, 500), mercuryCategory: str(t.mercuryCategory, 80),
    categoryData: str(cat.id, 60) && str(cat.name) ? { id: str(cat.id, 60)!, name: str(cat.name)! } : null,
    attachments: arr(t.attachments).map((a) => ({ fileName: str(obj(a).fileName) ?? undefined, attachmentType: str(obj(a).attachmentType, 40) ?? undefined })),
  };
}

/** A getTransactionById reply: the transaction itself, or wrapped in `transaction`. */
export const readOneTxn = (payload: unknown): MercuryTxn | null => readTxn(obj(payload).transaction ?? payload);

export interface TxnPage {
  transactions: MercuryTxn[];
  next: string | null;
  /** Set when the server cut the page: ask again with this limit, from the same place. */
  truncatedAt: number | null;
  /** The server dropped the date filter because it matched nothing: these rows are not for the asked dates. */
  datesDropped: boolean;
}

/** A listTransactions reply. */
export function readTxnPage(payload: unknown): TxnPage {
  const p = obj(payload);
  const next = str(obj(p.page).nextPage, 60);
  const cut = fin(p.truncatedAt), total = fin(p.totalFetched);
  return {
    transactions: arr(p.transactions).map(readTxn).filter((t): t is MercuryTxn => !!t),
    next: next && MERCURY_UUID.test(next) ? next : null,
    truncatedAt: cut != null && cut >= 1 && (total == null || cut < total) ? Math.floor(cut) : null,
    datesDropped: p._retryNote !== undefined && p._retryNote !== null,
  };
}

export interface MercuryCategory { id: string; name: string }

/** A listCategories reply. */
export function readCategories(payload: unknown): { categories: MercuryCategory[]; next: string | null } {
  const p = obj(payload);
  const next = str(obj(p.page).nextPage, 60);
  return {
    categories: arr(p.categories).flatMap((x) => { const c = obj(x); const id = str(c.id, 60), name = str(c.name); return id && name ? [{ id, name }] : []; }),
    next: next && MERCURY_UUID.test(next) ? next : null,
  };
}

/** The organization's name from getOrganization, to show which org was signed in (never the EIN). */
export function readOrgName(payload: unknown): string | null {
  const o = obj(obj(payload).organization ?? payload);
  const dbas = arr(o.dbas).map((d) => str(d) ?? str(obj(d).name)).filter(Boolean);
  return str(o.legalBusinessName) ?? str(o.name) ?? (dbas[0] as string | undefined) ?? null;
}

// ---- Receipt files (docs/mcp-everywhere.md, slice 8): the gateway's receipt token lives in the
// vault, and our own small server attaches one file to the charge an approver approved.

/** Mercury's API tokens ("secret-token:mercury_production_…"). */
export const looksLikeMercuryToken = (k: string) => /^secret-token:mercury_[A-Za-z0-9_$.-]{20,300}$/.test(k);

export const RECEIPT_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "text/plain"] as const;
const RECEIPT_MAX_BYTES = 10_000_000;

/** The checked inputs of mercury_attach_receipt, or why not. */
export function checkReceiptArgs(raw: unknown): { transactionId: string; name: string; type: string; bytes: Buffer } | { problem: string } {
  const a = obj(raw);
  if (typeof a.transactionId !== "string" || !MERCURY_UUID.test(a.transactionId)) return { problem: "transactionId must be a Mercury transaction id" };
  if (typeof a.name !== "string" || !/^receipt\.[a-z0-9]{2,5}$/.test(a.name)) return { problem: "name must be receipt.<ext>" };
  if (typeof a.type !== "string" || !(RECEIPT_MIME as readonly string[]).includes(a.type)) return { problem: "type must be a PDF, an image or plain text" };
  if (typeof a.base64 !== "string" || !a.base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(a.base64)) return { problem: "base64 must be the file" };
  const bytes = Buffer.from(a.base64, "base64");
  if (!bytes.length || bytes.length > RECEIPT_MAX_BYTES) return { problem: "the file must be 1 byte to 10 MB" };
  return { transactionId: a.transactionId, name: a.name, type: a.type, bytes };
}
