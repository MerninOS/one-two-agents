// The "Live floor" workflow canvas from Run Canvas.dc.html, filled from one real run.
// Nodes the backend can't fill yet (gateway decisions) say so instead of showing samples.
import { HARD_RULES, type CrewMember } from "../crew";
import type { Reach } from "../connections";
import type { Run } from "../data";
import { dur, m4, num, when } from "../format";
import { RUN_LOOK, isLive } from "../status";
import { Icon } from "./Icon";
import { Summary } from "./ui";

const MEM_NAME: Record<string, string> = { crew: "Crew memory", standing_order: "Standing orders", note: "Zak’s notes", lesson: "Lessons", working: "Working memory" };

const NodeHead = ({ icon, title, tone }: { icon?: string; title: string; tone?: string }) => (
  <div className="node-h">
    {icon && <span className="node-ic" style={tone ? { background: tone } : undefined}><Icon name={icon} size={13} /></span>}
    <span style={{ flex: 1 }}>{title}</span>
  </div>
);
const Line = ({ c, children, mut }: { c: string; children: React.ReactNode; mut?: boolean }) => (
  <span className="node-line" style={mut ? { color: "var(--mut)" } : undefined}><span className="dot" style={{ background: c, width: 6, height: 6 }} />{children}</span>
);

export function RunCanvas({ a, run, leads, reach }: { a: CrewMember; run: Run | null; leads?: number | null; reach: Reach[] }) {
  const live = !!run && isLive(run);
  const stage = !run ? 0 : live ? 3 : 6;
  const o = (i: number) => (stage >= i ? 1 : 0.38);
  const c = (i: number) => (stage > i ? "var(--acc)" : "var(--mut2)");
  const reads = reach.filter((r) => r.has.includes("read")).map((r) => r.conn);
  const writes = reach.filter((r) => r.has.some((h) => h !== "read"));
  const usesModel = !!run && run.tokens_in + run.tokens_out > 0;
  const look = run ? RUN_LOOK[run.status] : null;
  const resultBig = !run ? "—" : a.id === "wholesale_hunter" && leads != null ? String(leads) : look!.label;
  const mem = run?.memory_json ?? null;
  const memLines = mem ? Object.entries(mem.groups).filter(([, v]) => v.lines > 0) : [];
  const pagesRead = (mem?.pages ?? []).filter((p) => !p.problem).length;
  const pagesFailed = (mem?.pages ?? []).filter((p) => p.problem).length;
  const resultLabel = a.id === "wholesale_hunter" && leads != null && run ? "new leads" : "";

  return (
    <div className="canvas">
      <div className="canvas-inner">
        <svg width="1064" height="360" viewBox="0 0 1064 360" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} fill="none">
          {[["M124 136 L124 184", 0], ["M224 259 H254 V80 H284", 1], ["M394 136 L394 184", 2], ["M504 259 L544 259", 3], ["M764 259 H792 V180 H820", 4]].map(([d, i]) => (
            <path key={d} d={d as string} stroke={c(i as number)} strokeWidth="1.6" strokeDasharray="5 6" strokeLinecap="round" />
          ))}
          <path d="M654 136 L654 184" stroke="var(--mut2)" strokeWidth="1.6" strokeDasharray="5 6" strokeLinecap="round" />
          {[[124, 184, 0], [284, 80, 1], [394, 184, 2], [544, 259, 3], [820, 180, 4]].map(([x, y, i]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill={c(i)} />)}
        </svg>

        <div className="node" style={{ left: 24, top: 24, width: 200, height: 112, opacity: o(0) }}>
          <NodeHead icon="play" title="Trigger" />
          <Line c="var(--acc)">{!run ? "No real run yet" : run.trigger === "manual" ? "Zak pressed Run" : run.trigger === "approval" ? "Zak approved changes" : "Vercel Schedule"}</Line>
          <Line c="var(--mut2)" mut>{run ? `Real run · ${when(run.started_at)} CT` : "Dry runs aren’t logged"}</Line>
        </div>

        <div className="node" style={{ left: 24, top: 184, width: 200, height: 150, opacity: o(1), boxShadow: "-16px -10px 40px -8px var(--glowA), 18px 14px 44px -8px var(--glowB)" }}>
          <NodeHead icon="brain" title="Memory" tone="var(--acc-soft)" />
          {mem ? (
            <>
              {memLines.slice(0, 3).map(([g, v], k) => <Line key={g} c={["var(--acc)", "var(--pink)", "var(--yel)"][k]}>{MEM_NAME[g] ?? g} · {v.lines}</Line>)}
              {!memLines.length && <Line c="var(--mut2)" mut>Nothing in memory yet</Line>}
              {pagesRead > 0 && <Line c="var(--acc)">{pagesRead} Notion page{pagesRead === 1 ? "" : "s"}</Line>}
              <span style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 11.5 }}>{num(mem.tokens)} of {num(mem.budget)} tokens{mem.dropped ? ` · ${mem.dropped} left out` : ""}{pagesFailed ? ` · ${pagesFailed} page${pagesFailed === 1 ? "" : "s"} skipped` : ""}</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45 }}>{!run ? "Loads its memory when it runs." : a.model?.startsWith("claude") ? "This run loaded no memory." : "No model, so no memory to load."}</span>
              <span style={{ flex: 1 }} />
              <a href={`/agents/${a.id}?tab=memory`} className="muted" style={{ fontSize: 11.5 }}>Open memory</a>
            </>
          )}
        </div>

        <div className="node" style={{ left: 284, top: 24, width: 220, height: 112, opacity: o(2) }}>
          <NodeHead icon="shopping-bag" title="Facts · reads" />
          {reads.slice(0, 3).map((i, k) => <Line key={i.id} c={["var(--mint)", "var(--yel)", "var(--pink)"][k]}>{i.name}</Line>)}
          {!reads.length && <Line c="var(--mut2)" mut>No reads</Line>}
        </div>

        <div className="node" style={{ left: 284, top: 184, width: 220, height: 150, opacity: o(3), boxShadow: live ? "0 0 0 2px var(--acc)" : undefined, animation: live ? "acrPulse 2.4s ease-in-out infinite" : undefined }}>
          <NodeHead icon="cpu" title={usesModel || a.model?.startsWith("claude") ? "Thinking" : "Computing"} />
          <span style={{ color: "var(--ink2)" }}>{a.model}</span>
          {a.id === "bookkeeper" && <div className="row wrap" style={{ gap: 6 }}><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>read receipt</span><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>pick category</span></div>}
          {a.id === "wholesale_hunter" && <div className="row wrap" style={{ gap: 6 }}><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>web_search</span><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>web_fetch</span></div>}
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 11.5 }}>{run ? (usesModel ? `${num(run.tokens_in)} in · ${num(run.tokens_out)} out` : "No model tokens") : "—"}</span>
        </div>

        <div className="node" style={{ left: 544, top: 24, width: 220, height: 112, gap: 7 }}>
          <div className="node-h"><span style={{ flex: 1 }}>Guardrails</span><span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>from Zak</span></div>
          <Line c="var(--ink2)">{HARD_RULES.length} hard rules, locked</Line>
          <Line c="var(--ink2)">Daily budget enforced by withRun</Line>
        </div>

        <div className="node" style={{ left: 544, top: 184, width: 220, height: 150, opacity: o(4) }}>
          <NodeHead icon="shield-check" title="Writes" />
          {writes.slice(0, 3).map((w) => <Line key={w.conn.id} c="var(--acc)">{w.conn.name}{w.has.includes("do") ? " · asks first" : ""}</Line>)}
          <span style={{ flex: 1 }} />
          <span className="later" style={{ alignSelf: "flex-start" }}>GATEWAY LOG COMING LATER</span>
        </div>

        <div className="node out" style={{ left: 820, top: 60, width: 220, height: 240, gap: 10, opacity: o(5) }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Run result</span>
          <span className="row" style={{ alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>{live ? "…" : resultBig}</span><span style={{ color: "#B9B9C2", fontSize: 13 }}>{resultLabel}</span></span>
          <span style={{ color: "#D6D6DC", fontSize: 12.5, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{run ? <Summary text={run.error ?? run.summary} /> : "Press Dry run on a profile to check the plumbing for free."}</span>
          <span style={{ flex: 1 }} />
          <div className="progress"><div style={{ width: `${run ? (live ? 50 : 100) : 0}%` }} /></div>
          <span style={{ fontSize: 11.5, color: "#B9B9C2" }}>{!run ? "Waiting for the first run" : live ? "Working now" : `${run.status === "failed" ? "Failed after" : "Done in"} ${dur(run.started_at, run.ended_at)} · ${m4(run.cost_usd)}`}</span>
        </div>
      </div>
    </div>
  );
}
