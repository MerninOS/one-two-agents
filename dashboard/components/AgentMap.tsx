// Draws the agent map (dashboard/agentMap.ts): a column per stage, a box per thing the agent reads,
// thinks with or hands you, and lines between them. Each box links to the step that changes it when
// the map is editable. With `draw`, it builds itself box by box (the moment after a save); "reduce
// motion" shows it at once. Phones get the columns stacked, without lines.
import Link from "next/link";
import type { AgentMapModel, MapNode } from "../agentMap";

// laid out on a 1220-wide grid, then stretched to the space there is (columns and lines in %), so
// it fits the page down to its minimum width and scrolls inside its box below that
const COL_W = 200, GAP = 45, PAD = 20, TOP = 40, NODE_H = 100, BRAIN_H = 164, V_GAP = 14;
const pct = (v: number, W: number) => `${(v / W) * 100}%`;
const nodeH = (n: MapNode) => (n.look === "brain" ? BRAIN_H : NODE_H);

export function AgentMap({ m, draw, foot }: { m: AgentMapModel; draw?: boolean; foot?: React.ReactNode }) {
  const colH = m.cols.map((c) => c.nodes.reduce((s, n) => s + nodeH(n), 0) + V_GAP * Math.max(0, c.nodes.length - 1));
  const inner = Math.max(...colH, BRAIN_H);
  const H = TOP + inner + PAD;
  const W = PAD * 2 + m.cols.length * COL_W + (m.cols.length - 1) * GAP;

  // where each box sits, for the lines
  const at: Record<string, { x: number; y: number; h: number; col: number; n: MapNode }> = {};
  m.cols.forEach((c, i) => {
    let y = TOP + (inner - colH[i]) / 2;
    for (const n of c.nodes) { at[n.id] = { x: PAD + i * (COL_W + GAP), y, h: nodeH(n), col: i, n }; y += nodeH(n) + V_GAP; }
  });
  const edgeLook = (a: MapNode, b: MapNode) => (b.state === "failed" ? "fail" : a.state === "unused" || b.state === "unused" ? "dim" : b.state === "live" ? "live" : m.run && (b.state === "ok" || a.state === "ok") ? "done" : "");

  return (
    <div className={`am${draw ? " am-draw" : ""}`}>
      <div className="am-scroll">
        <div className="am-inner" style={{ height: H }}>
          <svg className="am-lines" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {m.edges.map((e) => {
              const a = at[e.from], b = at[e.to];
              if (!a || !b) return null;
              const x1 = a.x + COL_W, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
              return <path key={`${e.from}>${e.to}`} className={`am-line ${edgeLook(a.n, b.n)}`} style={{ "--i": a.col } as React.CSSProperties} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} />;
            })}
          </svg>
          {m.cols.map((c, i) => (
            <section key={c.key} className="am-col" style={{ left: pct(PAD + i * (COL_W + GAP), W), width: pct(COL_W, W), height: H }} aria-label={c.title}>
              <span className="am-col-t">{c.title}</span>
              {c.nodes.map((n, k) => {
                const p = at[n.id];
                const body = (
                  <>
                    {n.state === "ok" && <span className="am-badge ok" role="img" aria-label="worked">✓</span>}
                    {n.state === "failed" && <span className="am-badge fail" role="img" aria-label="failed">✕</span>}
                    {n.kicker && <span className="am-k">{n.kicker}</span>}
                    {n.title && <span className="am-t">{n.title}</span>}
                    {n.sub && <span className="am-s">{n.sub}</span>}
                    {n.foot && <span className="am-f">{n.foot}</span>}
                  </>
                );
                const cls = `am-node look-${n.look}${n.state ? ` st-${n.state}` : ""}`;
                const style = { top: p.y, height: p.h, "--i": i, "--k": k } as React.CSSProperties;
                return n.href
                  ? <Link key={n.id} href={n.href} className={cls} style={style}>{body}</Link>
                  : <div key={n.id} className={cls} style={style}>{body}</div>;
              })}
            </section>
          ))}
        </div>
      </div>
      {foot}
    </div>
  );
}
