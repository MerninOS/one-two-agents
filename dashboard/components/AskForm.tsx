"use client";
// Find a tool (docs/custom-servers.md, slice 3): the ask for a built-in connector. Words only; the
// server checks them again and counts the ask on that service's request.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { Toast } from "./client";

const input = { width: "100%", minWidth: 0, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 14 } as const;

/** `proposalId` ties the ask to the new-tool proposal it came from (checked again on the server). */
export function AskForm({ ask, what: startWhat, proposalId }: { ask: (name: string, what: string, proposalId: string | null) => Promise<ActionResult>; what?: string; proposalId: string | null }) {
  const [name, setName] = useState("");
  const [what, setWhat] = useState(startWhat ?? "");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await ask(name, what, proposalId); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r);
    if (r.ok) setName("");
    router.refresh();
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>Service
        <input id="ask-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Square, Google Analytics, ShipStation…" maxLength={60} style={input} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>What agents should read from it
        <textarea id="ask-what" className="input" value={what} onChange={(e) => setWhat(e.target.value)} rows={3} maxLength={300} placeholder="Weekly sessions and checkout drop-off" style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
      </label>
      <span className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" disabled={busy || !name.trim() || what.trim().length < 5} onClick={go}>{busy ? "Asking…" : "Ask for it"}</button>
      </span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
