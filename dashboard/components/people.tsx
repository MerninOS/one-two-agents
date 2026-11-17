"use client";
// Settings > People (docs/tenancy.md, slice 2). Owners see the controls; everyone else sees the
// list. The server checks the role again on every change.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/dashboard/actions";
import { ROLES, ROLE_LABELS, ROLE_WORDS, type Role } from "@/core/roles";
import { Toast } from "./client";

export interface PersonLine { id: string; email: string; role: Role; you: boolean; lastSignIn: string | null }

type Act = (...a: string[]) => Promise<ActionResult>;

export function People({ people, canEdit, add, setRole, remove }: { people: PersonLine[]; canEdit: boolean; add: Act; setRole: Act; remove: Act }) {
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const [email, setEmail] = useState(""), [role, setNewRole] = useState<Role>("approver");
  const router = useRouter();
  const run = (f: () => Promise<ActionResult>, then?: () => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); if (r.ok) then?.(); router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 0 }}>
      {people.map((p, i) => (
        <div key={p.id} className={"row wrap" + (i ? " rule" : "")} style={{ justifyContent: "space-between", padding: "12px 0", gap: 12, fontSize: 14 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ overflowWrap: "anywhere" }}>{p.email}{p.you ? <span className="muted"> (you)</span> : null}</span>
            <span className="muted" style={{ fontSize: 12 }}>{p.lastSignIn ? `Last signed in ${new Date(p.lastSignIn).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Hasn’t signed in yet"}</span>
          </span>
          {canEdit ? (
            <span className="row" style={{ gap: 8 }}>
              <select className="input" style={{ width: "auto" }} aria-label={`Role for ${p.email}`} value={p.role} disabled={busy} onChange={(e) => run(() => setRole(p.id, e.target.value))}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button className="btn ghost sm" disabled={busy} onClick={() => run(() => remove(p.id))}>Remove</button>
            </span>
          ) : <span className="pill sm">{ROLE_LABELS[p.role]}</span>}
        </div>
      ))}
      {canEdit && (
        <div className="stack rule" style={{ gap: 8, paddingTop: 12 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 2, minWidth: 200 }} type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="input" style={{ flex: 1, minWidth: 120 }} aria-label="Role" value={role} onChange={(e) => setNewRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button className="btn dark sm" disabled={busy || !email.trim()} onClick={() => run(() => add(email, role), () => setEmail(""))}>Add person</button>
          </div>
          <span className="sub">{ROLE_LABELS[role]}: {ROLE_WORDS[role]}</span>
        </div>
      )}
      {toast && <Toast t={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
