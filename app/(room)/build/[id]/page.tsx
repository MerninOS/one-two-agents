import Link from "next/link";
import { notFound } from "next/navigation";
import { activateSpec, addStandard, approveBuiltPlaybook, compareEngines, switchEngine, dryRunBuilt, forgetMemoryLine, previewBuilt, rejectBuiltPlaybook, saveSpec, setBuiltBudget } from "@/dashboard/actions";
import { builderMenu, getBuilder } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { m4, when } from "@/dashboard/format";
import { specLooser } from "@/core/agent-spec";
import { EnginePanel, PlaybookPanel, SpecVersions, TryPanel } from "@/dashboard/components/Builder";
import { Flow, SoFar } from "@/dashboard/components/Flow";
import { RunSteps } from "@/dashboard/components/RunSteps";

// One agent's builder page (docs/builder-flow.md, slice 2). With ?edit it is the flow, one step per
// card. Without it, what the agent is so far (tap a step to change it), then what slice 4 replaces:
// Try it for now, Compare and Switch, the playbook, versions and its latest runs.

export default async function BuildAgent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; step?: string }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  const b = await getBuilder(id);
  if (!b) notFound();
  const menu = builderMenu();
  const controls = controlsOn();
  const s = b.active?.spec ?? null;
  const top = b.versions[0]?.version ?? 0;

  if (sp.edit != null || !s) {
    return (
      <Flow
        key={b.active?.version ?? 0}
        agentId={id}
        saved={s}
        nextVersion={top + 1}
        menu={menu}
        step={sp.step}
        controls={controls}
        others={b.others}
        standards={b.standards}
        budget={{ current: b.budget, spentToday: b.spentToday, ceiling: menu.budgetCeiling }}
        save={saveSpec.bind(null, id)}
        dryRun={dryRunBuilt.bind(null, id)}
        saveBudget={setBuiltBudget.bind(null, id)}
        addStandard={addStandard.bind(null, id)}
        forget={forgetMemoryLine}
      />
    );
  }

  const delivers = s.tools.some((t) => { const k = menu.tools.find((x) => x.id === t)?.kind; return k === "report" || k === "action"; });
  return (
    <div className="stack" style={{ maxWidth: 1180 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <span className="sub"><Link href="/build">Agent builder</Link> / {s.name}</span>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="h1">{s.name}</h1>
            <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{b.enabled ? "On duty" : "Off duty"}</span>
            {b.active && <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>v{b.active.version}</span>}
          </div>
          {b.active?.problems.length ? <span className="sub" style={{ color: "var(--red-ink)" }}>The active version asks for something code no longer offers: {b.active.problems.join("; ")}. Edit it and save.</span> : null}
        </div>
        <Link href={`/build/${id}?edit=1`} className="btn dark">Edit {s.name}</Link>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", alignItems: "start" }}>
        <div className="card" style={{ gap: 6 }}>
          <SoFar d={s} menu={menu} edit={`/build/${id}?edit=1`} />
          {b.lastOutput ? (
            <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <span className="ted-k">Latest result · {b.lastOutput.at}{b.lastOutput.finished ? "" : " · stopped early, so other agents skip it"}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{b.lastOutput.summary}</span>
              {b.lastOutput.numbers.map((n, i) => <span key={i} style={{ fontSize: 13.5 }}>{n.label}: <b>{n.value}</b> <span className="muted" style={{ fontSize: 12 }}>from {n.tool}</span></span>)}
            </div>
          ) : <span className="sub">No result yet. Try it to make one.</span>}
        </div>
        <div className="stack">
          <TryPanel
            limits={s.limits}
            modelLabel={menu.models.find((m) => m.id === s.model)?.label ?? s.model}
            delivers={delivers}
            controls={controls}
            dryRun={dryRunBuilt.bind(null, id)}
            preview={previewBuilt.bind(null, id)}
            playbook={b.playbooks?.active ? { version: b.playbooks.active.version, steps: b.playbooks.active.steps.length } : null}
            pendingPlaybook={b.playbooks?.pending?.version ?? null}
          />
          {b.engine && <EnginePanel name={s.name} onRunner={b.engine.onRunner} controls={controls} compare={compareEngines.bind(null, id)} switchTo={switchEngine.bind(null, id)} />}
        </div>
      </div>

      {b.playbooks ? (
        <PlaybookPanel key={`${b.playbooks.pending?.id ?? 0}-${b.playbooks.active?.id ?? 0}`} view={b.playbooks} approve={approveBuiltPlaybook.bind(null, id)} reject={rejectBuiltPlaybook.bind(null, id)} />
      ) : <div className="card"><span className="sub">Playbooks need the migration 20261113170000_agent_playbooks.sql.</span></div>}

      <SpecVersions
        versions={b.versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt, active: v.active, createdBy: v.createdBy, problems: v.problems, looser: specLooser(s, v.spec), when: when(v.createdAt) }))}
        activate={activateSpec.bind(null, id)}
        controls={controls}
      />

      <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Latest runs</span>
        {!b.runs.length && <span className="sub">None yet. Try it to make one.</span>}
        {b.runs.map((r, i) => (
          <details key={r.id} open={i === 0} className={i ? "rule" : undefined} style={{ paddingTop: i ? 10 : 0 }}>
            <summary style={{ cursor: "pointer", fontSize: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{when(r.started_at)}</span>
              <span className="muted">{r.trigger}{r.mode ? ` · ${r.mode}` : ""}</span>
              <span className="muted">{r.status}</span>
              <span className="muted">{r.steps.filter((x) => x.kind === "tool").length} tool calls · {m4(r.cost_usd)}</span>
            </summary>
            <div className="stack" style={{ gap: 8, paddingTop: 10 }}>
              <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.error ?? r.summary}</span>
              <RunSteps run={r} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
