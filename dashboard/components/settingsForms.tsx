"use client";
// Settings forms for the gateway's lists: add a vendor (DASHBOARD_CONTROLS=on) and stop email to
// an address (always allowed). The server checks everything again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/dashboard/actions";
import { Toast } from "./client";

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
