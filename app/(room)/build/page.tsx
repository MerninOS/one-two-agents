import Link from "next/link";
import { listBuilt } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { when } from "@/dashboard/format";

// Agent builder: every agent with a saved setup, and New agent, which opens the flow
// (docs/builder-flow.md, slice 2).

export default async function Build() {
  await requireSession();
  const built = await listBuilt();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <h1 className="h1">Agent builder</h1>
          <span className="sub">Build an agent one question at a time: its job, where it looks, what it hands you, and how hard it thinks. Every agent runs on one shared engine, and new ones start off duty.</span>
        </div>
        {built != null && <Link href="/build/new" className="btn dark">New agent</Link>}
      </div>
      {built == null ? (
        <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>
      ) : (
        <div className="card" style={{ gap: 4 }}>
          <span className="card-t">Your agents</span>
          {!built.length && <span className="sub">None yet. Press New agent to build one.</span>}
          {built.map((a) => (
            <Link key={a.id} href={`/build/${a.id}`} className="row wrap rule" style={{ gap: 10, padding: "12px 0", color: "inherit" }}>
              <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 14.5 }}><b>{a.name}</b><span className="muted" style={{ display: "block", fontSize: 12.5 }}>{a.mandate || "No job line yet"}</span></span>
              <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{a.enabled ? "On duty" : "Off duty"}</span>
              {a.version != null && <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>v{a.version}</span>}
              <span className="muted" style={{ fontSize: 12, minWidth: 130, textAlign: "right" }}>{a.lastRun ? `Last run ${when(a.lastRun.at)}` : "Never run"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
