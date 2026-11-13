"use client";
// The Crew canvas (docs/agent-setup.md, slice 5): chains of agents. Each chain is a start (a
// schedule, the Run chain button, or an approval being decided) and one to three agents, drawn
// left to right. Click a block to edit it below. The draft stays in this browser until it is
// saved as a new flow version; Preview dry-runs each step of a draft chain (no writes, no cost).
// The palette, the checks and every guardrail live on the server (core/flow.ts), which checks
// the flow again on save; a chain never turns an agent on.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ActionResult, ChainPreviewStep } from "@/dashboard/actions";
import { flowLooser, flowProblems, nextFirings, runsPerMonth, type Chain, type Days, type Flow, type Op, type Start, type Step, type When } from "@/core/flow-rules";
import { Icon } from "./Icon";
import { Modal, Toast, type Confirm } from "./client";
import { Summary } from "./ui";

export interface CrewAgent {
  id: string; name: string; role: string; hue: string; icon: string;
  enabled: boolean; buttonOnly: boolean; takesHandoff: boolean;
  metrics: { key: string; label: string }[];
  /** Average cost of its last real runs (up to 10); null before any. */
  avgCost: number | null; runs: number;
}
export interface CrewVersion { version: number; active: boolean; note: string | null; createdBy: string; createdAt: string; chains: number; on: string[] }
export interface CrewCanvasData {
  version: number; note: string | null; flow: Flow; problems: string[]; versions: CrewVersion[];
  /** Next scheduled firings (ISO) of each saved chain. */
  next: Record<string, string[]>;
  palette: CrewAgent[]; approvalTools: { id: string; label: string }[];
  controls: boolean; maxSteps: number; maxChains: number; problem?: string;
  /** When the server read this, for the next firings of a draft chain. */
  now: number;
}
export interface CrewActions {
  save: (flow: Flow, note: string, confirmed: boolean) => Promise<ActionResult>;
  rollBack: (version: number, confirmed: boolean) => Promise<ActionResult>;
  runNow: (key: string) => Promise<ActionResult>;
  preview: (flow: Flow, key: string) => Promise<ActionResult & { steps?: ChainPreviewStep[] }>;
}

const DRAFT_KEY = "cr-crew-draft";
const OPS: Op[] = [">=", ">", "<=", "<", "="];
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
const WHEN_LABEL: Record<When, string> = { ok: "after it worked", failed: "after it failed", any: "either way" };
const money = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const ct = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const same = (a: Flow, b: Flow) => JSON.stringify(a) === JSON.stringify(b);
const readDraft = (): Flow | null => { try { const v = localStorage.getItem(DRAFT_KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeDraft = (f: Flow | null) => { try { if (f) localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked: the draft lives until reload */ } };

function startLine(s: Start, tools: CrewCanvasData["approvalTools"]) {
  if (s.type === "schedule") return `${s.days === "daily" ? "Every day" : "Weekdays"} at ${clock(s.time)}`;
  if (s.type === "button") return "When you press Run chain";
  return `When you ${s.decision === "any" ? "decide" : s.decision} ${tools.find((t) => t.id === s.tool)?.label ?? s.tool}`;
}
function stepLine(st: Step, k: number) {
  const bits: string[] = [];
  if (k > 0) bits.push(WHEN_LABEL[st.when ?? "ok"]);
  if (st.check) bits.push(`if ${st.check.metric} ${st.check.op} ${st.check.value}`);
  if (st.days === "weekdays") bits.push("weekdays");
  if (st.notBefore) bits.push(`not before ${clock(st.notBefore)}`);
  if (st.passAlong) bits.push("reads the hand-off");
  return bits;
}

// ---- canvas blocks

type BlockData = { title: string; sub: string; lines: string[]; icon: string; hue?: string; selected: boolean; dim?: boolean; tag?: string };
const handles = (
  <>
    <Handle id="l" type="target" position={Position.Left} isConnectable={false} />
    <Handle id="r" type="source" position={Position.Right} isConnectable={false} />
  </>
);
function Block({ data: d }: NodeProps<Node<BlockData>>) {
  return (
    <>
      {handles}
      <div className={`fnode${d.selected ? " sel" : ""}`} style={d.dim ? { opacity: 0.55 } : undefined}>
        <div className="node-h">
          <span className="node-ic" style={d.hue ? { background: d.hue, color: "#111114" } : undefined}><Icon name={d.icon} size={13} /></span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
          {d.tag && <span className="home-chip" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{d.tag}</span>}
        </div>
        <span className="fnode-line">{d.sub}</span>
        {d.lines.slice(0, 2).map((l) => <span key={l} className="fnode-line muted">{l}</span>)}
      </div>
    </>
  );
}
const NODE_TYPES = { block: Block };
const COL = 300, ROW = 150;

type Sel = { key: string; step: number | "start" } | null;

export function CrewCanvas({ d, actions }: { d: CrewCanvasData; actions: CrewActions }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Flow>(d.flow);
  const [sel, setSel] = useState<Sel>(d.flow.chains[0] ? { key: d.flow.chains[0].key, step: "start" } : null);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<(Confirm & { go: () => void }) | null>(null);
  const [preview, setPreview] = useState<{ key: string; text: string; steps: ChainPreviewStep[] } | null>(null);
  const [busy, start] = useTransition();
  const agents = useMemo(() => d.palette.map((a) => a.id), [d.palette]);
  const byId = useMemo(() => Object.fromEntries(d.palette.map((a) => [a.id, a])), [d.palette]);
  const name = (id: string) => byId[id]?.name ?? id;

  // a draft from an earlier visit comes back, unless it was made on another saved version
  useEffect(() => {
    const got = readDraft() as (Flow & { base?: number }) | null;
    if (got && got.base === d.version && Array.isArray(got.chains)) {
      const f = { chains: got.chains };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft lives in localStorage, read after hydration
      setDraft(f);
      if (f.chains[0]) setSel({ key: f.chains[0].key, step: "start" });
    }
  }, [d.version]);
  const change = (f: Flow) => { setDraft(f); writeDraft(same(f, d.flow) ? null : ({ ...f, base: d.version } as Flow)); };
  const dirty = !same(draft, d.flow);
  const problems = useMemo(() => flowProblems(draft, agents), [draft, agents]);
  const looser = useMemo(() => flowLooser(d.flow, draft), [d.flow, draft]);

  const chain = draft.chains.find((c) => c.key === sel?.key) ?? null;
  const saved = chain ? d.flow.chains.find((c) => c.key === chain.key) : undefined;
  const setChain = (c: Chain) => change({ chains: draft.chains.map((x) => (x.key === c.key ? c : x)) });
  const setStep = (k: number, st: Step) => chain && setChain({ ...chain, steps: chain.steps.map((x, i) => (i === k ? st : x)) });

  const addChain = () => {
    let n = draft.chains.length + 1, key = `chain-${n}`;
    while (draft.chains.some((c) => c.key === key)) key = `chain-${++n}`;
    const first = d.palette.find((a) => !a.buttonOnly) ?? d.palette[0];
    const c: Chain = { key, name: `New chain ${n}`, on: false, start: { type: "button" }, steps: first ? [{ agent: first.id }] : [] };
    change({ chains: [...draft.chains, c] });
    setSel({ key, step: "start" });
  };

  // ---- the graph
  const nodes = useMemo<Node[]>(() => draft.chains.flatMap((c, row): Node[] => [
    { id: `${c.key}:start`, type: "block", position: { x: 0, y: row * ROW }, width: 210, height: 116, draggable: false, connectable: false,
      data: { title: c.name, sub: startLine(c.start, d.approvalTools), lines: [c.on ? "On" : "Off: runs only with Run chain"], icon: c.start.type === "schedule" ? "clock" : c.start.type === "button" ? "play" : "shield-check", selected: sel?.key === c.key && sel.step === "start", dim: !c.on, tag: c.on ? "On" : "Off" } satisfies BlockData },
    ...c.steps.map((st, k): Node => {
      const a = byId[st.agent];
      return { id: `${c.key}:${k}`, type: "block", position: { x: (k + 1) * COL, y: row * ROW }, width: 210, height: 116, draggable: false, connectable: false,
        data: { title: a ? `${a.name}, ${a.role}` : st.agent, sub: `Step ${k + 1}${a?.avgCost != null ? ` · about ${money(a.avgCost)} a run` : ""}`, lines: [...stepLine(st, k), ...(a && !a.enabled ? ["Off duty: skipped, and the chain stops"] : [])], icon: a?.icon ?? "users", hue: a?.hue, selected: sel?.key === c.key && sel.step === k, dim: !c.on } satisfies BlockData };
    }),
  ]), [draft, sel, byId, d.approvalTools]);
  const edges = useMemo<Edge[]>(() => draft.chains.flatMap((c) => c.steps.map((st, k): Edge => ({
    id: `${c.key}:e${k}`, source: k === 0 ? `${c.key}:start` : `${c.key}:${k - 1}`, sourceHandle: "r", target: `${c.key}:${k}`, targetHandle: "l",
    type: "smoothstep", selectable: false, focusable: false, label: k === 0 ? undefined : st.check ? `${st.when ?? "ok"} · ${st.check.metric} ${st.check.op} ${st.check.value}` : (st.when ?? "ok"),
    labelStyle: { fontSize: 11, fill: "var(--ink2)" }, labelBgStyle: { fill: "var(--card)" },
    style: { stroke: c.on ? "var(--acc)" : "var(--mut2)", strokeWidth: 1.6, strokeDasharray: "5 6" },
  }))), [draft]);

  // ---- server actions
  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r); router.refresh();
  });
  const save = () => {
    const go = (confirmed: boolean) => run(() => actions.save(draft, note, confirmed), (r) => { if (r.ok) { writeDraft(null); setNote(""); } });
    if (looser.length) setConfirm({ title: "Save and let chains run on their own?", body: "Saving never turns an agent on. Each run still checks that the agent is on duty and under its daily budget, and a skipped step stops the chain.", lines: looser.map((l, i) => ({ k: i ? "" : "Changes", v: l })), confirmLabel: "Save flow", kind: "dark", go: () => go(true) });
    else go(false);
  };
  const rollBack = (v: CrewVersion) => {
    const go = (confirmed: boolean) => run(() => actions.rollBack(v.version, confirmed), (r) => { if (r.ok) writeDraft(null); });
    setConfirm({ title: `Make flow v${v.version} active again?`, body: v.on.length ? `These chains are on in v${v.version} and would run on their own: ${v.on.join(", ")}. Agents that are off duty are still skipped.` : `Every chain is off in v${v.version}, so nothing runs on its own.`, confirmLabel: "Roll back", kind: "dark", go: () => go(true) });
  };
  const runNow = (c: Chain) => setConfirm({
    title: `Run ${c.name} now?`, body: "Real runs, one after another, shown in Runs. An agent that is off duty is skipped and the chain stops there.",
    lines: c.steps.map((s, k) => ({ k: `Step ${k + 1}`, v: `${name(s.agent)}${byId[s.agent]?.enabled ? "" : " (off duty, skipped)"}${byId[s.agent]?.avgCost != null ? ` · about ${money(byId[s.agent].avgCost!)}` : ""}` })),
    confirmLabel: "Run chain", kind: "primary", go: () => run(() => actions.runNow(c.key)),
  });
  const doPreview = (c: Chain) => start(async () => {
    try { const r = await actions.preview(draft, c.key); setPreview({ key: c.key, text: r.text, steps: r.steps ?? [] }); if (!r.ok) setToast(r); }
    catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Preview failed." }); }
  });

  const perRun = chain ? chain.steps.reduce((s, st) => s + (byId[st.agent]?.avgCost ?? 0), 0) : 0;
  const unknownCost = chain ? chain.steps.some((st) => byId[st.agent]?.avgCost == null) : false;
  const draftNext = chain && chain.on ? nextFirings(chain, d.now, 3) : [];

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="pill sm" style={dirty ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : { background: "var(--soft)" }}>{dirty ? "Unsaved draft" : d.version ? `Flow v${d.version}` : "No saved flow"}</span>
        <span className="sub" style={{ flex: 1, minWidth: 200 }}>{d.note ? `v${d.version}: ${d.note}` : "Chains of agents. Click a block to change it."} The dispatcher checks every 15 minutes, Chicago time.</span>
        {dirty && <button className="btn ghost sm" onClick={() => { change(d.flow); setPreview(null); }}>Discard draft</button>}
        <button className="btn ghost sm" onClick={addChain} disabled={draft.chains.length >= d.maxChains}>Add chain</button>
      </div>
      {d.problem && <div className="card dashed" style={{ padding: 14, fontSize: 13 }}>{d.problem}</div>}
      {!!d.problems.length && <div className="card dashed" style={{ padding: 14, fontSize: 13 }}>Part of the saved flow was dropped and won’t run: {d.problems.join(" ")}</div>}

      {draft.chains.length > 0 ? (
        <>
          <div className="canvas flow-wide" style={{ height: Math.max(180, draft.chains.length * ROW + 30) }}>
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView fitViewOptions={{ padding: 0.08, maxZoom: 1 }} minZoom={0.4} maxZoom={1}
              nodesDraggable={false} nodesConnectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
              onNodeClick={(_, n) => { const [key, s] = n.id.split(":"); setSel({ key, step: s === "start" ? "start" : Number(s) }); }} />
          </div>
          <div className="flow-stack">
            {draft.chains.map((c) => (
              <button key={c.key} className="fnode-btn" aria-pressed={sel?.key === c.key} onClick={() => setSel({ key: c.key, step: "start" })}>
                <div className={`fnode${sel?.key === c.key ? " sel" : ""}`}>
                  <div className="node-h"><span style={{ flex: 1 }}>{c.name}</span><span className="home-chip" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{c.on ? "On" : "Off"}</span></div>
                  <span className="fnode-line">{startLine(c.start, d.approvalTools)}</span>
                  <span className="fnode-line muted">{c.steps.map((s) => name(s.agent)).join(", then ")}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="card dashed" style={{ padding: 28, alignItems: "center", textAlign: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>No chains yet</span>
          <span className="ink2" style={{ fontSize: 13 }}>A chain starts on a schedule, with the Run chain button, or when you decide an approval, then runs up to {d.maxSteps} agents in order.</span>
        </div>
      )}

      {chain && (
        <div className="card" style={{ gap: 16 }}>
          <div className="card-h" style={{ flexWrap: "wrap" }}>
            <span className="node-ic"><Icon name="git-pull-request" size={13} /></span>
            <input className="input" style={{ flex: 1, minWidth: 160, fontWeight: 600 }} value={chain.name} maxLength={60} aria-label="Chain name" onChange={(e) => setChain({ ...chain, name: e.target.value })} />
            <span className="row" style={{ gap: 8, fontSize: 13 }}>
              {chain.on ? "On" : "Off"}
              <button type="button" className={"switch" + (chain.on ? " on" : "")} aria-pressed={chain.on} title={chain.on ? "Turn the chain off: it then runs only with Run chain" : "Turn the chain on: it starts on its own. Agents still need to be on duty."} onClick={() => setChain({ ...chain, on: !chain.on })}><span /></button>
            </span>
          </div>

          <div className="ted-grid">
            <div className="ted-field">
              <span className="ted-k">Starts</span>
              <div className="seg" role="radiogroup" aria-label="Start">
                {(["schedule", "button", "approval"] as Start["type"][]).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={chain.start.type === t} className={chain.start.type === t ? "on" : ""}
                    onClick={() => setChain({ ...chain, start: t === "schedule" ? { type: "schedule", days: "weekdays", time: "06:00" } : t === "button" ? { type: "button" } : { type: "approval", tool: d.approvalTools[0]?.id ?? "", decision: "approve" } })}>
                    {t === "schedule" ? "Schedule" : t === "button" ? "Run button" : "Approval"}
                  </button>
                ))}
              </div>
              {chain.start.type === "schedule" && (
                <span className="row wrap" style={{ gap: 8 }}>
                  <select className="input sel-auto" value={chain.start.days} aria-label="Days" onChange={(e) => setChain({ ...chain, start: { ...(chain.start as Extract<Start, { type: "schedule" }>), days: e.target.value as Days } })}><option value="daily">Every day</option><option value="weekdays">Weekdays</option></select>
                  <select className="input sel-auto" value={chain.start.time} aria-label="Time" onChange={(e) => setChain({ ...chain, start: { ...(chain.start as Extract<Start, { type: "schedule" }>), time: e.target.value } })}>{QUARTERS.map((q) => <option key={q} value={q}>{clock(q)}</option>)}</select>
                </span>
              )}
              {chain.start.type === "approval" && (
                <span className="row wrap" style={{ gap: 8 }}>
                  <select className="input sel-auto" value={chain.start.decision} aria-label="Decision" onChange={(e) => setChain({ ...chain, start: { ...(chain.start as Extract<Start, { type: "approval" }>), decision: e.target.value as "approve" | "reject" | "any" } })}><option value="approve">You approve</option><option value="reject">You reject</option><option value="any">You decide either way</option></select>
                  <select className="input sel-auto" value={chain.start.tool} aria-label="Approval type" onChange={(e) => setChain({ ...chain, start: { ...(chain.start as Extract<Start, { type: "approval" }>), tool: e.target.value } })}>{d.approvalTools.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
                </span>
              )}
              <span className="sub">{chain.start.type === "schedule" ? "Chicago time, on a quarter hour. Only while the chain is on." : chain.start.type === "button" ? "Only when you press Run chain below." : "Once a minute at most, so approving twenty receipts starts it once. Only while the chain is on."}</span>
            </div>
            <div className="ted-field">
              <span className="ted-k">Cost</span>
              <span style={{ fontSize: 14 }}>About <b>{money(perRun)}</b> a run{unknownCost ? " (some agents have no real run yet)" : ""}{chain.on && runsPerMonth(chain) > 0 && <> · about <b>{money(perRun * runsPerMonth(chain))}</b> a month</>}</span>
              <span className="sub">From each agent’s last real runs. A step that is skipped or stops the chain costs nothing.</span>
              {chain.on && chain.start.type === "schedule" && <span className="sub">Next: {(saved && same({ chains: [saved] }, { chains: [chain] }) ? d.next[chain.key] ?? [] : draftNext.map((t) => new Date(t).toISOString())).map(ct).join(" · ") || "none"}</span>}
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {chain.steps.map((st, k) => {
              const prev = k > 0 ? byId[chain.steps[k - 1].agent] : undefined;
              const a = byId[st.agent];
              const open = sel?.step === k;
              return (
                <div key={k} className="card" style={{ gap: 10, padding: 14, background: open ? "var(--soft)" : undefined }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className="ted-k" style={{ minWidth: 52 }}>Step {k + 1}</span>
                    <select className="input" style={{ flex: 1, minWidth: 0, width: "auto" }} value={st.agent} aria-label={`Step ${k + 1} agent`} onChange={(e) => setStep(k, { ...st, agent: e.target.value, passAlong: undefined, ...(k === 0 ? { check: undefined } : {}) })}>
                      {d.palette.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.role}{p.enabled ? "" : " (off duty)"}{p.buttonOnly ? " · by hand only" : ""}</option>)}
                    </select>
                    <button type="button" className="btn ghost xs" disabled={k === 0} onClick={() => { const s = [...chain.steps]; [s[k - 1], s[k]] = [s[k], s[k - 1]]; setChain({ ...chain, steps: s }); }} title="Move up">Up</button>
                    <button type="button" className="btn ghost xs" disabled={chain.steps.length === 1} onClick={() => setChain({ ...chain, steps: chain.steps.filter((_, i) => i !== k) })}>Remove</button>
                  </div>
                  {k > 0 && (
                    <div className="row wrap" style={{ gap: 8, fontSize: 13 }}>
                      <span className="muted">Runs</span>
                      <select className="input sel-auto" value={st.when ?? "ok"} aria-label="When" onChange={(e) => setStep(k, { ...st, when: e.target.value as When })}>{(Object.keys(WHEN_LABEL) as When[]).map((w) => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}</select>
                      {prev && prev.metrics.length > 0 && (
                        st.check ? (
                          <>
                            <span className="muted">and only if</span>
                            <select className="input sel-auto" value={st.check.metric} aria-label="Number" onChange={(e) => setStep(k, { ...st, check: { ...st.check!, metric: e.target.value } })}>{prev.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
                            <select className="input sel-auto" value={st.check.op} aria-label="Comparison" onChange={(e) => setStep(k, { ...st, check: { ...st.check!, op: e.target.value as Op } })}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                            <input className="input" type="number" style={{ width: 80 }} value={st.check.value} aria-label="Value" onChange={(e) => setStep(k, { ...st, check: { ...st.check!, value: Number(e.target.value) } })} />
                            <button type="button" className="btn ghost xs" onClick={() => setStep(k, { ...st, check: undefined })}>No check</button>
                          </>
                        ) : <button type="button" className="btn ghost xs" onClick={() => setStep(k, { ...st, check: { metric: prev.metrics[0].key, op: ">", value: 0 } })}>Add a check on {prev.name}’s numbers</button>
                      )}
                    </div>
                  )}
                  <div className="row wrap" style={{ gap: 8, fontSize: 13 }}>
                    <span className="muted">On</span>
                    <select className="input sel-auto" value={st.days ?? "daily"} aria-label="Days" onChange={(e) => setStep(k, { ...st, days: e.target.value === "daily" ? undefined : (e.target.value as Days) })}><option value="daily">any day</option><option value="weekdays">weekdays only</option></select>
                    {k > 0 && <>
                      <span className="muted">not before</span>
                      <select className="input sel-auto" value={st.notBefore ?? ""} aria-label="Not before" onChange={(e) => setStep(k, { ...st, notBefore: e.target.value || undefined })}><option value="">no wait</option>{QUARTERS.map((q) => <option key={q} value={q}>{clock(q)}</option>)}</select>
                    </>}
                    {k > 0 && a?.takesHandoff && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!st.passAlong} onChange={(e) => setStep(k, { ...st, passAlong: e.target.checked || undefined })} />Pass {prev?.name ?? "the step before"}’s summary along</label>}
                  </div>
                  {a && !a.enabled && <span className="sub">{a.name} is off duty, so this step is skipped and the chain stops here until you turn {a.name} on.</span>}
                </div>
              );
            })}
            {chain.steps.length < d.maxSteps && (
              <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { const next = d.palette.find((p) => !chain.steps.some((s) => s.agent === p.id)); if (next) setChain({ ...chain, steps: [...chain.steps, { agent: next.id, when: "ok" }] }); }}>Add an agent after {name(chain.steps[chain.steps.length - 1]?.agent ?? "")}</button>
            )}
          </div>

          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => doPreview(chain)} title="Dry-runs each step on real data. No writes, no model, no cost, nothing logged.">Preview chain</button>
            <button className="btn primary sm" disabled={busy || !saved || !d.controls} onClick={() => saved && runNow(saved)} title={!saved ? "Save the chain first" : !d.controls ? "DASHBOARD_CONTROLS is off" : "Real runs of the saved chain"}>Run chain</button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={() => { change({ chains: draft.chains.filter((c) => c.key !== chain.key) }); setSel(null); }}>Delete chain</button>
          </div>
          {saved && !same({ chains: [saved] }, { chains: [chain] }) && <span className="sub">Run chain runs the saved version of this chain. Save to run your changes.</span>}

          {preview?.key === chain.key && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="sub">{preview.text}</span>
              {preview.steps.map((p, i) => (
                <div key={i} className="card" style={{ gap: 6, padding: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}: {p.name}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.5 }}><Summary text={p.summary} /></span>
                  <span className="sub">{p.next}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ gap: 12 }}>
        <div className="card-h"><span className="card-t">Save</span><span className="sub" style={{ flex: 1 }}>Saves the whole canvas as a new flow version. You can roll back to any version.</span></div>
        {dirty && problems.length > 0 && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{problems.join(" ")}</div>}
        {dirty && looser.length > 0 && <span className="sub">Needs a confirm{d.controls ? "" : " and DASHBOARD_CONTROLS=on"}: {looser.join("; ")}.</span>}
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Why (shows in the version list)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <button className="btn dark sm" disabled={busy || !dirty || problems.length > 0 || !note.trim() || (looser.length > 0 && !d.controls)} onClick={save}>Save flow</button>
        </div>
      </div>

      {d.versions.length > 0 && (
        <div className="card" style={{ gap: 0 }}>
          <div className="card-h" style={{ marginBottom: 6 }}><span className="card-t">Versions</span></div>
          {d.versions.map((v) => (
            <div key={v.version} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 13 }}>
              <span style={{ fontWeight: 600, minWidth: 34 }}>v{v.version}</span>
              <span style={{ flex: 1, minWidth: 180 }}>{v.note ?? ""} <span className="muted">· {v.chains} chain{v.chains === 1 ? "" : "s"}, {v.on.length ? `on: ${v.on.join(", ")}` : "all off"} · {v.createdBy} · {ct(v.createdAt)}</span></span>
              {v.active ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Active</span> : <button className="btn ghost xs" disabled={busy} onClick={() => rollBack(v)}>Roll back</button>}
            </div>
          ))}
        </div>
      )}

      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
