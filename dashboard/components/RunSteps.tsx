// One run of an agent built in the app, step by step: each model turn and each tool call, with the
// numbers code computed. Used on the builder screen (docs/agent-builder.md).
import type { BuildRun } from "@/dashboard/builder";
import { m4, num } from "@/dashboard/format";

export function RunSteps({ run }: { run: BuildRun }) {
  if (!run.steps.length) return <span className="sub">No steps recorded.</span>;
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
      {run.steps.map((s) => (
        <li key={s.idx} className="rule" style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="row wrap" style={{ gap: 8, fontSize: 13.5 }}>
            <span style={{ fontWeight: 600, minWidth: 22 }}>{s.idx + 1}</span>
            {s.kind === "model" && <span>Model thought{s.output ? "" : " and picked tools"}</span>}
            {s.kind === "tool" && <span>{s.toolLabel}</span>}
            {s.kind === "stop" && <span style={{ color: "var(--red-ink)" }}>{s.output}</span>}
            {s.kind === "tool" && !s.ok && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Failed</span>}
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {s.kind === "model" ? `${num(s.tokens_in)} in · ${num(s.tokens_out)} out · ${m4(s.cost_usd)}` : s.kind === "tool" ? `${(s.ms / 1000).toFixed(1)}s` : ""}
            </span>
          </div>
          {s.kind === "tool" && s.input != null && Object.keys(s.input as object).length > 0 && <span className="muted" style={{ fontSize: 12, paddingLeft: 30 }}>Input: {JSON.stringify(s.input)}</span>}
          {s.numbers && Object.keys(s.numbers).length > 0 && <span style={{ fontSize: 12.5, paddingLeft: 30 }}>Numbers from code: {Object.entries(s.numbers).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}</span>}
          {s.output && s.kind !== "stop" && (
            <details style={{ paddingLeft: 30, fontSize: 12.5 }}>
              <summary className="muted" style={{ cursor: "pointer" }}>{s.kind === "model" ? "What it wrote" : "What came back"}</summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0", fontSize: 12, maxHeight: 260, overflow: "auto" }}>{s.output}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
