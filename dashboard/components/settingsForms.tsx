"use client";
// Settings forms for the gateway: the crew-wide money and email caps (lower any time, raise with a
// confirm and DASHBOARD_CONTROLS=on, never past the limit in code), add a vendor
// (DASHBOARD_CONTROLS=on) and stop email to an address (always allowed). The server checks
// everything again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/dashboard/actions";
import type { CapDef } from "@/core/gateway/policy";
import type { CapLine } from "@/dashboard/guardrails";
import { Modal, Toast, type Confirm } from "./client";

function useAct() {
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const run = (f: () => Promise<ActionResult>, then?: () => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); if (r.ok) then?.(); router.refresh();
  });
  return { busy, run, toast: <Toast t={toast} onDone={() => setToast(null)} /> };
}

export function VendorForm({ add, controls }: { add: (f: { name: string; kind: string; mercuryRecipientId: string; contactEmail: string }) => Promise<ActionResult>; controls: boolean }) {
  const [f, setF] = useState({ name: "", kind: "importer", mercuryRecipientId: "", contactEmail: "" });
  const { busy, run, toast } = useAct();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className="input" style={{ flex: 1, minWidth: 120 }} value={f.kind} aria-label="Kind" onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="importer">Importer</option><option value="packaging">Packaging</option><option value="other">Other</option></select>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Mercury recipient id (optional for now)" value={f.mercuryRecipientId} onChange={(e) => setF({ ...f, mercuryRecipientId: e.target.value })} />
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Contact email (optional)" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
        <button className="btn dark sm" disabled={busy || !controls || !f.name.trim()} title={controls ? "Adds the payee. A first payment to it always waits for you." : "Needs DASHBOARD_CONTROLS=on"} onClick={() => run(() => add(f), () => setF({ name: "", kind: "importer", mercuryRecipientId: "", contactEmail: "" }))}>Add vendor</button>
      </div>
      {toast}
    </div>
  );
}

export function SuppressForm({ suppress }: { suppress: (email: string, reason: string) => Promise<ActionResult> }) {
  const [email, setEmail] = useState(""), [reason, setReason] = useState("");
  const { busy, run, toast } = useAct();
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Why (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <button className="btn ghost sm" disabled={busy || !email.trim()} onClick={() => run(() => suppress(email, reason), () => { setEmail(""); setReason(""); })}>Stop emails</button>
      {toast}
    </div>
  );
}

const fmtCap = (c: { unit: CapDef["unit"] }, v: number) => (c.unit === "usd" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : c.unit === "minutes" ? `${v} min` : `${v}`);

/** One crew-wide cap: what it is, what is used, and a field to change it within the limit in code. */
export function CapForm({ c, controls, save }: { c: CapLine; controls: boolean; save: (key: string, v: number, confirmed: boolean) => Promise<ActionResult> }) {
  const [v, setV] = useState(String(c.value));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { toast, busy, run } = useAct();
  const n = Number(v);
  const changed = v.trim() !== "" && Number.isFinite(n) && n !== c.value;
  const looser = changed && (c.looser === "up" ? n > c.value : n < c.value);
  const past = changed && (c.looser === "up" ? n > c.limit : n < c.limit);
  const bounds = c.looser === "up" ? `Ceiling in code: ${fmtCap(c, c.limit)}` : `Floor in code: ${fmtCap(c, c.limit)}, up to ${fmtCap(c, c.safest)}`;
  const go = (confirmed: boolean) => run(() => save(c.key, n, confirmed));
  return (
    <div className="guard-cap">
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span className="row wrap" style={{ gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>{c.missing && <span className="home-chip" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }}>Using the code default</span>}</span>
        <span className="sub">{c.about}</span>
        <span className="sub">{c.used}. {bounds}.</span>
      </div>
      <div className="row" style={{ gap: 6, flex: "none" }}>
        {c.unit === "usd" && <span className="muted">$</span>}
        <input className="input" type="number" min={0} step={c.unit === "usd" ? "0.01" : "1"} style={{ width: 96 }} value={v} aria-label={c.label} onChange={(e) => setV(e.target.value)} />
        <button className="btn dark sm" disabled={busy || !changed || past || (looser && !controls)}
          title={past ? bounds : looser && !controls ? "Raising needs DASHBOARD_CONTROLS=on" : looser ? "Needs a confirm" : "Lowering applies right away"}
          onClick={() => (looser ? setConfirm({ title: `Loosen ${c.label.toLowerCase()}?`, body: `${c.about} Every agent gets the new limit from the next check. ${bounds}.`, lines: [{ k: "Now", v: fmtCap(c, c.value) }, { k: "New", v: fmtCap(c, n) }], confirmLabel: "Save", kind: "dark" }) : go(false))}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {past && <span className="sub" style={{ color: "var(--red-ink)", flexBasis: "100%" }}>{bounds}. A pull request can change it, not this screen.</span>}
      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { setConfirm(null); go(true); }} />}
      {toast}
    </div>
  );
}

/** The business's own words, which every agent is told: its name, a line about it, the owner's name. Owners only. */
export function BusinessForm({ initial, canEdit, save }: { initial: { name: string; about: string; ownerName: string }; canEdit: boolean; save: (f: { name: string; about: string; ownerName: string }) => Promise<ActionResult> }) {
  const [f, setF] = useState(initial);
  const { busy, run, toast } = useAct();
  const changed = f.name !== initial.name || f.about !== initial.about || f.ownerName !== initial.ownerName;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 2, minWidth: 180 }} placeholder="Business name" aria-label="Business name" value={f.name} maxLength={120} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Owner’s name (optional)" aria-label="Owner’s name" value={f.ownerName} maxLength={80} disabled={!canEdit} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
      </div>
      <textarea className="input" rows={2} placeholder="One line about the business, e.g. a small bakery in Denver selling bread and cakes to cafes" aria-label="About the business" value={f.about} maxLength={300} disabled={!canEdit} onChange={(e) => setF({ ...f, about: e.target.value })} />
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn dark sm" disabled={busy || !canEdit || !changed || !f.name.trim()} title={canEdit ? "Agents get the new words from their next run" : "Owners only"} onClick={() => run(() => save(f))}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {toast}
    </div>
  );
}

type WhereKey = "ownerEmail" | "siteUrl" | "shopifyDomain" | "shopifyClientId" | "mercuryAccountIds" | "notionBriefParent" | "notionBriefsDb" | "notionLeadsParent" | "notionBooksParent";
const WHERE_FIELDS: { k: WhereKey; label: string; hint: string }[] = [
  { k: "siteUrl", label: "Website", hint: "https://example.com, named in outreach drafts" },
  { k: "shopifyDomain", label: "Shopify store", hint: "your-store.myshopify.com" },
  { k: "shopifyClientId", label: "Shopify app client id", hint: "only for a Dev Dashboard app's client secret" },
  { k: "mercuryAccountIds", label: "Mercury accounts that count as cash", hint: "all, or account ids separated by commas" },
  { k: "notionBriefParent", label: "Notion page for briefs and reports", hint: "a Notion link or page id" },
  { k: "notionBriefsDb", label: "Notion briefs database", hint: "optional: one row per morning brief" },
  { k: "notionLeadsParent", label: "Notion page for lead lists", hint: "optional: else the briefs page" },
  { k: "notionBooksParent", label: "Notion page for the books", hint: "optional: else the briefs page" },
];

/** Where things go (Settings): this business's owner email, store, accounts and Notion pages. Owners only. */
export function WhereForm({ initial, owners, canEdit, save }: { initial: Record<WhereKey, string>; owners: string[]; canEdit: boolean; save: (f: Record<WhereKey, string>) => Promise<ActionResult> }) {
  const [f, setF] = useState(initial);
  const { busy, run, toast } = useAct();
  const changed = (Object.keys(initial) as WhereKey[]).some((k) => f[k] !== initial[k]);
  const field = (k: WhereKey, label: string, hint: string, control: React.ReactNode) => (
    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }} className="ink2">
      {label}
      {control}
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
    </label>
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      {field("ownerEmail", "Owner email", "The morning brief and alerts go here. Always one of this business’s owners.",
        <select className="input" aria-label="Owner email" value={f.ownerEmail} disabled={!canEdit} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })}>
          <option value="">Nobody: no emails</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>)}
      {WHERE_FIELDS.map(({ k, label, hint }) => field(k, label, hint,
        <input className="input" aria-label={label} value={f[k]} maxLength={300} disabled={!canEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })} />))}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn dark sm" disabled={busy || !canEdit || !changed} title={canEdit ? "Agents use the new settings from their next run" : "Owners only"} onClick={() => run(() => save(f))}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {toast}
    </div>
  );
}

type CostKey = "costSource" | "costNumber";

/**
 * Daily numbers (docs/daily-numbers.md): where cost of goods, and so margin, comes from. None,
 * Shopify's unit cost, or a number in dollars from the business's own tool. Owners only.
 */
export function DailyNumbersForm({ initial, numbers, canEdit, save }: { initial: Record<CostKey, string>; numbers: { key: string; label: string }[]; canEdit: boolean; save: (f: Record<CostKey, string>) => Promise<ActionResult> }) {
  const [f, setF] = useState(initial);
  const { busy, run, toast } = useAct();
  const changed = f.costSource !== initial.costSource || (f.costSource === "own" && f.costNumber !== initial.costNumber);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }} className="ink2">
        Cost of goods comes from
        <select className="input" aria-label="Cost of goods comes from" value={f.costSource} disabled={!canEdit} onChange={(e) => setF({ ...f, costSource: e.target.value })}>
          <option value="none">Nowhere: leave cost and margin out</option>
          <option value="shopify">Shopify’s unit cost on each product</option>
          <option value="own" disabled={!numbers.length}>A number from your own tool{numbers.length ? "" : " (none in dollars yet)"}</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{f.costSource === "shopify"
          ? "Each line’s quantity times the cost on its product in Shopify today, not on the day of the order. The read-only app needs to be able to read inventory."
          : f.costSource === "own"
            ? "A number in dollars from a tool you turned on (Connections › Your servers › Use as a goal number). Code reads it each morning for yesterday."
            : "Revenue, orders, average order, repeat rate and cash are read either way."}</span>
      </label>
      {f.costSource === "own" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }} className="ink2">
          The number
          <select className="input" aria-label="The number" value={f.costNumber} disabled={!canEdit} onChange={(e) => setF({ ...f, costNumber: e.target.value })}>
            <option value="">Pick one</option>
            {numbers.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
          </select>
        </label>
      )}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn dark sm" disabled={busy || !canEdit || !changed || (f.costSource === "own" && !f.costNumber)} title={canEdit ? "The next daily numbers use it" : "Owners only"} onClick={() => run(() => save(f))}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {toast}
    </div>
  );
}

type ProductKey = "productCollections" | "productFields" | "offerTerms";

/**
 * What agents may say about the products (docs/product-facts.md): the Shopify collections and product
 * fields agents read, and the owner's own offer terms. Outside messages may claim only these facts.
 * Owners only.
 */
export function ProductFactsForm({ initial, canEdit, save }: { initial: Record<ProductKey, string>; canEdit: boolean; save: (f: Record<ProductKey, string>) => Promise<ActionResult> }) {
  const [f, setF] = useState(initial);
  const { busy, run, toast } = useAct();
  const changed = (Object.keys(initial) as ProductKey[]).some((k) => f[k] !== initial[k]);
  const label = (text: string, hint: string, control: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }} className="ink2">
      {text}
      {control}
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
    </label>
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      {label("Shopify collections", "Up to 5 collection handles, separated by commas, like our-coffees. Only active, in-stock products in them are read.",
        <input className="input" aria-label="Shopify collections" value={f.productCollections} maxLength={600} disabled={!canEdit} placeholder="our-coffees, wholesale" onChange={(e) => setF({ ...f, productCollections: e.target.value })} />)}
      {label("Product fields", "Up to 20 metafields written namespace.key, like custom.origin. Leave out costs and anything you wouldn’t put in an email.",
        <input className="input" aria-label="Product fields" value={f.productFields} maxLength={1000} disabled={!canEdit} placeholder="custom.origin, custom.process" onChange={(e) => setF({ ...f, productFields: e.target.value })} />)}
      {label("Offer terms", "Your own words on what you offer: minimums, sizes, prices, terms, the page to send people to. Plain text; links must start with https://.",
        <textarea className="input" rows={6} aria-label="Offer terms" value={f.offerTerms} maxLength={1500} disabled={!canEdit} placeholder={"Minimum order 5 lb.\nBags: 12 oz, 2 lb, 5 lb.\nMore at https://example.com/wholesale"} onChange={(e) => setF({ ...f, offerTerms: e.target.value })} />)}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn dark sm" disabled={busy || !canEdit || !changed} title={canEdit ? "Agents use the new facts from their next run" : "Owners only"} onClick={() => run(() => save(f))}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {toast}
    </div>
  );
}
