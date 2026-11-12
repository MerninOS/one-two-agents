"use client";
// The agent canvas (docs/agent-setup.md): the run canvas as a node graph, with two modes.
// Replay shows what the latest run did; Edit shows the agent's setup, box by box. Clicking a
// box lists every value behind it and where that value lives. In Edit, a box marked editable
// opens its editor (Thinking for agents with a menu: ThinkingEditor.tsx); the rest are read-only.
// The server builds the whole model (dashboard/canvas.ts); nothing here reads data.
import { useMemo, useState } from "react";
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon } from "./Icon";
import { ThinkingEditor, type ThinkingEditorData } from "./ThinkingEditor";
import { Summary } from "./ui";

export type HomeId = "app" | "code" | "vercel" | "database";
export type BoxId = "trigger" | "memory" | "reads" | "thinking" | "guardrails" | "writes";

export interface CanvasRow {
  label: string;
  value: string;
  home: HomeId;
  /** Where to look, or where to change it. */
  where: string;
  status?: "ok" | "missing";
  /** Longer text shown under a "Show" toggle: the full instructions, the list of rules. */
  long?: string;
}
export interface CanvasBox {
  id: BoxId;
  title: string;
  icon: string;
  /** Lines on the node in Replay. */
  replay: string[];
  replayFoot?: string;
  /** Lines on the node in Edit. */
  edit: string[];
  /** True when Edit mode can change this box here. */
  editable?: boolean;
  rows: CanvasRow[];
}
export interface CanvasResult { big: string; label: string; text: string; foot: string; pct: number; href?: string }
export interface CanvasModel {
  agentName: string;
  /** False for an agent that has no menu yet: its values are all still in code. */
  hasMenu: boolean;
  versionLabel: string;
  versionNote?: string;
  problem?: string;
  /** True while the latest run is still going. */
  live: boolean;
  hasRun: boolean;
  boxes: CanvasBox[];
  result: CanvasResult;
}

type Mode = "replay" | "edit";

export const HOME: Record<HomeId, { label: string; bg: string; fg: string; about: string }> = {
  app: { label: "App", bg: "var(--acc-soft)", fg: "var(--acc-ink)", about: "Belongs to the Control Room: already editable there, or it will be as each box becomes editable" },
  code: { label: "Code", bg: "var(--soft)", fg: "var(--ink2)", about: "Fixed in the repo; changes with a pull request" },
  vercel: { label: "Vercel", bg: "var(--mint-soft)", fg: "var(--mint-ink)", about: "A key or setting in Vercel; never shown here" },
  database: { label: "Database", bg: "var(--yel-soft)", fg: "var(--yel-ink)", about: "A row in Supabase with no screen yet" },
};

const POS: Record<BoxId, { x: number; y: number; w: number }> = {
  trigger: { x: 0, y: 0, w: 200 }, memory: { x: 0, y: 170, w: 200 },
  reads: { x: 260, y: 0, w: 220 }, thinking: { x: 260, y: 170, w: 220 },
  guardrails: { x: 540, y: 0, w: 220 }, writes: { x: 540, y: 170, w: 220 },
};
const EDGES: [string, string, string, string][] = [
  ["trigger", "b", "memory", "t"], ["memory", "r", "reads", "l"], ["reads", "b", "thinking", "t"],
  ["thinking", "r", "writes", "l"], ["guardrails", "b", "writes", "t"], ["writes", "r", "result", "l"],
];

const mix = (rows: CanvasRow[]) => (["app", "database", "code", "vercel"] as HomeId[]).filter((h) => rows.some((r) => r.home === h));
const HomeChip = ({ h }: { h: HomeId }) => <span className="home-chip" style={{ background: HOME[h].bg, color: HOME[h].fg }}>{HOME[h].label}</span>;

function BoxBody({ box, mode, selected }: { box: CanvasBox; mode: Mode; selected: boolean }) {
  const lines = mode === "replay" ? box.replay : box.edit;
  return (
    <div className={`fnode${selected ? " sel" : ""}`}>
      <div className="node-h"><span className="node-ic"><Icon name={box.icon} size={13} /></span><span style={{ flex: 1 }}>{box.title}</span>{mode === "edit" && box.editable && <span className="home-chip" style={{ background: "var(--acc)", color: "#111114" }}>Edit</span>}</div>
      {lines.slice(0, 3).map((l) => <span key={l} className="fnode-line">{l}</span>)}
      <span style={{ flex: 1 }} />
      {mode === "replay"
        ? <span className="muted" style={{ fontSize: 11.5 }}>{box.replayFoot ?? ""}</span>
        : <span className="row wrap" style={{ gap: 4 }}>{mix(box.rows).map((h) => <HomeChip key={h} h={h} />)}</span>}
    </div>
  );
}

function ResultBody({ m, mode }: { m: CanvasModel; mode: Mode }) {
  if (mode === "edit") {
    return (
      <div className="fnode out">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Setup</span>
        <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>{m.versionLabel}</span>
        <span className="fnode-out-text">{m.versionNote ?? (m.hasMenu ? "No saved version yet. Every value is the built-in default." : `${m.agentName}’s values are all still in code. Its menu comes later.`)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "#B9B9C2" }}>{m.boxes.some((b) => b.editable) ? "Boxes marked Edit can be changed here. The rest arrive box by box." : "Read-only for now. Editing arrives box by box."}</span>
      </div>
    );
  }
  const r = m.result;
  return (
    <div className="fnode out">
      <span style={{ fontSize: 13, fontWeight: 600 }}>Run result</span>
      <span className="row" style={{ alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>{r.big}</span><span style={{ color: "#B9B9C2", fontSize: 13 }}>{r.label}</span></span>
      <span className="fnode-out-text"><Summary text={r.text} /></span>
      <span style={{ flex: 1 }} />
      <div className="progress"><div style={{ width: `${r.pct}%` }} /></div>
      <span style={{ fontSize: 11.5, color: "#B9B9C2" }}>{r.foot}</span>
    </div>
  );
}

type BoxData = { box: CanvasBox; mode: Mode; selected: boolean };
type ResultData = { m: CanvasModel; mode: Mode };

const handles = (
  <>
    <Handle id="t" type="target" position={Position.Top} isConnectable={false} />
    <Handle id="l" type="target" position={Position.Left} isConnectable={false} />
    <Handle id="b" type="source" position={Position.Bottom} isConnectable={false} />
    <Handle id="r" type="source" position={Position.Right} isConnectable={false} />
  </>
);
const BoxNode = ({ data }: NodeProps<Node<BoxData>>) => <>{handles}<BoxBody {...data} /></>;
const ResultNode = ({ data }: NodeProps<Node<ResultData>>) => <>{handles}<ResultBody {...data} /></>;
const NODE_TYPES = { box: BoxNode, result: ResultNode };

function Detail({ box, m }: { box: CanvasBox; m: CanvasModel }) {
  return (
    <div className="card" style={{ gap: 0 }}>
      <div className="card-h" style={{ marginBottom: 4 }}>
        <span className="node-ic"><Icon name={box.icon} size={13} /></span>
        <span className="card-t">{box.title}</span>
        <span className="sub">{m.agentName} · {box.rows.length} value{box.rows.length === 1 ? "" : "s"}</span>
      </div>
      {box.rows.map((r) => (
        <div key={r.label + r.value} className="setup-row">
          <span className="setup-k">{r.label}</span>
          <span className="setup-v">
            <span>{r.value}</span>
            {r.long && <details><summary>Show</summary><span className="setup-long">{r.long}</span></details>}
          </span>
          <span className="setup-w">
            <span className="row wrap" style={{ gap: 6 }}>
              <HomeChip h={r.home} />
              {r.status && <span className="pill sm" style={r.status === "ok" ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--red-soft)", color: "var(--red-ink)" }}>{r.status === "ok" ? "Connected" : "Missing key"}</span>}
            </span>
            <span className="sub">{r.where}</span>
          </span>
        </div>
      ))}
      {!box.rows.length && <span className="muted" style={{ fontSize: 13.5, padding: "12px 0" }}>Nothing to show for this box.</span>}
    </div>
  );
}

export function AgentCanvas({ model, start = "edit", editor }: { model: CanvasModel; start?: Mode; editor?: ThinkingEditorData | null }) {
  const [mode, setMode] = useState<Mode>(start);
  const [sel, setSel] = useState<BoxId>("thinking");
  const box = model.boxes.find((b) => b.id === sel) ?? model.boxes[0];

  const nodes = useMemo<Node[]>(() => [
    ...model.boxes.map((b): Node => ({ id: b.id, type: "box", position: POS[b.id], width: POS[b.id].w, height: 140, data: { box: b, mode, selected: b.id === sel }, draggable: false, connectable: false })),
    { id: "result", type: "result", position: { x: 820, y: 35 }, width: 220, height: 240, data: { m: model, mode }, draggable: false, connectable: false, selectable: false },
  ], [model, mode, sel]);
  const edges = useMemo<Edge[]>(() => EDGES.map(([s, sh, t, th]) => ({
    id: `${s}-${t}`, source: s, sourceHandle: sh, target: t, targetHandle: th, type: "smoothstep", selectable: false, focusable: false,
    style: { stroke: mode === "replay" && model.hasRun && s !== "guardrails" ? "var(--acc)" : "var(--mut2)", strokeWidth: 1.6, strokeDasharray: "5 6" },
  })), [mode, model.hasRun]);

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="seg" role="tablist" aria-label="Canvas mode">
          {(["replay", "edit"] as Mode[]).map((k) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{k === "replay" ? "Replay" : "Edit"}</button>)}
        </div>
        <span className="sub" style={{ flex: 1, minWidth: 180 }}>{mode === "replay" ? (model.hasRun ? "What the latest run did." : "No real run yet. Dry runs aren’t logged.") : `${model.versionLabel}. Click a box to see every value behind it and where it lives.${editor ? " Thinking can be edited." : ""}`}</span>
        <span className="row wrap" style={{ gap: 6 }}>{(Object.keys(HOME) as HomeId[]).map((h) => <span key={h} title={HOME[h].about}><HomeChip h={h} /></span>)}</span>
      </div>
      {model.problem && <div className="card dashed" style={{ padding: 14, fontSize: 13 }}>{model.problem}</div>}

      <div className="canvas flow-wide">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView fitViewOptions={{ padding: 0.06 }} minZoom={0.4} maxZoom={1}
          nodesDraggable={false} nodesConnectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
          onNodeClick={(_, n) => { if (n.id !== "result") setSel(n.id as BoxId); }} />
      </div>

      {/* phones: the same boxes as a stack, like the Live floor */}
      <div className="flow-stack">
        {model.boxes.map((b) => <button key={b.id} className="fnode-btn" aria-pressed={b.id === sel} onClick={() => setSel(b.id)}><BoxBody box={b} mode={mode} selected={b.id === sel} /></button>)}
        <ResultBody m={model} mode={mode} />
      </div>

      {mode === "edit" && box.id === "thinking" && editor && <ThinkingEditor key={`${editor.agentId}:${editor.active.version}`} d={editor} />}
      <Detail box={box} m={model} />
    </div>
  );
}
