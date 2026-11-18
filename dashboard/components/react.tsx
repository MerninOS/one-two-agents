"use client";
// Teach by reacting (docs/company-mode.md, slice 1): Good / Not this on a run or one item of it, and the
// rule picker that Reject on an approval card shares. The owner's words save straight away as a rule.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { Toast } from "./client";

const MAX = 280;
export type Scope = "agent" | "department" | "crew";
export type ReactKeep = "always" | "days_30" | "next_run";
export interface RuleChoice { id: string; text: string }
export interface ReactRulesView { deptName: string | null; agent: RuleChoice[]; department: RuleChoice[]; crew: RuleChoice[] }
export interface RuleDraft { text: string; scope: Scope; keep: ReactKeep; replaces: string | null }

const blank: RuleDraft = { text: "", scope: "agent", keep: "always", replaces: null };
const short = (t: string) => (t.length > 110 ? `${t.slice(0, 109)}…` : t);

/** The words, who follows them, for how long, and which old rule (if any) they replace. */
export function RulePicker({ name, rules, draft, set, disabled, placeholder }: { name: string; rules: ReactRulesView; draft: RuleDraft; set: (d: RuleDraft) => void; disabled?: boolean; placeholder?: string }) {
  const left = MAX - draft.text.trim().length;
  const scopes: [Scope, string][] = [["agent", name], ...(rules.deptName ? [["department", `All of ${rules.deptName}`] as [Scope, string]] : []), ["crew", "Everyone"]];
  const keeps: [ReactKeep, string][] = [["always", "Always"], ["days_30", "30 days"], ["next_run", "Next run"]];
  const existing = draft.scope === "crew" ? rules.crew : draft.scope === "department" ? rules.department : rules.agent;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="stack" style={{ gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }} className="ink2">What’s wrong with it? Say it like you’d say it to {name}.</span>
        <textarea className="input" rows={2} maxLength={MAX + 40} value={draft.text} disabled={disabled} onChange={(e) => set({ ...draft, text: e.target.value })}
          placeholder={placeholder ?? "e.g. Skip chains with more than 3 locations"}
          style={{ height: "auto", borderRadius: 14, padding: "10px 14px", resize: "vertical", lineHeight: 1.45 }} />
        <span className="muted" style={{ fontSize: 11.5, color: left < 0 ? "var(--red-ink)" : undefined, alignSelf: "flex-end" }}>{left}</span>
      </label>
      {draft.text.trim() && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em" }}>WHO SHOULD FOLLOW IT</span>
            <div className="bf-chips sm" role="group" aria-label="Who should follow it">
              {scopes.map(([k, label]) => <button key={k} type="button" className={"bf-chip" + (draft.scope === k ? " on" : "")} aria-pressed={draft.scope === k} disabled={disabled}
                onClick={() => set({ ...draft, scope: k, keep: k === "agent" ? draft.keep : "always", replaces: null })}>{label}</button>)}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em" }}>FOR HOW LONG</span>
            <div className="bf-chips sm" role="group" aria-label="For how long">
              {keeps.map(([k, label]) => <button key={k} type="button" className={"bf-chip" + (draft.keep === k ? " on" : "")} aria-pressed={draft.keep === k} disabled={disabled || (draft.scope !== "agent" && k !== "always")}
                onClick={() => set({ ...draft, keep: k })}>{label}</button>)}
            </div>
            {draft.scope !== "agent" && <span className="muted" style={{ fontSize: 11.5 }}>A rule for more than one agent stays until you forget it.</span>}
          </div>
          {existing.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em" }}>REPLACE A RULE IT ALREADY HAS?</span>
              <label className="row" style={{ gap: 8, fontSize: 13, alignItems: "flex-start" }}><input type="radio" name="replaces" checked={!draft.replaces} disabled={disabled} onChange={() => set({ ...draft, replaces: null })} /><span>No, keep them all</span></label>
              {existing.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8, fontSize: 13, alignItems: "flex-start", lineHeight: 1.4 }}>
                  <input type="radio" name="replaces" checked={draft.replaces === r.id} disabled={disabled} onChange={() => set({ ...draft, replaces: r.id })} />
                  <span className="ink2">“{short(r.text)}”</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Save = (verdict: "good" | "not", text: string, scope: Scope, keep: ReactKeep, replaces: string | null) => Promise<ActionResult>;

/** Good and Not this on a run (or one item of it). Good saves at once; Not this opens the rule picker. */
export function ReactBar({ name, rules, save, current, compact, disabled, why }: {
  name: string; rules: ReactRulesView; save: Save;
  /** What the owner said last time, if anything. */
  current?: { verdict: "good" | "not"; text: string | null } | null;
  compact?: boolean; disabled?: boolean; why?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(blank);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = (verdict: "good" | "not") => start(async () => {
    let r: ActionResult;
    try { r = await save(verdict, verdict === "good" ? "" : draft.text, draft.scope, draft.keep, draft.replaces); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Couldn’t save that." }; }
    setToast(r);
    if (r.ok) { setOpen(false); setDraft(blank); router.refresh(); }
  });
  const size = compact ? "btn xs" : "btn sm";
  const good = current?.verdict === "good", not = current?.verdict === "not";
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <button type="button" className={`${size} ${good ? "dark" : "outline"}`} aria-pressed={good} disabled={busy || disabled} title={why} onClick={() => go("good")}>Good</button>
        <button type="button" className={`${size} ${not || open ? "dark" : "outline"}`} aria-pressed={not} aria-expanded={open} disabled={busy || disabled} title={why} onClick={() => setOpen(!open)}>Not this…</button>
        {current?.text && !open && <span className="muted" style={{ fontSize: 12, lineHeight: 1.4, flex: "1 1 200px" }}>You said: “{short(current.text)}”</span>}
      </div>
      {open && (
        <div className="stack" style={{ gap: 12, padding: 14, borderRadius: 16, background: "var(--soft)" }}>
          <RulePicker name={name} rules={rules} draft={draft} set={setDraft} disabled={busy} />
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn dark sm" disabled={busy || draft.text.trim().length > MAX} onClick={() => go("not")}>
              {busy ? "Saving…" : !draft.text.trim() ? "Just mark it not this" : draft.scope === "crew" ? "Save as a rule for everyone" : draft.scope === "department" ? `Save as a rule for ${rules.deptName}` : `Save as a rule for ${name}`}
            </button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setOpen(false); setDraft(blank); }}>Cancel</button>
          </div>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>Your words are saved as they are and loaded from the next run. A rule is a note: it can’t raise a cap, add a recipient or grant access. Undo on the Memory tab.</span>
        </div>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/**
 * Reject on an approval card. Words are optional; when given they save as a rule in the owner's words,
 * straight away, for whoever he picks (the same picker as Not this on a run).
 */
export function RejectButton({ reject, agentName, rules }: { reject: (reason: string, scope: Scope, keep: ReactKeep, replaces: string | null) => Promise<ActionResult>; agentName: string; rules: ReactRulesView }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(blank);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await reject(draft.text, draft.scope, draft.keep, draft.replaces); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setOpen(false); setDraft(blank); setToast(r); router.refresh();
  });
  return (
    <>
      <button className="btn ghost" disabled={busy} onClick={() => setOpen(true)}>{busy ? "Working…" : "Reject"}</button>
      {open && (
        <div className="modal-bg" onClick={busy ? undefined : () => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Reject" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>Reject this?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>Nothing is sent or written. If you say why, it’s saved as a rule in your words, so {agentName} doesn’t make the same call again.</p>
            <RulePicker name={agentName} rules={rules} draft={draft} set={setDraft} disabled={busy} placeholder="Why not? (optional) e.g. Costco runs are supplies, not COGS" />
            <div className="row wrap" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
              <button className="btn ghost" style={{ height: 42 }} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn dark" style={{ height: 42 }} onClick={go} disabled={busy || draft.text.trim().length > MAX}>{busy ? "Working…" : draft.text.trim() ? "Reject and save the rule" : "Reject"}</button>
            </div>
          </div>
        </div>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}
