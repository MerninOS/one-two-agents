import Link from "next/link";
import { createAgent } from "@/dashboard/actions";
import { listBuilt } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { when } from "@/dashboard/format";
import { NewAgentForm } from "@/dashboard/components/Builder";

// Agent builder (docs/agent-builder.md, slice 2): every agent built in the app, and New agent.

export default async function Build() {
  await requireSession();
  const built = await listBuilt();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1">Agent builder</h1>
        <span className="sub">Build an agent from scratch. Each one is a saved spec in eight parts that runs on one shared engine: the model picks its own steps from the tools you tick, code runs them, and hard limits stop it. New agents start off duty and run only when you press Preview.</span>
      </div>
      {built == null ? (
        <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>
      ) : (
        <>
          <div className="card" style={{ gap: 4 }}>
            <span className="card-t">Built here</span>
            {!built.length && <span className="sub">None yet.</span>}
            {built.map((a) => (
              <Link key={a.id} href={`/build/${a.id}`} className="row wrap rule" style={{ gap: 10, padding: "12px 0", color: "inherit" }}>
                <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 14.5 }}><b>{a.name}</b><span className="muted" style={{ display: "block", fontSize: 12.5 }}>{a.mandate || "No job line yet"}</span></span>
                <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{a.enabled ? "On duty" : "Off duty"}</span>
                {a.version != null && <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>v{a.version}</span>}
                <span className="muted" style={{ fontSize: 12, minWidth: 130, textAlign: "right" }}>{a.lastRun ? `Last run ${when(a.lastRun.at)}` : "Never run"}</span>
              </Link>
            ))}
          </div>
          <NewAgentForm create={createAgent} from={built.map((a) => ({ id: a.id, name: a.name }))} />
        </>
      )}
    </div>
  );
}
