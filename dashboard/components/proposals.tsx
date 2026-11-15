"use client";
// Not now… on a proposal (docs/company-mode.md, slice 3): asks why. Words become a 30-day note for
// the head that asked, so it doesn't propose the same thing again next run.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { Toast } from "./client";

const MAX = 240;

export function NotNowButton({ decline, headName }: { decline: (reason: string) => Promise<ActionResult>; headName: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await decline(text); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setOpen(false); setText(""); setToast(r); router.refresh();
  });
  return (
    <>
      <button className="btn ghost" disabled={busy} onClick={() => setOpen(true)}>{busy ? "Working…" : "Not now…"}</button>
      {open && (
        <div className="modal-bg" onClick={busy ? undefined : () => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Not now" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>Not now?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>
              Nothing changes. {headName ? `If you say why, ${headName} keeps your words as a note for 30 days, so it doesn’t ask again for the same reason.` : "Your words stay on the proposal."}
            </p>
            <textarea className="input" rows={3} maxLength={MAX} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder="Why not? (optional) e.g. Not until wholesale orders pass 10 a month" />
            <div className="row wrap" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
              <button className="btn ghost" style={{ height: 42 }} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn dark" style={{ height: 42 }} onClick={go} disabled={busy}>{busy ? "Working…" : "Not now"}</button>
            </div>
          </div>
        </div>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}
