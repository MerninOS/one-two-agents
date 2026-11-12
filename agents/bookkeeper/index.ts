import "server-only";
// Bookkeeper (Quinn): one expense_docs row per business charge in Mercury, the receipt
// that backs it (already in Mercury, or found in Gmail), a category suggestion, and a
// short list of charges that need a photo. On the 3rd it also closes last month.
//
// Quinn never writes to Mercury: a receipt, category or memo is stored on the row as a
// proposal and handed to the tool gateway (core/gateway), which applies it only after Zak
// approves it in the Control Room.
// Emails are untrusted: Haiku only reads fields off them, code decides every match.
import { db } from "@/core/db";
import { loadMemory, loadWords, type MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import { outputOn, setupOrDefaults, setupWords, type Setup, type StepChoice } from "@/core/setup";
import { TZ, chicagoDate, dayTitle } from "@/core/time";
import {
  DEFAULT_POLICIES, amountText, coverage, mileageUsd, needsEvidence, photoNeeded, whyNoMatch,
  type BookPolicies, type DocStatus, type ReadReceipt,
} from "@/domain/books";
import { round2 } from "@/domain/coffee";
import { claude, costUsd, inputTokens, isModel, type Anthropic } from "@/integrations/anthropic";
import { GmailReader, hasGmailRead, type Mail } from "@/integrations/gmail-read";
import { hasMercury, mercuryCategories, mercuryTransactions, type MercuryCategory, type MercuryTxn } from "@/integrations/mercury";
import { divider, h2, h3, li, notionPage, p as para, type Block } from "@/integrations/notion";
import { env } from "@/core/env";
import { queueBookkeeperProposals } from "@/core/gateway";
import { CANDIDATES, LOOKBACK_DAYS, MAX_SEARCHES, MAX_SEARCHES_PER_CHARGE, MENU } from "./menu";
import { PICK_CATEGORY, READ_RECEIPT } from "./prompt";

/** Limits in code; the setup picks at or under each (menu.ts). Gmail searches per run, newest charges first, and per charge over its life. */
export { CANDIDATES, LOOKBACK_DAYS, MAX_SEARCHES, MAX_SEARCHES_PER_CHARGE };
export const MAX_PDF_BYTES = 3_000_000;
const OPEN: DocStatus[] = ["open", "needs_photo", "bank_record_only"];

interface Doc {
  id?: string;
  mercury_txn_id: string;
  account_id: string | null;
  date: string;
  merchant: string;
  amount_usd: number;
  mercury_kind: string | null;
  mercury_category: string | null;
  category_id: string | null;
  category: string | null;
  status: DocStatus;
  status_note: string | null;
  receipt_path: string | null;
  source: string | null;
  gmail_message_id: string | null;
  receipt_json: ReadReceipt | null;
  matched_at: string | null;
  photo_asked_at: string | null;
  search_count: number;
  last_searched_at: string | null;
  proposal_category_id: string | null;
  proposal_category: string | null;
  proposal_memo: string | null;
  proposal_attach: boolean;
  proposal_status: string | null;
}
const COLS = "id, mercury_txn_id, account_id, date, merchant, amount_usd, mercury_kind, mercury_category, category_id, category, status, status_note, receipt_path, source, gmail_message_id, receipt_json, matched_at, photo_asked_at, search_count, last_searched_at, proposal_category_id, proposal_category, proposal_memo, proposal_attach, proposal_status";

const usage = () => ({ in: 0, out: 0, cost: 0 });
type Usage = ReturnType<typeof usage>;

const chicagoDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const gmailDate = (ymd: string, shiftDays: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + shiftDays * 864e5).toISOString().slice(0, 10).replace(/-/g, "/");
const merchantOf = (t: MercuryTxn) => (t.counterpartyName || t.counterpartyNickname || t.bankDescription || "Unknown").trim().slice(0, 200);
const usd = (n: number) => `$${n.toFixed(2)}`;

async function policies(): Promise<BookPolicies> {
  const { data } = await db().from("policies").select("key, value_json")
    .in("key", ["receipt_match_window_days", "receipt_photo_min_usd", "receipt_mixed_merchants", "bank_record_after_days", "irs_mileage_rate"]);
  const v = Object.fromEntries((data ?? []).map((r) => [r.key, r.value_json]));
  const num = (x: unknown, d: number) => (Number.isFinite(Number(x)) && x !== null ? Number(x) : d);
  return {
    matchWindowDays: num(v.receipt_match_window_days, DEFAULT_POLICIES.matchWindowDays),
    photoMinUsd: num(v.receipt_photo_min_usd, DEFAULT_POLICIES.photoMinUsd),
    mixedMerchants: Array.isArray(v.receipt_mixed_merchants) ? v.receipt_mixed_merchants.map((s: unknown) => String(s).toLowerCase()) : DEFAULT_POLICIES.mixedMerchants,
    bankRecordAfterDays: num(v.bank_record_after_days, DEFAULT_POLICIES.bankRecordAfterDays),
    mileageRate: v.irs_mileage_rate && typeof v.irs_mileage_rate === "object" ? v.irs_mileage_rate : DEFAULT_POLICIES.mileageRate,
  };
}

/** A new row for a Mercury charge, with the status code can decide without looking for a receipt. */
function newDoc(t: MercuryTxn): Doc {
  const merchant = merchantOf(t);
  const evidence = needsEvidence(t.kind, merchant);
  const inMercury = !!t.attachments?.length;
  return {
    mercury_txn_id: t.id, account_id: t.accountId ?? null, date: chicagoDay(t.postedAt!), merchant,
    amount_usd: round2(Math.abs(t.amount)), mercury_kind: t.kind ?? null, mercury_category: t.mercuryCategory ?? null,
    category_id: t.categoryData?.id ?? null, category: t.categoryData?.name ?? null,
    status: !evidence ? "not_needed" : inMercury ? "matched" : "open",
    status_note: !evidence ? "Moves money between One Two's own accounts" : null,
    receipt_path: null, source: inMercury ? "mercury" : null, gmail_message_id: null, receipt_json: null,
    matched_at: inMercury ? new Date().toISOString() : null, photo_asked_at: null, search_count: 0, last_searched_at: null,
    proposal_category_id: null, proposal_category: null, proposal_memo: null, proposal_attach: false, proposal_status: null,
  };
}

// ---- Reading receipts (Haiku extracts, code decides)

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    merchant: { type: ["string", "null"] },
    total_usd: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
  },
  required: ["is_receipt", "merchant", "total_usd", "date"],
  additionalProperties: false,
};

async function structured<T>(step: StepChoice, system: string, content: Anthropic.ContentBlockParam[], schema: Record<string, unknown>, u: Usage, maxTokens = 1024): Promise<T | null> {
  const res = await claude().messages.create({
    model: step.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: step.effort, format: { type: "json_schema", schema } },
  });
  const tin = inputTokens(res.usage), tout = res.usage.output_tokens;
  u.in += tin; u.out += tout;
  // the two steps can use different models, so cost is added up per call
  u.cost += costUsd(step.model, tin, tout);
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try { return JSON.parse(text.text) as T; } catch { return null; }
}

async function readReceipt(gmail: GmailReader, mail: Mail, u: Usage, step: StepChoice): Promise<ReadReceipt | null> {
  const content: Anthropic.ContentBlockParam[] = [];
  const pdf = mail.attachments.find((a) => a.mimeType === "application/pdf" && a.size > 0 && a.size <= MAX_PDF_BYTES);
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: (await gmail.attachment(mail.id, pdf.id)).toString("base64") } });
  content.push({ type: "text", text: `<email>\nFrom: ${mail.from}\nSubject: ${mail.subject}\nDate: ${mail.date}\n\n${mail.text}\n</email>` });
  return structured<ReadReceipt>(step, READ_RECEIPT, content, RECEIPT_SCHEMA, u, 512);
}

/** Saves the receipt for a charge in the private bucket: the PDF or image if there is one, else the email as text. */
async function saveReceipt(gmail: GmailReader, doc: Doc, mail: Mail) {
  const file = mail.attachments.find((a) => /^(application\/pdf|image\/(png|jpe?g|heic|webp))$/.test(a.mimeType));
  const year = doc.date.slice(0, 4);
  // The path comes from Mercury's id and our own extension, never from the email.
  const ext = file ? ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/heic": "heic", "image/webp": "webp" } as Record<string, string>)[file.mimeType] : "txt";
  const path = `${year}/${doc.mercury_txn_id}/receipt.${ext}`;
  const body = file ? await gmail.attachment(mail.id, file.id) : Buffer.from(`From: ${mail.from}\nSubject: ${mail.subject}\nDate: ${mail.date}\nGmail message: ${mail.id}\n\n${mail.text}`, "utf8");
  const { error } = await db().storage.from("receipts").upload(path, body, { contentType: file?.mimeType ?? "text/plain; charset=utf-8", upsert: true });
  if (error) throw new Error(`Could not save receipt for ${doc.merchant}: ${error.message}`);
  return path;
}

interface Found { mail: Mail; read: ReadReceipt }

async function findReceipt(gmail: GmailReader, doc: Doc, p: BookPolicies, u: Usage, step: StepChoice): Promise<Found | null> {
  const a = amountText(doc.amount_usd);
  const withComma = Number(a) >= 1000 ? Number(a).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : a;
  const amount = withComma === a ? `"${a}"` : `("${a}" OR "${withComma}")`;
  const q = `${amount} after:${gmailDate(doc.date, -p.matchWindowDays - 1)} before:${gmailDate(doc.date, p.matchWindowDays + 1)}`;
  for (const id of await gmail.search(q, CANDIDATES)) {
    const mail = await gmail.read(id);
    const read = await readReceipt(gmail, mail, u, step);
    if (read && whyNoMatch({ date: doc.date, amountUsd: doc.amount_usd, merchant: doc.merchant }, read, p.matchWindowDays) === null) return { mail, read };
  }
  return null;
}

// ---- Category suggestions (from Mercury's own list only)

async function suggestCategories(docs: Doc[], cats: MercuryCategory[], u: Usage, memory: MemoryLoad | null, step: StepChoice) {
  if (!docs.length || !cats.length) return new Map<string, MercuryCategory>();
  const ids = cats.map((c) => c.id);
  const schema = {
    type: "object",
    properties: {
      picks: { type: "array", items: { type: "object", properties: { ref: { type: "integer" }, category_id: { anyOf: [{ type: "string", enum: ids }, { type: "null" }] } }, required: ["ref", "category_id"], additionalProperties: false } },
    },
    required: ["picks"],
    additionalProperties: false,
  };
  const list = docs.map((d, i) => ({ ref: i, merchant: d.merchant, amount_usd: d.amount_usd, merchant_type: d.mercury_category }));
  // Zak's notes and lessons (e.g. "Costco is packaging supplies") help pick; Mercury's list still decides what is allowed
  const out = await structured<{ picks: { ref: number; category_id: string | null }[] }>(step, memory?.block ? `${PICK_CATEGORY}\n\n${memory.block}` : PICK_CATEGORY,
    [{ type: "text", text: `Allowed categories:\n${JSON.stringify(cats.map((c) => ({ id: c.id, name: c.name })))}\n\nCharges:\n${JSON.stringify(list)}` }], schema, u, 4096);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const picks = new Map<string, MercuryCategory>();
  for (const x of out?.picks ?? []) {
    const d = docs[x.ref], c = x.category_id ? byId.get(x.category_id) : undefined;
    if (d && c) picks.set(d.mercury_txn_id, c); // anything not on Mercury's list is dropped here
  }
  return picks;
}

// ---- Monthly close (numbers in code)

async function closeMonth(today: string, p: BookPolicies) {
  const first = `${today.slice(0, 7)}-01`;
  const prev = new Date(Date.parse(`${first}T12:00:00Z`) - 5 * 864e5).toISOString().slice(0, 7);
  const [{ data: docs, error }, { data: trips }] = await Promise.all([
    db().from("expense_docs").select("status, amount_usd, category_id, proposal_category_id, merchant, date").gte("date", `${prev}-01`).lt("date", first),
    db().from("trips").select("miles").gte("date", `${prev}-01`).lt("date", first),
  ]);
  if (error) throw new Error(`Could not read expense_docs: ${error.message}`);
  const rows = (docs ?? []) as { status: DocStatus; amount_usd: number; category_id: string | null; proposal_category_id: string | null; merchant: string; date: string }[];
  const counted = rows.filter((r) => r.status !== "not_needed");
  const spend = round2(counted.reduce((s, r) => s + Number(r.amount_usd), 0));
  const cov = coverage(rows.map((r) => r.status));
  const photos = rows.filter((r) => r.status === "needs_photo");
  const uncategorized = counted.filter((r) => r.status !== "personal" && !r.category_id);
  const miles = round2((trips ?? []).reduce((s, t) => s + Number(t.miles), 0));
  const mileage = mileageUsd(miles, Number(prev.slice(0, 4)), p);
  const label = new Date(`${prev}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const blocks: Block[] = [
    h2(`${label} close`),
    li(`${counted.length} business charges, ${usd(spend)} out`),
    li(`Receipt coverage: ${cov == null ? "n/a" : `${cov}%`} (target 95%)`),
    li(`Waiting on a photo: ${photos.length}`),
    li(`No category yet: ${uncategorized.length} (${uncategorized.filter((r) => r.proposal_category_id).length} with a suggestion waiting for you)`),
    li(`Miles logged: ${miles}${mileage == null ? (miles ? " (no IRS rate for this year in policies yet)" : "") : `, ${usd(mileage)} at the IRS rate`}`),
    ...(photos.length ? [h3("Still need a photo"), ...photos.slice(0, 40).map((r) => li(`${r.date} · ${r.merchant} · ${usd(Number(r.amount_usd))}`))] : []),
    divider(),
    para("Record keeping, not tax advice. Numbers are computed in code from expense_docs and trips."),
  ];
  return { label, blocks, summary: `${label} close: ${counted.length} charges, coverage ${cov == null ? "n/a" : `${cov}%`}` };
}

// ---- The run

export async function runBookkeeper(runId?: string, opts: { dryRun?: boolean; memory?: MemoryLoad | null; setup?: Setup | null } = {}): Promise<RunResult> {
  if (!hasMercury()) throw new Error("MERCURY_API_TOKEN must be set (business org, read-only)");
  // a real run gets its setup from withRun; a dry run reads it here. A setup that can't be read falls back to the menu.
  let setup = opts.setup ?? null, setupNote = "";
  if (!setup) { const got = await setupOrDefaults(MENU); setup = got.setup; if (got.problem) setupNote = ` (setup not read: ${got.problem}; built-in values used)`; }
  const readStep: StepChoice = { model: setup.model, effort: setup.effort, fallback: null };
  const pickStep: StepChoice = setup.more.pick_category ?? { model: MENU.steps[1].model, effort: MENU.steps[1].effort, fallback: null };
  for (const m of [readStep.model, pickStep.model]) if (!isModel(m)) throw new Error(`No price for ${m} in integrations/models.ts, so its cost can't be computed`);
  // never past the limits in code, whatever the row says (the menu already refuses more)
  const num = (k: string, max: number) => Math.max(1, Math.min(max, Math.floor(setup.numbers[k] ?? max)));
  const lookback = num("lookback_days", LOOKBACK_DAYS), maxSearches = num("max_searches", MAX_SEARCHES), perCharge = num("per_charge", MAX_SEARCHES_PER_CHARGE);
  const today = chicagoDate(0);
  const start = chicagoDate(lookback);
  const [p, txns, cats, { data: existingRows, error }] = await Promise.all([
    policies(),
    mercuryTransactions(start, today),
    mercuryCategories().catch(() => [] as MercuryCategory[]),
    db().from("expense_docs").select(COLS).gte("date", chicagoDate(lookback + 2)),
  ]);
  if (error) throw new Error(`Could not read expense_docs (is the bookkeeper migration applied?): ${error.message}`);
  const existing = new Map(((existingRows ?? []) as Doc[]).map((d) => [d.mercury_txn_id, d]));
  const charges = txns.filter((t) => t.amount < 0 && t.postedAt);
  const gmailOn = !setup.readsOff.includes("gmail"), gmailReady = hasGmailRead() && gmailOn;

  const fresh: Doc[] = [];
  const touched = new Map<string, Doc>(); // existing rows that changed, by txn id
  for (const t of charges) {
    const old = existing.get(t.id);
    if (!old) { fresh.push(newDoc(t)); continue; }
    const next = { ...old };
    // a category set in Mercury (by Zak or a Mercury rule) always wins; Quinn never changes it
    if ((t.categoryData?.id ?? null) !== old.category_id) { next.category_id = t.categoryData?.id ?? null; next.category = t.categoryData?.name ?? null; }
    if (t.attachments?.length && OPEN.includes(old.status)) { next.status = "matched"; next.source = "mercury"; next.matched_at = new Date().toISOString(); next.status_note = null; }
    if (JSON.stringify(next) !== JSON.stringify(old)) touched.set(t.id, next);
  }

  if (opts.dryRun) {
    const newOpen = fresh.filter((d) => d.status === "open");
    const wouldPhoto = newOpen.filter((d) => photoNeeded(d.amount_usd, d.merchant, d.mercury_category, p)).length;
    let mem = "";
    try { mem = `; ${loadWords(await loadMemory("bookkeeper"))}`; } catch (e) { mem = `; memory not loaded (${e instanceof Error ? e.message.slice(0, 80) : e})`; }
    return {
      status: "ok",
      summary: `[dry run, nothing saved, no model] ${charges.length} charges in Mercury since ${start} (${fresh.length} new: ${fresh.filter((d) => d.status === "matched").length} with a receipt in Mercury, ${fresh.filter((d) => d.status === "not_needed").length} own-account moves, ${newOpen.length} to look for, ${wouldPhoto} of them would need a photo if no receipt turns up); ${cats.length} Mercury categories; Gmail receipt search ${gmailReady ? "set up" : gmailOn ? "not set up" : "off in the setup"}; ${setupWords(setup)}${setupNote}${mem}`,
    };
  }

  const u = usage();
  const now = new Date().toISOString();
  const all = new Map<string, Doc>([...[...existing.values()].map((d) => [d.mercury_txn_id, touched.get(d.mercury_txn_id) ?? d] as const), ...fresh.map((d) => [d.mercury_txn_id, d] as const)]);
  const change = (d: Doc) => { if (d.id) touched.set(d.mercury_txn_id, d); };
  const newlyMatched: Doc[] = [], newlyPhoto: Doc[] = [], notes: string[] = [];

  // 1. Look for receipts in Gmail, newest charges first, within the run's search budget.
  // open or waiting on a photo: up to 3 searches over its life; small charges already on the bank record: one
  const canSearch = (d: Doc) => !d.receipt_path && (d.status === "open" || d.status === "needs_photo" ? d.search_count < perCharge : d.status === "bank_record_only" && d.search_count < 1);
  const toSearch = [...all.values()].filter(canSearch)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxSearches);
  if (gmailReady && toSearch.length) {
    const gmail = await GmailReader.open();
    for (const d of toSearch) {
      d.search_count += 1; d.last_searched_at = now;
      try {
        const hit = await findReceipt(gmail, d, p, u, readStep);
        if (hit) {
          d.receipt_path = await saveReceipt(gmail, d, hit.mail);
          Object.assign(d, { status: "matched", status_note: null, source: "gmail", gmail_message_id: hit.mail.id, receipt_json: hit.read, matched_at: now, proposal_attach: true, proposal_memo: `Receipt on file (Bookkeeper, ${today})`, proposal_status: "proposed" });
          newlyMatched.push(d);
        }
      } catch (e) { notes.push(`${d.merchant} ${usd(d.amount_usd)}: ${e instanceof Error ? e.message.slice(0, 100) : e}`); }
      change(d);
    }
  }

  // 2. Status for what is still unmatched, decided in code.
  for (const d of all.values()) {
    if (d.status === "open") {
      if (photoNeeded(d.amount_usd, d.merchant, d.mercury_category, p)) { d.status = "needs_photo"; d.photo_asked_at ??= now; d.status_note = "Receipt needed: at or over the photo threshold, lodging, or a store that sells personal things too"; newlyPhoto.push(d); }
      else { d.status = "bank_record_only"; d.status_note = `Under ${usd(p.photoMinUsd)}: the bank record is enough`; }
      change(d);
    } else if (d.status === "needs_photo" && d.photo_asked_at && Date.now() - Date.parse(d.photo_asked_at) > p.bankRecordAfterDays * 864e5) {
      d.status = "bank_record_only"; d.status_note = `No receipt after ${p.bankRecordAfterDays} days; kept as bank record only`;
      change(d);
    }
  }

  // 3. Category suggestions for charges with no category in Mercury and no suggestion yet.
  const needCat = [...all.values()].filter((d) => !d.category_id && !d.proposal_category_id && d.status !== "not_needed" && d.status !== "personal").slice(0, 40);
  const picks = await suggestCategories(needCat, cats, u, opts.memory ?? null, pickStep);
  for (const d of needCat) {
    const c = picks.get(d.mercury_txn_id);
    if (!c) continue;
    d.proposal_category_id = c.id; d.proposal_category = c.name; d.proposal_status = "proposed";
    change(d);
  }

  // 4. Save. New rows are inserted, changed rows updated one by one (a few a day).
  if (fresh.length) {
    const { error: e } = await db().from("expense_docs").insert(fresh.map((d) => ({ ...d, run_id: runId ?? null })));
    if (e) throw new Error(`Could not save new charges: ${e.message}`);
  }
  for (const d of touched.values()) {
    const { id, ...rest } = d;
    const { error: e } = await db().from("expense_docs").update({ ...rest, updated_at: now }).eq("id", id!);
    if (e) throw new Error(`Could not update ${d.merchant}: ${e.message}`);
  }

  // 5. Hand every proposal to the gateway: one approval per charge in the Control Room.
  // Quinn never writes to Mercury; the gateway applies only what Zak approves.
  const gate = await queueBookkeeperProposals(runId ?? null);

  // 6. Notion: a page only when there is something to look at.
  const waiting = [...all.values()].filter((d) => d.status === "needs_photo").sort((a, b) => b.date.localeCompare(a.date));
  const proposals = [...all.values()].filter((d) => d.proposal_status === "proposed");
  const close = today.slice(8) === "03" ? await closeMonth(today, p) : null;
  let url: string | null = null;
  // the page picked in the setup, else NOTION_BOOKS_PARENT_ID; none when the output is off
  const parent = outputOn(setup, "notion") && env.notionToken ? (setup.notion?.id ?? env.notionBooksParent) : undefined;
  const notion = !!parent;
  if (notion && (newlyMatched.length || newlyPhoto.length || picks.size || close)) {
    url = await notionPage(`Books · ${dayTitle(today)}`, [
      ...(close?.blocks ?? []),
      h2(`${newlyMatched.length} receipt${newlyMatched.length === 1 ? "" : "s"} found`),
      ...(newlyMatched.length ? newlyMatched.map((d) => li(`${d.date} · ${d.merchant} · ${usd(d.amount_usd)}: attach to Mercury${d.proposal_category ? `, category ${d.proposal_category}` : ""}`)) : [para("None new today.")]),
      para(`${proposals.length} proposed Mercury change${proposals.length === 1 ? "" : "s"} wait for your approval in the Control Room (Approvals). Nothing is written to Mercury until you approve it.`),
      h2(`Receipts needed (${waiting.length})`),
      ...(waiting.length ? waiting.slice(0, 40).map((d) => li(`${d.date} · ${d.merchant} · ${usd(d.amount_usd)}`)) : [para("Nothing waiting on a photo.")]),
      ...(notes.length ? [h3("Couldn’t check"), ...notes.slice(0, 10).map((n) => li(n))] : []),
      divider(),
      para("Record keeping, not tax advice. Matches are decided in code: exact amount, date within the window, merchant name."),
    ], parent);
  }

  const covered = coverage([...all.values()].map((d) => d.status));
  return {
    status: "ok",
    summary: [
      `${charges.length} charges since ${start}, ${fresh.length} new`,
      `${newlyMatched.length} receipts found${gmailReady ? ` (${toSearch.length} searched)` : gmailOn ? " (Gmail receipt search not set up)" : " (Gmail receipt search off in the setup)"}`,
      `${waiting.length} need a photo`,
      `${picks.size} category suggestions`,
      `${gate.queued} sent for approval${gate.refused ? ` (${gate.refused} refused by the gateway)` : ""}`,
      `coverage ${covered == null ? "n/a" : `${covered}%`}`,
      ...(close ? [close.summary] : []),
      ...(notes.length ? [`${notes.length} couldn't be checked`] : []),
      ...(opts.memory ? [loadWords(opts.memory)] : []),
      setupWords(setup),
    ].join(", ") + (url ? `: ${url}` : notion ? "" : outputOn(setup, "notion") ? " (Notion not set up, no page)" : " (Notion page off in the setup)"),
    tokensIn: u.in, tokensOut: u.out,
    costUsd: Number(u.cost.toFixed(4)),
    // memory goes only to the category call, so next-run notes count down only when that call ran
    readMemory: needCat.length > 0 && cats.length > 0,
    metrics: { proposals: gate.queued, open: waiting.length },
  };
}
