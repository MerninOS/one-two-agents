"use client";
// The Thinking editor on the agent canvas (docs/agent-setup.md, slice 2): model, effort,
// fallback model and instructions, picked from the agent's menu. The locked safety block is
// shown but can't be edited. Changes stay a draft (kept in this browser) until Zak saves them
// as a new version; Preview runs the draft for real and writes nothing. The server checks
// everything again: this file only shows choices and calls the actions.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Effort } from "@/core/setup";
import type { ActionResult } from "../actions";
import { previewSetup, rollBackSetup, saveSetupVersion } from "../actions";
import type { DiffLine } from "../diff";
import { Icon } from "./Icon";
import { Modal, Toast, type Confirm } from "./client";

type Gap = { op: "gap"; text: string };
export interface EditorModel { id: string; in: number | null; out: number | null }
export interface EditorVersion {
  version: number; active: boolean; note: string | null; by: string; at: string;
  model: string; effort: Effort; fallback: string | null; instructionsChars: number; builtInText: boolean;
  /** What changed from the version before it, in plain words. */
  changes: string[];
  diff: (DiffLine | Gap)[] | null;
}
export interface ThinkingEditorData {
  agentId: string; agentName: string; stepLabel: string; needs: string;
  models: EditorModel[];
  active: { version: number | null; model: string; effort: Effort; fallback: string | null; instructions: string };
  builtIn: string; safety: string; maxChars: number;
  /** Average tokens of the last real runs that called a model, for the cost estimate. */
  usage: { runs: number; avgIn: number; avgOut: number } | null;
  controlsOn: boolean;
  /** Why saving is off (the setup can't be read), when it is. */
  blocked?: string;
  versions: EditorVersion[];
}
interface Draft { model: string; effort: Effort; fallback: string | null; instructions: string }
type Preview = NonNullable<Awaited<ReturnType<typeof previewSetup>>["preview"]>;

const EFFORTS: Effort[] = ["low", "medium", "high"];
const RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2 };
const perM = (p: number | null) => (p == null ? "no price" : `$${+(p * 1e6).toFixed(2)}`);
const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const ago = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** Same rule as core/setup.ts loosening(); the server decides, this only shows the confirm. */
function costlier(now: Draft, next: Draft, price: (m: string) => number): string[] {
  const out: string[] = [];
  if (price(next.model) > price(now.model)) out.push(`${next.model} costs more per token than ${now.model}`);
  if (next.fallback && (!now.fallback || price(next.fallback) > price(now.fallback))) out.push(`fallback ${next.fallback} costs more than ${now.fallback ?? "no fallback"}`);
  if (RANK[next.effort] > RANK[now.effort]) out.push(`effort ${next.effort} uses more tokens than ${now.effort}`);
  return out;
}

export function ThinkingEditor({ d }: { d: ThinkingEditorData }) {
  const router = useRouter();
  const cur = d.active;
  const base: Draft = { model: cur.model, effort: cur.effort, fallback: cur.fallback, instructions: cur.instructions };
  const key = `cr-setup-draft:${d.agentId}`;
  const version = cur.version;
  // the parent remounts this editor when the active version changes (key prop), so `base` is the start
  const [draft, setDraft] = useState<Draft>(base);
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<(Confirm & { go: () => void }) | null>(null);
  const [busy, start] = useTransition();
  const [busyWhat, setBusyWhat] = useState("");

  // a draft survives a reload, but only on top of the version it was started from
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { base: number | null; draft: Draft } | null;
      if (saved && saved.base === version && saved.draft?.model) setDraft(saved.draft); // eslint-disable-line react-hooks/set-state-in-effect
      // a save or roll back remounts this editor; its message is handed over through sessionStorage
      const flash = sessionStorage.getItem(`${key}:flash`);
      if (flash) { sessionStorage.removeItem(`${key}:flash`); setToast({ ok: true, text: flash }); }
    } catch { /* nothing kept */ }
  }, [key, version]);
  const change = (patch: Partial<Draft>) => setDraft((x) => {
    const next = { ...x, ...patch };
    try { localStorage.setItem(key, JSON.stringify({ base: version, draft: next })); } catch { /* private window: the draft just isn't kept */ }
    return next;
  });
  const discard = () => { try { localStorage.removeItem(key); } catch { /* nothing kept */ } setDraft(base); setNote(""); setOk(false); setPreview(null); };

  const price = (m: string) => d.models.find((x) => x.id === m)?.out ?? Infinity;
  const runCost = (m: string) => {
    const p = d.models.find((x) => x.id === m);
    return d.usage && p?.in != null && p.out != null ? d.usage.avgIn * p.in + d.usage.avgOut * p.out : null;
  };
  const dirty = draft.model !== base.model || draft.effort !== base.effort || draft.fallback !== base.fallback || draft.instructions.trim() !== base.instructions.trim();
  const more = costlier(base, draft, price);
  const tooLong = draft.instructions.length > d.maxChars, empty = !draft.instructions.trim();
  const nextV = Math.max(0, ...d.versions.map((v) => v.version)) + 1;
  const canSave = !d.blocked && dirty && !tooLong && !empty && !!note.trim() && (!more.length || (ok && d.controlsOn));

  const act = (what: string, f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusyWhat(what);
    start(async () => {
      let r: ActionResult;
      try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      setToast(r); after?.(r);
      if (r.ok && what !== "preview") try { sessionStorage.setItem(`${key}:flash`, r.text); } catch { /* the toast above still shows until the refresh */ }
      router.refresh();
    });
  };
  const doPreview = () => act("preview", async () => {
    const r = await previewSetup(d.agentId, draft);
    if (r.preview) setPreview(r.preview);
    return r;
  });
  const doSave = () => act("save", () => saveSetupVersion(d.agentId, draft, note, more.length > 0 && ok), (r) => { if (r.ok) discard(); });
  const askSave = () => setConfirm({
    title: `Save as v${nextV}?`, body: `${d.agentName}’s next run uses it. You can roll back from the version list at any time.`,
    lines: [{ k: "Model", v: draft.model }, { k: "Effort", v: draft.effort }, { k: "Fallback", v: draft.fallback ?? "None" }, { k: "Instructions", v: `${n0(draft.instructions.trim().length)} characters` }, ...more.map((m) => ({ k: "Costs more", v: m }))],
    confirmLabel: `Save v${nextV}`, kind: "dark", go: doSave,
  });
  const askRollBack = (v: EditorVersion) => {
    const m = costlier(base, { model: v.model, effort: v.effort, fallback: v.fallback, instructions: "" }, price);
    setConfirm({
      title: `Make v${v.version} active again?`, body: `Nothing is deleted. v${version ?? "?"} stays in the list and you can switch back.${m.length && !d.controlsOn ? " This version costs more, so DASHBOARD_CONTROLS must be on." : ""}`,
      lines: [{ k: "Model", v: v.model }, { k: "Effort", v: v.effort }, { k: "Fallback", v: v.fallback ?? "None" }, ...m.map((x) => ({ k: "Costs more", v: x }))],
      confirmLabel: `Roll back to v${v.version}`, kind: m.length ? "danger" : "dark",
      go: () => act("rollback", () => rollBackSetup(d.agentId, v.version, m.length > 0)),
    });
  };

  const nowCost = runCost(base.model), draftCost = runCost(draft.model);
  return (
    <div className="card" style={{ gap: 16 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="node-ic"><Icon name="cpu" size={13} /></span>
        <span className="card-t">Edit Thinking</span>
        <span className="sub" style={{ flex: 1 }}>{d.stepLabel}. Needs: {d.needs}</span>
        <span className="pill sm" style={dirty ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{dirty ? "Unsaved draft" : version != null ? `v${version} active` : "Built-in setup"}</span>
      </div>
      {d.blocked && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{d.blocked}</div>}

      <div className="ted-grid">
        <label className="ted-field">
          <span className="ted-k">Model</span>
          <select className="input" value={draft.model} onChange={(e) => change({ model: e.target.value, fallback: draft.fallback === e.target.value ? null : draft.fallback })}>
            {d.models.map((m) => <option key={m.id} value={m.id}>{m.id} · {perM(m.in)} in, {perM(m.out)} out per million</option>)}
          </select>
        </label>
        <div className="ted-field">
          <span className="ted-k">Effort</span>
          <div className="seg" role="radiogroup" aria-label="Effort">
            {EFFORTS.map((e) => <button key={e} type="button" role="radio" aria-checked={draft.effort === e} className={draft.effort === e ? "on" : ""} onClick={() => change({ effort: e })}>{e}</button>)}
          </div>
        </div>
        <label className="ted-field">
          <span className="ted-k">Fallback model</span>
          <select className="input" value={draft.fallback ?? ""} onChange={(e) => change({ fallback: e.target.value || null })}>
            <option value="">None. Straight to the fixed rules.</option>
            {d.models.filter((m) => m.id !== draft.model).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          <span className="sub">Tried once if {draft.model} can’t be reached. If both fail, fixed rules write the watch list and focus.</span>
        </label>
        <div className="ted-field">
          <span className="ted-k">Cost per run</span>
          {d.usage ? (
            <span style={{ fontSize: 14 }}>About <b>{nowCost == null ? "?" : money(nowCost)}</b> now{draft.model !== base.model && <> · <b>{draftCost == null ? "?" : money(draftCost)}</b> with this draft</>}</span>
          ) : <span style={{ fontSize: 14 }}>No real run has called a model yet, so there is nothing to estimate from.</span>}
          <span className="sub">{d.usage ? `From the price table and the average tokens of the last ${d.usage.runs} real run${d.usage.runs === 1 ? "" : "s"} (${n0(d.usage.avgIn)} in, ${n0(d.usage.avgOut)} out). Effort changes how many tokens a run uses, so treat this as a guide.` : "The price table is in integrations/anthropic.ts."}</span>
        </div>
      </div>

      <div className="ted-field">
        <span className="ted-k"><Icon name="lock" size={12} /> Safety block · locked</span>
        <span className="setup-long" style={{ marginTop: 0 }}>{d.safety}</span>
        <span className="sub">Always sent first, before the instructions below. Set in code; no setup can change it.</span>
      </div>

      <label className="ted-field">
        <span className="row wrap" style={{ gap: 8, justifyContent: "space-between" }}>
          <span className="ted-k">Instructions</span>
          <span className="row" style={{ gap: 8 }}>
            <span className="sub" style={tooLong ? { color: "var(--red-ink)" } : undefined}>{n0(draft.instructions.length)} of {n0(d.maxChars)} characters</span>
            {draft.instructions.trim() !== d.builtIn.trim() && <button type="button" className="btn ghost xs" onClick={() => change({ instructions: d.builtIn })}>Use the built-in text</button>}
          </span>
        </span>
        <textarea className="input ted-text" rows={14} value={draft.instructions} onChange={(e) => change({ instructions: e.target.value })} aria-label="Instructions" />
        {empty && <span className="sub" style={{ color: "var(--red-ink)" }}>Instructions can’t be empty.</span>}
      </label>

      {dirty && more.length > 0 && (
        <div className="ted-warn">
          <span style={{ fontWeight: 600 }}>This draft costs more to run</span>
          <ul>{more.map((m) => <li key={m}>{m}</li>)}</ul>
          {d.controlsOn
            ? <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I understand. Save it anyway.</label>
            : <span>Saving a costlier setup needs DASHBOARD_CONTROLS=on in Vercel. Cheaper changes and instruction edits don’t.</span>}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn outline sm" onClick={doPreview} disabled={busy || !d.controlsOn || tooLong || empty || !!d.blocked} title={d.controlsOn ? "One real model call. Writes and sends nothing." : "Needs DASHBOARD_CONTROLS=on: a preview makes one real model call."}>
          <Icon name="play" size={14} />{busy && busyWhat === "preview" ? "Previewing… about a minute" : "Preview"}
        </button>
        <input className="input" style={{ flex: "1 1 220px", height: 34 }} placeholder="Why this change (shown in the version list)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} disabled={!dirty} aria-label="Note for this version" />
        <button className="btn dark sm" onClick={askSave} disabled={busy || !canSave}>{busy && busyWhat === "save" ? "Saving…" : `Save as v${nextV}`}</button>
        {dirty && <button className="btn ghost sm" onClick={discard} disabled={busy}>Discard draft</button>}
      </div>
      {!d.controlsOn && <span className="sub">Preview needs DASHBOARD_CONTROLS=on, because it makes one real model call (a few cents at most).</span>}

      {preview && <PreviewPanel p={preview} onClose={() => setPreview(null)} />}

      <Versions d={d} busy={busy} onRollBack={askRollBack} />

      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function PreviewPanel({ p, onClose }: { p: Preview; onClose: () => void }) {
  return (
    <div className="ted-preview">
      <div className="row wrap" style={{ gap: 8, justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>Preview · nothing written or sent</span>
        <button className="btn ghost xs" onClick={onClose}>Close</button>
      </div>
      <span className="sub">Answered by {p.servedBy} · {money(p.costUsd)} · {n0(p.tokensIn)} in, {n0(p.tokensOut)} out{p.note ? ` · ${p.note}` : ""}</span>
      <div className="ted-cols">
        <div className="stack" style={{ gap: 10 }}>
          <div><span className="ted-k">Watch</span>{p.watch.length ? <ul className="ted-list">{p.watch.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted" style={{ fontSize: 13 }}>Nothing flagged.</p>}</div>
          <div><span className="ted-k">Today’s focus</span><p style={{ fontSize: 13.5, lineHeight: 1.5 }}><b>{p.focus.action}.</b> {p.focus.reason}</p></div>
          <div><span className="ted-k">Would remember for tomorrow</span>{p.remember.length ? <ul className="ted-list">{p.remember.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted" style={{ fontSize: 13 }}>Nothing.</p>}<span className="sub">A preview never saves working memory.</span></div>
          <div>
            <span className="ted-k">Briefs database row it would write</span>
            {p.row.map(([k, v]) => <div key={k} className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr)", padding: "7px 0", fontSize: 12.5 }}><span>{k}</span><span style={{ overflowWrap: "anywhere" }}>{v}</span></div>)}
          </div>
        </div>
        {p.email && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="ted-k">Email · {p.email.subject}</span>
            {/* sandboxed: no scripts, no same-origin access */}
            <iframe title="Email preview" sandbox="" srcDoc={p.email.html} className="ted-mail" />
          </div>
        )}
      </div>
    </div>
  );
}

function Versions({ d, busy, onRollBack }: { d: ThinkingEditorData; busy: boolean; onRollBack: (v: EditorVersion) => void }) {
  if (!d.versions.length) return <span className="sub">No saved versions yet. Saving creates v1.</span>;
  return (
    <div className="stack" style={{ gap: 0 }}>
      <span className="ted-k" style={{ paddingBottom: 6 }}>Versions</span>
      {d.versions.map((v) => (
        <div key={v.version} className="ted-ver">
          <div className="row wrap" style={{ gap: 8 }}>
            <b>v{v.version}</b>
            {v.active && <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Active</span>}
            <span className="sub" style={{ flex: 1 }}>{ago(v.at)} CT · {v.by}</span>
            {!v.active && !d.blocked && <button className="btn outline xs" disabled={busy} onClick={() => onRollBack(v)}>Roll back to v{v.version}</button>}
          </div>
          {v.note && <span style={{ fontSize: 13.5 }}>{v.note}</span>}
          <span className="sub">{v.model} · effort {v.effort} · fallback {v.fallback ?? "none"} · {v.builtInText ? "built-in instructions" : `own instructions, ${n0(v.instructionsChars)} characters`}</span>
          {v.changes.length > 0 && <span className="sub">Changed: {v.changes.join("; ")}</span>}
          {v.diff && (
            <details>
              <summary className="sub" style={{ cursor: "pointer", color: "var(--acc-ink)" }}>Instructions diff</summary>
              <pre className="ted-diff">{v.diff.map((l, k) => <span key={k} className={`d-${l.op}`}>{l.op === "add" ? "+ " : l.op === "del" ? "− " : l.op === "gap" ? "" : "  "}{l.text}{"\n"}</span>)}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
