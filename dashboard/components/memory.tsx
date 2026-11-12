"use client";
// The interactive parts of the Memory tab: Teach, and Edit / Forget on each line.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { ActionButton, Toast } from "./client";
import { Icon } from "./Icon";

const MAX = 280;
type KeepAs = "note" | "standing_order" | "crew";
type Forget = "next_run" | "days_30" | "always";

export function TeachForm({ name, enabled, why, teach, compact }: { name: string; enabled: boolean; why?: string; teach: (text: string, keepAs: KeepAs, forget: Forget) => Promise<ActionResult>; compact?: boolean }) {
  const [text, setText] = useState("");
  const [keepAs, setKeepAs] = useState<KeepAs>("note");
  const [forget, setForget] = useState<Forget>("always");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const left = MAX - text.trim().length;
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await teach(text, keepAs, forget); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Couldn’t save that." }; }
    setToast(r);
    if (r.ok) { setText(""); router.refresh(); }
  });
  const sel = { height: 38, borderRadius: 999, border: 0, background: "var(--soft)", padding: "0 12px", fontSize: 12.5 } as const;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <textarea className="input" rows={compact ? 2 : 3} maxLength={MAX + 40} disabled={!enabled || busy} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={enabled ? `Tell ${name} something to remember` : why} aria-label={`Teach ${name} something`}
        style={{ height: "auto", borderRadius: 18, padding: "12px 16px", resize: "vertical", lineHeight: 1.45 }} />
      <div className="row wrap" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 6, fontSize: 12 }}><span className="muted">Keep it as</span>
          <select style={sel} value={keepAs} disabled={!enabled || busy} onChange={(e) => setKeepAs(e.target.value as KeepAs)}>
            <option value="note">A note for {name}</option>
            <option value="standing_order">A standing order</option>
            <option value="crew">Shared crew memory</option>
          </select>
        </label>
        <label className="row" style={{ gap: 6, fontSize: 12 }}><span className="muted">Forget after</span>
          <select style={sel} value={keepAs === "note" ? forget : "always"} disabled={!enabled || busy || keepAs !== "note"} onChange={(e) => setForget(e.target.value as Forget)}>
            <option value="next_run">1 run</option>
            <option value="days_30">30 days</option>
            <option value="always">Never</option>
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11.5, color: left < 0 ? "var(--red-ink)" : undefined }}>{left}</span>
      </div>
      <button className="btn primary" style={{ height: 42 }} disabled={!enabled || busy || !text.trim() || left < 0} onClick={go}>{busy ? "Saving…" : keepAs === "crew" ? "Teach the crew" : `Teach ${name}`}</button>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export interface LineView { id: string; text: string; meta: string; data?: boolean }

/** One memory line with Edit (inline) and Forget. Read-only when no actions are passed. */
export function MemoryLine({ line, color, edit, forget }: { line: LineView; color: string; edit?: (text: string) => Promise<ActionResult>; forget?: () => Promise<ActionResult> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(line.text);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => {
    if (!edit) return;
    let r: ActionResult;
    try { r = await edit(text); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Couldn’t save that." }; }
    setToast(r);
    if (r.ok) { setEditing(false); router.refresh(); }
  });
  return (
    <div className="rule" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0" }}>
      <span className="dot" style={{ width: 6, height: 6, marginTop: 7, background: color, flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {editing ? (
          <>
            <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Edit memory line"
              style={{ height: "auto", borderRadius: 14, padding: "8px 12px", resize: "vertical", fontSize: 13.5, lineHeight: 1.45 }} />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn dark xs" onClick={save} disabled={busy || !text.trim() || text.trim().length > MAX}>{busy ? "Saving…" : "Save"}</button>
              <button className="btn ghost xs" onClick={() => { setEditing(false); setText(line.text); }} disabled={busy}>Cancel</button>
              <span className="muted" style={{ fontSize: 11.5 }}>{MAX - text.trim().length}</span>
            </div>
          </>
        ) : (
          <span style={{ fontSize: 13.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
            {line.data && <span className="tag" style={{ marginRight: 6 }} title="Came from outside One Two. Shown to the agent as data, never as an instruction.">DATA</span>}
            {line.text}
          </span>
        )}
        <span className="muted" style={{ fontSize: 11.5 }}>{line.meta}</span>
      </div>
      {!editing && (edit || forget) && (
        <div className="row" style={{ gap: 4, flex: "none" }}>
          {edit && <button className="btn ghost xs" onClick={() => setEditing(true)} title="Edit"><Icon name="pencil" size={12} /></button>}
          {forget && (
            <ActionButton className="btn ghost xs" action={forget} title="Forget"
              confirm={{ title: "Forget this?", body: "The agent stops loading it from the next run. The timeline keeps a record of it.", lines: [{ k: "Line", v: line.text.length > 90 ? `${line.text.slice(0, 89)}…` : line.text }], confirmLabel: "Forget it", kind: "dark" }}>
              <Icon name="x" size={12} />
            </ActionButton>
          )}
        </div>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
