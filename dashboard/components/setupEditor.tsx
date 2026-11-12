"use client";
// What every setup editor on the agent canvas shares (docs/agent-setup.md): one draft that
// covers all the boxes (kept in this browser until saved), Preview, save as a new version with
// a note, the version list and roll back. Each box's editor (ThinkingEditor.tsx,
// ReadsWritesEditor.tsx) only edits its own part of the draft. The server checks everything
// again: this file only shows choices and calls the actions.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { Effort, NotionTarget } from "@/core/setup";
import type { ActionResult } from "../actions";
import { previewSetup, rollBackSetup, saveSetupVersion } from "../actions";
import type { DiffLine } from "../diff";
import { Icon } from "./Icon";
import { Modal, Toast, type Confirm } from "./client";

type Gap = { op: "gap"; text: string };
export interface EditorModel { id: string; label: string; provider: string; /** Called through Vercel AI Gateway rather than the Claude API. */ gateway: boolean; in: number | null; out: number | null }
export interface EditorVersion {
  version: number; active: boolean; note: string | null; by: string; at: string;
  model: string; effort: Effort; fallback: string | null; instructionsChars: number; builtInText: boolean;
  /** Reads and writes in a few words: sources off, sections, Notion target. */
  parts: string;
  /** What changed from the version before it, in plain words. */
  changes: string[];
  diff: (DiffLine | Gap)[] | null;
  /** Rolling back to it would loosen the setup (costs more, or sends somewhere new). */
  looser: string[];
}
/** Every editable value. One draft covers every box, so a save keeps all of it. */
export interface Draft {
  model: string; effort: Effort; fallback: string | null; instructions: string;
  numbers: Record<string, number>;
  readsOff: string[]; outputsOff: string[]; sections: string[]; notion: NotionTarget | null;
}
export interface SetupEditorData {
  agentId: string; agentName: string; stepLabel: string; needs: string;
  models: EditorModel[];
  active: Draft & { version: number | null };
  builtIn: string; safety: string; maxChars: number;
  /** Average tokens of the last real runs that called a model, for the cost estimate. */
  usage: { runs: number; avgIn: number; avgOut: number } | null;
  controlsOn: boolean;
  /** A gateway call can sign in (AI_GATEWAY_API_KEY, or running on Vercel). */
  gatewayReady: boolean;
  /** Why saving is off (the setup can't be read), when it is. */
  blocked?: string;
  versions: EditorVersion[];
  // reads and writes (slice 4)
  reads: { id: string; label: string; detail: string; connected: boolean }[];
  numbers: { key: string; label: string; unit: string; min: number; max: number; default: number; box: string }[];
  outputs: { id: string; label: string; detail: string; ready: boolean; missing: string[] }[];
  sections: { id: string; label: string; detail: string; locked: boolean; needs: { id: string; label: string }[] }[];
  /** Null for an agent with no Notion output. `fallback` is what the env vars point at when no target is picked. */
  notion: { tokenSet: boolean; fallback: string | null } | null;
  /** Gateway action types this agent may propose, read only. */
  actions: { tool: string; tier: string; note: string }[];
}
type Preview = NonNullable<Awaited<ReturnType<typeof previewSetup>>["preview"]>;

const RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2 };
export const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
export const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const ago = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const base = (d: SetupEditorData): Draft => {
  const { version: _v, ...rest } = d.active; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};
export const isDirty = (a: Draft, b: Draft) => !same({ ...a, instructions: a.instructions.trim() }, { ...b, instructions: b.instructions.trim() });

/** Same rule as core/setup.ts loosening(); the server decides, this only shows the confirm. */
export function looser(d: SetupEditorData, now: Draft, next: Draft): string[] {
  const price = (m: string) => d.models.find((x) => x.id === m)?.out ?? Infinity;
  const name = (id: string) => d.models.find((m) => m.id === id)?.label ?? id;
  const out: string[] = [];
  if (price(next.model) > price(now.model)) out.push(`${name(next.model)} costs more per token than ${name(now.model)}`);
  if (next.fallback && (!now.fallback || price(next.fallback) > price(now.fallback))) out.push(`fallback ${name(next.fallback)} costs more than ${now.fallback ? name(now.fallback) : "no fallback"}`);
  if (RANK[next.effort] > RANK[now.effort]) out.push(`effort ${next.effort} uses more tokens than ${now.effort}`);
  for (const o of d.outputs) if (now.outputsOff.includes(o.id) && !next.outputsOff.includes(o.id)) out.push(`${o.label} turned back on`);
  if (next.notion && next.notion.id !== now.notion?.id) out.push(`the Notion copy goes to a different ${next.notion.kind}: ${next.notion.title}`);
  return out;
}

/** Why the draft can't be saved, or null. */
export function draftProblem(d: SetupEditorData, x: Draft): string | null {
  if (!x.instructions.trim()) return "Instructions can’t be empty.";
  if (x.instructions.length > d.maxChars) return "Instructions are too long.";
  if (d.outputs.length && d.outputs.every((o) => x.outputsOff.includes(o.id))) return `Every output is off, so ${d.agentName}’s brief would go nowhere. Keep at least one on.`;
  for (const n of d.numbers) { const v = x.numbers[n.key]; if (!Number.isFinite(v) || v < n.min || v > n.max) return `${n.label} must be ${n.min} to ${n.max}.`; }
  return null;
}

/** The draft, shared across the boxes through localStorage, on top of the version it was started from. */
export function useSetupEditor(d: SetupEditorData) {
  const router = useRouter();
  const start0 = base(d);
  const key = `cr-setup-draft:${d.agentId}`;
  const version = d.active.version;
  // the parent remounts this editor when the active version changes (key prop), so `start0` is the start
  const [draft, setDraft] = useState<Draft>(start0);
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<(Confirm & { go: () => void }) | null>(null);
  const [busy, startT] = useTransition();
  const [busyWhat, setBusyWhat] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { base: number | null; draft: Partial<Draft> } | null;
      // a draft from before slice 4 has only the Thinking fields: lay it over the active values
      if (saved && saved.base === version && saved.draft?.model) setDraft({ ...start0, ...saved.draft }); // eslint-disable-line react-hooks/set-state-in-effect
      const flash = sessionStorage.getItem(`${key}:flash`);
      if (flash) { sessionStorage.removeItem(`${key}:flash`); setToast({ ok: true, text: flash }); }
    } catch { /* nothing kept */ }
    // start0 is rebuilt each render from the same props; the key and version say when it changed
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (patch: Partial<Draft>) => setDraft((x) => {
    const next = { ...x, ...patch };
    try { localStorage.setItem(key, JSON.stringify({ base: version, draft: next })); } catch { /* private window: the draft just isn't kept */ }
    return next;
  });
  const discard = () => { try { localStorage.removeItem(key); } catch { /* nothing kept */ } setDraft(start0); setNote(""); setOk(false); setPreview(null); };

  const act = (what: string, f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusyWhat(what);
    startT(async () => {
      let r: ActionResult;
      try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      setToast(r); after?.(r);
      if (r.ok && what !== "preview") try { sessionStorage.setItem(`${key}:flash`, r.text); } catch { /* the toast above still shows until the refresh */ }
      router.refresh();
    });
  };
  return { start: start0, draft, change, discard, note, setNote, ok, setOk, preview, setPreview, toast, setToast, confirm, setConfirm, busy, busyWhat, act, version };
}
export type SetupEditor = ReturnType<typeof useSetupEditor>;

/** The dirty pill in an editor's header. */
export function DraftPill({ d, e }: { d: SetupEditorData; e: SetupEditor }) {
  const dirty = isDirty(e.draft, e.start);
  return <span className="pill sm" style={dirty ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{dirty ? "Unsaved draft" : d.active.version != null ? `v${d.active.version} active` : "Built-in setup"}</span>;
}

/**
 * Preview, note, save and discard, the loosening warning, the preview panel, the versions and
 * the dialogs: the bottom of every setup editor. `lines` are the box's own rows for the save dialog.
 */
export function EditorFooter({ d, e, lines }: { d: SetupEditorData; e: SetupEditor; lines: { k: string; v: string }[] }) {
  const dirty = isDirty(e.draft, e.start);
  const more = looser(d, e.start, e.draft);
  const problem = draftProblem(d, e.draft);
  const nextV = Math.max(0, ...d.versions.map((v) => v.version)) + 1;
  const canSave = !d.blocked && dirty && !problem && !!e.note.trim() && (!more.length || (e.ok && d.controlsOn));
  const doPreview = () => e.act("preview", async () => {
    const r = await previewSetup(d.agentId, e.draft);
    if (r.preview) e.setPreview(r.preview);
    return r;
  });
  const doSave = () => e.act("save", () => saveSetupVersion(d.agentId, e.draft, e.note, more.length > 0 && e.ok), (r) => { if (r.ok) e.discard(); });
  const askSave = () => e.setConfirm({
    title: `Save as v${nextV}?`, body: `${d.agentName}’s next run uses it. You can roll back from the version list at any time.`,
    lines: [...lines, ...more.map((m) => ({ k: "Looser", v: m }))],
    confirmLabel: `Save v${nextV}`, kind: "dark", go: doSave,
  });
  const askRollBack = (v: EditorVersion) => e.setConfirm({
    title: `Make v${v.version} active again?`, body: `Nothing is deleted. v${e.version ?? "?"} stays in the list and you can switch back.${v.looser.length && !d.controlsOn ? " This version is looser, so DASHBOARD_CONTROLS must be on." : ""}`,
    lines: [{ k: "Thinking", v: `${d.models.find((m) => m.id === v.model)?.label ?? v.model}, effort ${v.effort}` }, { k: "Reads and writes", v: v.parts }, ...v.looser.map((x) => ({ k: "Looser", v: x }))],
    confirmLabel: `Roll back to v${v.version}`, kind: v.looser.length ? "danger" : "dark",
    go: () => e.act("rollback", () => rollBackSetup(d.agentId, v.version, v.looser.length > 0)),
  });
  return (
    <>
      {dirty && problem && <span className="sub" style={{ color: "var(--red-ink)" }}>{problem}</span>}
      {dirty && more.length > 0 && (
        <div className="ted-warn">
          <span style={{ fontWeight: 600 }}>This draft is looser than the active setup</span>
          <ul>{more.map((m) => <li key={m}>{m}</li>)}</ul>
          {d.controlsOn
            ? <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={e.ok} onChange={(x) => e.setOk(x.target.checked)} /> I understand. Save it anyway.</label>
            : <span>Saving a looser setup needs DASHBOARD_CONTROLS=on in Vercel. Turning things off and cheaper changes don’t.</span>}
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn outline sm" onClick={doPreview} disabled={e.busy || !d.controlsOn || !!problem || !!d.blocked} title={d.controlsOn ? "One real model call. Writes and sends nothing." : "Needs DASHBOARD_CONTROLS=on: a preview makes one real model call."}>
          <Icon name="play" size={14} />{e.busy && e.busyWhat === "preview" ? "Previewing… about a minute" : "Preview"}
        </button>
        <input className="input" style={{ flex: "1 1 220px", height: 34 }} placeholder="Why this change (shown in the version list)" value={e.note} maxLength={300} onChange={(x) => e.setNote(x.target.value)} disabled={!dirty} aria-label="Note for this version" />
        <button className="btn dark sm" onClick={askSave} disabled={e.busy || !canSave}>{e.busy && e.busyWhat === "save" ? "Saving…" : `Save as v${nextV}`}</button>
        {dirty && <button className="btn ghost sm" onClick={e.discard} disabled={e.busy}>Discard draft</button>}
      </div>
      {dirty && <span className="sub">The draft covers every box: a save keeps what you changed in Thinking, Reads and Writes together.</span>}
      {!d.controlsOn && <span className="sub">Preview needs DASHBOARD_CONTROLS=on, because it makes one real model call (a few cents at most).</span>}
      {e.preview && <PreviewPanel p={e.preview} onClose={() => e.setPreview(null)} />}
      <Versions d={d} busy={e.busy} onRollBack={askRollBack} />
      {e.confirm && <Modal c={e.confirm} busy={e.busy} onCancel={() => e.setConfirm(null)} onGo={() => { const g = e.confirm!.go; e.setConfirm(null); g(); }} />}
      <Toast t={e.toast} onDone={() => e.setToast(null)} />
    </>
  );
}

/** A labelled block inside an editor. */
export const Field = ({ k, children, sub }: { k: ReactNode; children: ReactNode; sub?: ReactNode }) => (
  <div className="ted-field"><span className="ted-k">{k}</span>{children}{sub && <span className="sub">{sub}</span>}</div>
);

function PreviewPanel({ p, onClose }: { p: Preview; onClose: () => void }) {
  return (
    <div className="ted-preview">
      <div className="row wrap" style={{ gap: 8, justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>Preview · nothing written or sent</span>
        <button className="btn ghost xs" onClick={onClose}>Close</button>
      </div>
      <span className="sub">Answered by {p.servedBy} · {money(p.costUsd)} · {n0(p.tokensIn)} in, {n0(p.tokensOut)} out{p.note ? ` · ${p.note}` : ""}</span>
      <span className="sub">A real run would send it to {p.sendsTo}. Sections: {p.sections.join(", ")}.</span>
      <div className="ted-cols">
        <div className="stack" style={{ gap: 10 }}>
          <div><span className="ted-k">Watch</span>{p.watch.length ? <ul className="ted-list">{p.watch.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted" style={{ fontSize: 13 }}>Nothing flagged.</p>}</div>
          <div><span className="ted-k">Today’s focus</span><p style={{ fontSize: 13.5, lineHeight: 1.5 }}><b>{p.focus.action}.</b> {p.focus.reason}</p></div>
          <div><span className="ted-k">Would remember for tomorrow</span>{p.remember.length ? <ul className="ted-list">{p.remember.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted" style={{ fontSize: 13 }}>Nothing.</p>}<span className="sub">A preview never saves working memory.</span></div>
          {p.row.length > 0 && (
            <div>
              <span className="ted-k">Notion database row it would write</span>
              {p.row.map(([k, v]) => <div key={k} className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr)", padding: "7px 0", fontSize: 12.5 }}><span>{k}</span><span style={{ overflowWrap: "anywhere" }}>{v}</span></div>)}
            </div>
          )}
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

function Versions({ d, busy, onRollBack }: { d: SetupEditorData; busy: boolean; onRollBack: (v: EditorVersion) => void }) {
  if (!d.versions.length) return <span className="sub">No saved versions yet. Saving creates v1.</span>;
  const name = (id: string | null) => (id ? d.models.find((m) => m.id === id)?.label ?? id : "none");
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
          <span className="sub">{name(v.model)} · effort {v.effort} · fallback {name(v.fallback)} · {v.builtInText ? "built-in instructions" : `own instructions, ${n0(v.instructionsChars)} characters`}</span>
          <span className="sub">{v.parts}</span>
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
