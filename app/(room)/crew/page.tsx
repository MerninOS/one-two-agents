import Link from "next/link";
import { previewChain, rollBackFlow, runChainNow, saveCrewFlow } from "@/dashboard/actions";
import { listBuilt } from "@/dashboard/builder";
import { BUILT, BY_ID, PLANNED } from "@/dashboard/crew";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { when } from "@/dashboard/format";
import { schedWords } from "@/dashboard/schedule";
import { STATE_LOOK, stateOf } from "@/dashboard/status";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar, Pill } from "@/dashboard/components/ui";

// Crew (docs/builder-flow.md, slice 5): every agent and New agent, which opens the builder flow, and
// a Schedule view (the chains that were the Crew canvas), the one place a schedule is turned on.

// Preview dry-runs up to three agents in a row.
export const maxDuration = 300;

export default async function Crew({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "schedule" ? "schedule" : "agents";
  const f = await getFloor();
  return (
    <>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <h1 className="h1">Crew</h1>
          <span className="sub">{view === "agents" ? "Your agents. Open one to see how it’s doing, edit it, teach it or replay its runs." : "When each agent runs, and who goes next."}</span>
        </div>
        <Link href="/build/new" className="btn dark"><Icon name="user-plus" size={15} />New agent</Link>
      </div>
      <nav className="seg" aria-label="Crew view">
        <Link href="/crew" className={view === "agents" ? "on" : ""} aria-current={view === "agents" ? "page" : undefined}>Agents</Link>
        <Link href="/crew?view=schedule" className={view === "schedule" ? "on" : ""} aria-current={view === "schedule" ? "page" : undefined}>Schedule</Link>
      </nav>
      {view === "agents" ? <Agents f={f} /> : <Schedule f={f} />}
    </>
  );
}

async function Agents({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  // agents built in the app that aren't one of the crew in code open on their builder page
  const own = ((await listBuilt()) ?? []).filter((b) => !BY_ID[b.id]);
  return (
    <>
      <div className="crew-grid">
        {BUILT.map((a) => {
          const row = f.agents[a.id];
          const st = stateOf(a, row, f.runs, f.spentToday[a.id] ?? 0);
          const last = f.runs.find((r) => r.agent_id === a.id && r.status !== "skipped");
          return (
            <Link key={a.id} href={`/agents/${a.id}`} className="card crew-card">
              <span className="row" style={{ gap: 12 }}>
                <Avatar a={a} size={44} working={st === "running"} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15.5, fontWeight: 600 }}>{a.name}</span><span className="muted clip" style={{ fontSize: 12.5 }}>{a.role}</span></span>
                <Pill look={STATE_LOOK[st]} sm />
              </span>
              <span className="ink2" style={{ fontSize: 13, lineHeight: 1.45 }}>{a.job}</span>
              <span className="row wrap muted" style={{ gap: 6, fontSize: 12 }}>
                <span>{schedWords(a.schedule)}</span>
                {f.liveVersion[a.id] != null && <><span>·</span><span>v{f.liveVersion[a.id]}</span></>}
                <span>·</span><span>{last ? `Last ran ${when(last.started_at)}` : "Never run"}</span>
              </span>
            </Link>
          );
        })}
        {own.map((b) => (
          <Link key={b.id} href={`/build/${b.id}`} className="card crew-card">
            <span className="row" style={{ gap: 12 }}>
              <span className="av" style={{ width: 44, height: 44, background: "var(--soft)" }}><Icon name="cpu" size={20} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15.5, fontWeight: 600 }}>{b.name}</span><span className="muted" style={{ fontSize: 12.5 }}>Built in the app</span></span>
              <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{b.enabled ? "On duty" : "Off duty"}</span>
            </span>
            <span className="ink2" style={{ fontSize: 13, lineHeight: 1.45 }}>{b.mandate || "No job line yet"}</span>
            <span className="row wrap muted" style={{ gap: 6, fontSize: 12 }}>
              {b.version != null && <><span>v{b.version}</span><span>·</span></>}
              <span>{b.lastRun ? `Last ran ${when(b.lastRun.at)}` : "Never run"}</span>
            </span>
          </Link>
        ))}
      </div>
      {PLANNED.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="card-t">Joining after launch</span>
          <div className="crew-grid">
            {PLANNED.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="card dashed crew-card">
                <span className="row" style={{ gap: 12 }}>
                  <Avatar a={a} size={40} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span><span className="muted clip" style={{ fontSize: 12.5 }}>{a.role} · phase {a.phase}</span></span>
                </span>
                <span className="ink2" style={{ fontSize: 13, lineHeight: 1.45 }}>{a.job}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

async function Schedule({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const d = await getCrewCanvas(f);
  return (
    <>
      <div className="card" style={{ gap: 6, borderLeft: "4px solid var(--acc)" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Which agents run when, and who goes next.</span>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          A chain never turns an agent on. Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
      </div>
      <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
    </>
  );
}
