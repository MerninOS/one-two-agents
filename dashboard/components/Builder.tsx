"use client";
// The parts of an agent's builder page that slice 4 (Try it and Go live, docs/builder-flow.md)
// replaces: Try for now (tool check, Preview, Deliver), the version list, Compare and Switch for
// the four rebuilt agents, and the playbook. Editing the agent is the flow (Flow.tsx).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PlaybookView } from "@/dashboard/builder";
import type { ActionResult } from "../actions";
import { Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";

type Act<T extends unknown[] = []> = (...a: T) => Promise<ActionResult>;

function useAct() {
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r); router.refresh();
  });
  return { toast, setToast, busy, run };
}

/** Try the saved version: the free tool check, and a Preview run (explore, or following the approved playbook). */
export function TryPanel({ limits, modelLabel, delivers, controls, dryRun, preview, playbook, pendingPlaybook }: {
  limits: { maxSteps: number; maxCostUsd: number }; modelLabel: string;
  /** It has a report or an action, so Deliver means something. */
  delivers: boolean; controls: boolean;
  dryRun: Act; preview: Act<[null, boolean, boolean]>;
  playbook: { version: number; steps: number } | null; pendingPlaybook: number | null;
}) {
  const { toast, setToast, busy, run } = useAct();
  const [check, setCheck] = useState<ActionResult | null>(null);
  const [deliver, setDeliver] = useState(false);
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const deliverLine = deliver && delivers ? "If it finishes, its reports go out and its proposals become approval cards for you." : "Nothing is written or sent.";
  const onPreview = (explore: boolean) => setConfirm({
    c: {
      title: explore ? "Re-explore?" : "Run a preview?",
      body: !explore && playbook
        ? `Follows playbook v${playbook.version}: code makes its ${playbook.steps} tool calls on live data, then ${modelLabel} writes the result. If a step fails it explores instead. Up to $${limits.maxCostUsd.toFixed(2)}. ${deliverLine} It counts against today’s budget.`
        : `A real explore run of the saved version on ${modelLabel}: the model picks its own tool calls, up to ${limits.maxSteps} and $${limits.maxCostUsd.toFixed(2)}. ${deliverLine} It counts against today’s budget. Afterwards code drafts a playbook from the calls that worked.`,
      confirmLabel: explore ? "Re-explore" : "Run preview", kind: "dark",
    },
    go: () => run(() => preview(null, explore, deliver && delivers)),
  });
  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}><span className="card-t">Try it</span><span className="sub" style={{ flex: 1 }}>For now: this becomes the flow’s Try it and Go live steps next.</span></div>
      <span className="sub">{playbook ? `Playbook v${playbook.version} is approved (${playbook.steps} steps), so Preview follows it.` : "No playbook approved yet. Preview explores, then code drafts a playbook from the calls that worked."}{pendingPlaybook ? ` v${pendingPlaybook} waits for your approval below.` : ""}</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn outline" disabled={busy} onClick={() => { setCheck({ ok: true, text: "Checking each ticked tool…" }); run(dryRun, (r) => setCheck(r)); }}><Icon name="play" size={15} />Tool check · free</button>
        <button type="button" className="btn dark" disabled={busy || !controls} title={controls ? undefined : "Needs DASHBOARD_CONTROLS=on"} onClick={() => onPreview(false)}>{busy ? "Working…" : playbook ? `Preview · follows v${playbook.version}` : "Preview · explore run"}</button>
        {playbook && <button type="button" className="btn outline" disabled={busy || !controls} onClick={() => onPreview(true)}>Re-explore</button>}
      </div>
      {delivers && (
        <label className="row" style={{ gap: 8, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} style={{ width: 16, height: 16 }} />
          <span>Deliver: send reports and queue proposals if the preview finishes</span>
        </label>
      )}
      {check && <span className="sub" style={{ color: check.ok ? undefined : "var(--red-ink)", lineHeight: 1.5 }}>{check.text}</span>}
      {!controls && <span className="sub">Preview needs DASHBOARD_CONTROLS=on, since it spends money.</span>}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Versions, newest first. Making an earlier one active adds no new version. */
export function SpecVersions({ versions, activate, controls }: { versions: { version: number; note: string | null; createdAt: string; active: boolean; createdBy: string; problems: string[]; looser: string[]; when: string }[]; activate: (version: number, confirmed: boolean) => Promise<ActionResult>; controls: boolean }) {
  const { toast, setToast, busy, run } = useAct();
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const pick = (v: (typeof versions)[number]) => {
    if (v.looser.length && !controls) { setToast({ ok: false, text: `Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this: ${v.looser.join("; ")}.` }); return; }
    if (v.looser.length) setConfirm({ c: { title: `Make v${v.version} active?`, body: "It lets a run spend more than the active version.", lines: v.looser.map((x) => ({ k: "Change", v: x })), confirmLabel: `Use v${v.version}`, kind: "dark" }, go: () => run(() => activate(v.version, true)) });
    else run(() => activate(v.version, false));
  };
  return (
    <div className="card" style={{ gap: 6 }}>
      <span className="card-t">Versions</span>
      {versions.map((v) => (
        <div key={v.version} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14 }}>
          <span style={{ fontWeight: 600, minWidth: 30 }}>v{v.version}</span>
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>{v.note ?? "No note"}<span className="muted" style={{ display: "block", fontSize: 12 }}>{v.when} · {v.createdBy}{v.problems.length ? ` · can’t be used: ${v.problems.join("; ")}` : ""}</span></span>
          {v.active ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Active</span>
            : <button type="button" className="btn ghost xs" disabled={busy || v.problems.length > 0} onClick={() => pick(v)}>Make active</button>}
        </div>
      ))}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Morgan, Avery, Rowan and Quinn (slices 6 and 7): compare their own code with the runner, then switch which one runs. */
export function EnginePanel({ name, onRunner, controls, compare, switchTo }: { name: string; onRunner: boolean; controls: boolean; compare: Act; switchTo: Act<[boolean, boolean]> }) {
  const { toast, setToast, busy, run } = useAct();
  const [cmp, setCmp] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const onSwitch = () => {
    if (onRunner) { run(() => switchTo(false, false)); return; }
    if (!controls) { setToast({ ok: false, text: "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to switch." }); return; }
    setConfirm({ c: { title: `Switch ${name} to the runner?`, body: `From its next run, on the schedule, in a chain or by hand, ${name} follows its approved playbook on the runner and delivers through its report tools. Its own code stays, and you can switch back here at any time.`, confirmLabel: "Switch", kind: "dark" }, go: () => run(() => switchTo(true, true)) });
  };
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="card-t">Runs on</span>
        <span className="pill sm" style={onRunner ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{onRunner ? "The runner (this spec and playbook)" : "Its own code"}</span>
      </div>
      <span className="sub">{name} was rebuilt here from its own code, with a starting playbook. Compare runs both as free dry runs on today’s data: no model, nothing sent. Preview shows what the runner’s model would write. Switch when they match.</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn outline" disabled={busy} onClick={() => { setCmp({ ok: true, text: "Running both dry runs…" }); run(compare, (r) => setCmp(r)); }}>Compare · free</button>
        <button type="button" className={onRunner ? "btn outline" : "btn dark"} disabled={busy || (!onRunner && !controls)} onClick={onSwitch}>{onRunner ? "Switch back to its own code" : "Switch to the runner"}</button>
      </div>
      {cmp && <span className="sub" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, color: cmp.ok ? undefined : "var(--red-ink)" }}>{cmp.text}</span>}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Playbooks: the approved one, a draft waiting for approval (Zak can drop steps), and the history. */
export function PlaybookPanel({ view, approve, reject }: { view: PlaybookView; approve: (id: number, keep: number[]) => Promise<ActionResult>; reject: (id: number) => Promise<ActionResult> }) {
  const { toast, setToast, busy, run } = useAct();
  const q = view.pending;
  const [keep, setKeep] = useState<number[]>(q ? q.steps.map((_, i) => i) : []);
  const statusLook: Record<string, { label: string; bg: string; ink: string }> = {
    approved: { label: "Approved", bg: "var(--mint-soft)", ink: "var(--mint-ink)" }, proposed: { label: "Waiting for you", bg: "var(--yel-soft)", ink: "var(--yel-ink)" },
    rejected: { label: "Rejected", bg: "var(--red-soft)", ink: "var(--red-ink)" }, replaced: { label: "Replaced", bg: "var(--soft)", ink: "var(--ink2)" },
  };
  return (
    <div className="card" style={{ gap: 12 }}>
      <span className="card-t">Playbook</span>
      <span className="sub">An explore run lets the model pick its own tool calls. Code saves the calls that worked as a playbook. Once you approve one, runs follow it: code makes the same calls on fresh data and the model only writes the result, which is cheaper and steadier. If a step fails, the run explores instead. After your first approval, a playbook from a Re-explore applies on its own and shows what changed; a run that falls back or doesn’t finish puts the agent on hold, so the next one waits for you again.</span>
      {view.hold && <div className="ted-warn">On hold: {view.hold}. The next playbook waits for your approval.</div>}
      {q && (
        <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span className="ted-k">v{q.version} · waiting for your approval · {q.when}</span>
          {q.changes && <span style={{ fontSize: 13.5 }}>{q.changes}</span>}
          {q.steps.map((st, i) => (
            <label key={i} className="row" style={{ gap: 10, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={keep.includes(i)} onChange={() => setKeep(keep.includes(i) ? keep.filter((x) => x !== i) : [...keep, i].sort((a, b) => a - b))} style={{ width: 18, height: 18 }} />
              <span>{i + 1}. {st}</span>
            </label>
          ))}
          <span className="row" style={{ gap: 10, fontSize: 14 }}><Icon name="cpu" size={15} /><span>{q.steps.length + 1}. The model writes the result from what these returned</span></span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn dark sm" disabled={busy || !keep.length} onClick={() => run(() => approve(q.id, keep))}>{keep.length === q.steps.length ? "Approve" : `Approve ${keep.length} of ${q.steps.length} steps`}</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => reject(q.id))}>Reject</button>
          </div>
        </div>
      )}
      {view.active ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="ted-k">v{view.active.version} · approved{view.active.auto ? " on its own" : ""} · {view.active.when}</span>
          {view.active.steps.map((st, i) => <span key={i} style={{ fontSize: 14 }}>{i + 1}. {st}</span>)}
          <span style={{ fontSize: 14 }}>{view.active.steps.length + 1}. The model writes the result</span>
        </div>
      ) : !q && <span className="sub">None yet. Press Preview to explore; code drafts one from the calls that worked.</span>}
      {view.history.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>History</summary>
          {view.history.map((h) => (
            <div key={h.id} className="row wrap rule" style={{ gap: 10, padding: "8px 0", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600, minWidth: 30 }}>v{h.version}</span>
              <span style={{ flex: "1 1 220px" }}>{h.changes ?? `${h.steps.length} steps`}<span className="muted" style={{ display: "block", fontSize: 12 }}>{h.when}{h.auto ? " · applied on its own" : ""}</span></span>
              <span className="pill sm" style={{ background: statusLook[h.status]?.bg, color: statusLook[h.status]?.ink }}>{statusLook[h.status]?.label ?? h.status}</span>
            </div>
          ))}
        </details>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
