// Bookkeeping rules in plain code: which charges need evidence, whether a receipt
// matches a charge, and the mileage and home office math. No model decides any of it.
import { round2 } from "./coffee";

export type DocStatus = "open" | "matched" | "needs_photo" | "bank_record_only" | "personal" | "not_needed";

export interface BookPolicies {
  matchWindowDays: number;
  photoMinUsd: number;
  mixedMerchants: string[];
  bankRecordAfterDays: number;
  mileageRate: Record<string, number>;
}

export const DEFAULT_POLICIES: BookPolicies = {
  matchWindowDays: 3,
  photoMinUsd: 75,
  mixedMerchants: ["costco", "walmart", "target", "amazon", "h-e-b", "heb", "sam's club", "sams club"],
  bankRecordAfterDays: 30,
  mileageRate: { "2025": 0.7 },
};

/** Whole cents, so amounts compare exactly. */
export const cents = (usd: number) => Math.round(Math.abs(usd) * 100);

const DAY = 864e5;
export const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY);

/** Mercury transaction kinds that move money between One Two's own accounts or pay its own card: no receipt needed. */
const OWN_MONEY_KINDS = new Set(["internalTransfer", "treasuryTransfer", "creditCardCredit", "cardInternationalTransactionFee"]);
const OWN_MONEY_WORDS = /\b(mercury (io|credit)|card payment|transfer (to|from) (checking|savings|treasury))\b/i;

/** A charge needs evidence unless it only moves money between One Two's own accounts. */
export function needsEvidence(kind: string | null | undefined, merchant: string) {
  if (kind && OWN_MONEY_KINDS.has(kind)) return false;
  return !OWN_MONEY_WORDS.test(merchant);
}

const LODGING = /\b(hotel|inn|suites|marriott|hilton|hyatt|airbnb|vrbo|motel|lodg|resort)\b/i;

/** IRS-style rule from the tech spec: a photo is worth asking for at or above the threshold, for lodging, or at stores that sell personal things too. */
export function photoNeeded(amountUsd: number, merchant: string, mercuryCategory: string | null | undefined, p: BookPolicies) {
  if (Math.abs(amountUsd) >= p.photoMinUsd) return true;
  if (LODGING.test(merchant) || /lodging|hotel/i.test(mercuryCategory ?? "")) return true;
  const m = merchant.toLowerCase();
  return p.mixedMerchants.some((x) => m.includes(x));
}

const STOP = new Set(["the", "inc", "llc", "co", "com", "www", "store", "shop", "payment", "pos", "purchase", "online", "and", "of", "us", "usa", "corp", "ltd", "sq", "tst", "paypal"]);
/** Lower-case words of a merchant name, minus payment-processor noise ("SQ *", "TST*"). */
const ALIAS: Record<string, string> = { amzn: "amazon", wm: "walmart", wal: "walmart", goog: "google", msft: "microsoft", fb: "facebook" };
export const merchantWords = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).map((w) => ALIAS[w] ?? w).filter((w) => w.length >= 3 && !STOP.has(w)));

export const merchantsMatch = (a: string, b: string) => {
  const wa = merchantWords(a);
  for (const w of merchantWords(b)) if (wa.has(w)) return true;
  // "Amazon" vs "AMZN Mktp": a shared 4-letter start is enough
  for (const x of wa) for (const y of merchantWords(b)) if (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)) return true;
  return false;
};

export interface ReadReceipt { is_receipt: boolean; merchant: string | null; total_usd: number | null; date: string | null }

/**
 * Code decides the match: the receipt total equals the charge to the cent, its date is
 * within the window, and the merchant shares a word with Mercury's counterparty.
 * Returns why not, or null when it matches.
 */
export function whyNoMatch(charge: { date: string; amountUsd: number; merchant: string }, r: ReadReceipt, windowDays: number): string | null {
  if (!r.is_receipt) return "not a receipt";
  if (r.total_usd == null || cents(r.total_usd) !== cents(charge.amountUsd)) return "total differs";
  if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || daysBetween(r.date, charge.date) > windowDays) return "date outside window";
  if (!r.merchant || !merchantsMatch(r.merchant, charge.merchant)) return "merchant differs";
  return null;
}

/** "42.17" and "$42.17", the forms an amount takes in a receipt email. */
export const amountText = (usd: number) => (cents(usd) / 100).toFixed(2);

/** Business miles times the IRS standard rate for that year; null when the rate isn't in policies yet. */
export function mileageUsd(miles: number, year: number, p: BookPolicies) {
  const rate = p.mileageRate[String(year)];
  return rate == null ? null : round2(miles * rate);
}

export interface HomeOfficeInputs { officeSqft: number; homeSqft: number; costs: Record<string, number> }

/** Both IRS ways: simplified ($5 a sq ft, at most 300 sq ft) and actual (office share of the home's costs). */
export function homeOffice(h: HomeOfficeInputs) {
  const simplified = round2(Math.min(Math.max(h.officeSqft, 0), 300) * 5);
  const share = h.homeSqft > 0 ? Math.min(h.officeSqft / h.homeSqft, 1) : 0;
  const total = Object.values(h.costs).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  return { simplified, actual: round2(total * share), sharePct: round2(share * 100) };
}

/** Share of charges that need evidence and have it (a receipt, or a reason none is needed). */
export function coverage(statuses: DocStatus[]) {
  const counted = statuses.filter((s) => s !== "not_needed" && s !== "personal");
  if (!counted.length) return null;
  const covered = counted.filter((s) => s === "matched" || s === "bank_record_only").length;
  return round2((covered / counted.length) * 100);
}
