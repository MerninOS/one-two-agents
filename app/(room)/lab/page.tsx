import { dryRunBuilt, previewBuilt } from "@/dashboard/actions";
import { getLab, type LabRun } from "@/dashboard/lab";
import { controlsOn } from "@/dashboard/session";
import { m4, num, when } from "@/dashboard/format";
import { ActionButton, DryRun } from "@/dashboard/components/client";

// Agent builder, slice 1: a test page for the runner (docs/agent-builder.md). It shows each agent
// built in the app (so far only the scratch agent), its spec and tools, and its latest runs step
// by step. The builder screen replaces it in slice 2.

const KIND: Record<string, string> = { read: "Read", calculate: "Calculate", report: "Report", action: "Action" };
const kindStyle = (k: string) => (k === "calculate" ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : { background: "var(--mint-soft)", color: "var(--mint-ink)" });

function Steps({ run }: { run: LabRun }) {
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

export default async function Lab() {
  const lab = await getLab();
  const controls = controlsOn();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1">Runner test</h1>
        <span className="sub">Agent builder, slice 1. Agents built in the app run on one shared engine: the model picks tools from the list it was given, code runs them, and hard limits stop it. So far there is only a scratch agent to try it on. The builder screen comes next.</span>
      </div>
      {lab == null && <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>}
      {lab?.agents.length === 0 && <div className="card"><span className="sub">No agents built in the app yet.</span></div>}
      {lab?.agents.map((a) => {
        const s = a.spec?.spec;
        return (
          <div key={a.id} className="stack" style={{ gap: 16 }}>
            <div className="card" style={{ gap: 14 }}>
              <div className="row wrap" style={{ gap: 10 }}>
                <span className="card-t" style={{ fontSize: 18 }}>{s?.name ?? a.name}</span>
                <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{a.enabled ? "On duty" : "Off duty"}</span>
                {a.spec && <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Spec v{a.spec.version}</span>}
              </div>
              {a.specError && <span className="sub" style={{ color: "var(--red-ink)" }}>{a.specError}</span>}
              {a.spec?.problems.length ? <span className="sub" style={{ color: "var(--red-ink)" }}>Spec problems: {a.spec.problems.join("; ")}</span> : null}
              {s && (
                <>
                  <div className="stack" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 12 }}>Directive</span><span style={{ fontSize: 14, lineHeight: 1.5 }}>{s.directive}</span></div>
                  {s.goodResult && <div className="stack" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 12 }}>A good result</span><span style={{ fontSize: 14, lineHeight: 1.5 }}>{s.goodResult}</span></div>}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, fontSize: 14 }}>
                    <div className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Model</span>{s.model}, {s.effort} effort</div>
                    <div className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Steps per run</span>up to {s.limits.maxSteps}</div>
                    <div className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Cost per run</span>up to ${s.limits.maxCostUsd.toFixed(2)}</div>
                    <div className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Daily budget</span>${a.budget.toFixed(2)}</div>
                  </div>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="muted" style={{ fontSize: 12, paddingBottom: 4 }}>Tools it may call</span>
                    {a.tools.map((t) => (
                      <div key={t.id} className="row wrap rule" style={{ gap: 8, padding: "9px 0", fontSize: 14 }}>
                        <span style={{ flex: "1 1 220px" }}>{t.label}<span className="muted" style={{ display: "block", fontSize: 12 }}>{t.detail}</span></span>
                        <span className="pill sm" style={kindStyle(t.kind)}>{KIND[t.kind]}</span>
                        {!t.trusted && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Untrusted</span>}
                        <span className="muted" style={{ fontSize: 12, minWidth: 80, textAlign: "right" }}>{t.connected ? "Connected" : "Missing key"}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="row wrap" style={{ gap: 10 }}>
                <DryRun action={dryRunBuilt.bind(null, a.id)} />
                <ActionButton className="btn dark" disabled={!controls || !s || !!a.spec?.problems.length} title={controls ? undefined : "Needs DASHBOARD_CONTROLS=on"} action={previewBuilt.bind(null, a.id)}
                  busyLabel="Exploring…"
                  confirm={{ title: "Run a preview?", body: `A real explore run on ${s?.model ?? "the model"}: it reads live data and calls the model, up to ${s?.limits.maxSteps ?? 0} tool calls and $${(s?.limits.maxCostUsd ?? 0).toFixed(2)}. Nothing is written or sent.`, confirmLabel: "Run preview" }}>
                  Preview · explore run
                </ActionButton>
              </div>
              {!controls && <span className="sub">Preview needs DASHBOARD_CONTROLS=on, since it spends money. The tool check is free.</span>}
            </div>

            <div className="card" style={{ gap: 10 }}>
              <span className="card-t">Latest runs</span>
              {!a.runs.length && <span className="sub">None yet. Press Preview to try one.</span>}
              {a.runs.map((r, i) => (
                <details key={r.id} open={i === 0} className={i ? "rule" : undefined} style={{ paddingTop: i ? 10 : 0 }}>
                  <summary style={{ cursor: "pointer", fontSize: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{when(r.started_at)}</span>
                    <span className="muted">{r.status}</span>
                    <span className="muted">{r.steps.filter((x) => x.kind === "tool").length} tool calls · {m4(r.cost_usd)}</span>
                  </summary>
                  <div className="stack" style={{ gap: 8, paddingTop: 10 }}>
                    <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.error ?? r.summary}</span>
                    <Steps run={r} />
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
