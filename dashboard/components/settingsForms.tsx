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
