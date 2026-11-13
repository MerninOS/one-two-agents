import Link from "next/link";
import { notFound } from "next/navigation";
import { activateSpec, addStandard, dryRunBuilt, forgetMemoryLine, previewBuilt, saveSpec, setBuiltBudget } from "@/dashboard/actions";
import { builderMenu, getBuilder } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { m4, when } from "@/dashboard/format";
import { specLooser } from "@/core/agent-spec";
import { BudgetForm } from "@/dashboard/components/client";
import { Builder, SpecVersions } from "@/dashboard/components/Builder";
import { RunSteps } from "@/dashboard/components/RunSteps";

// One agent's builder screen (docs/agent-builder.md, slice 2): the eight parts as a draft, Preview,
// Save as the next version, its versions and its latest runs step by step.

export default async function BuildAgent({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  const b = await getBuilder(id);
  if (!b) notFound();
  const menu = builderMenu();
  const controls = controlsOn();
  const s = b.active?.spec ?? null;
  const top = b.versions[0]?.version ?? 0;
  return (
    <div className="stack" style={{ maxWidth: 1180 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="sub"><Link href="/build">Agent builder</Link> / {s?.name ?? id}</span>
        <div className="row wrap" style={{ gap: 10 }}>
          <h1 className="h1">{s?.name ?? id}</h1>
          <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{b.enabled ? "On duty" : "Off duty"}</span>
        </div>
        {b.active?.problems.length ? <span className="sub" style={{ color: "var(--red-ink)" }}>The active version asks for something code no longer offers: {b.active.problems.join("; ")}. Fix it below and save.</span> : null}
      </div>

      <Builder
        key={b.active?.version ?? 0}
        agentId={id}
        saved={s}
        savedVersion={b.active?.version ?? null}
        nextVersion={top + 1}
        menu={menu}
        standards={b.standards}
        controls={controls}
        dryRun={dryRunBuilt.bind(null, id)}
        preview={previewBuilt.bind(null, id)}
        save={saveSpec.bind(null, id)}
        addStandard={addStandard.bind(null, id)}
        forget={forgetMemoryLine}
        budget={
          <div className="ted-field">
            <span className="ted-k">Daily budget</span>
            <BudgetForm current={b.budget} save={setBuiltBudget.bind(null, id)} controls={controls} />
            <span className="sub">Spent in the last 24 hours: {m4(b.spentToday)}. Up to ${menu.budgetCeiling} a day (ceiling in code). Saved straight away, not as part of a version.</span>
          </div>
        }
      />

      <SpecVersions
        versions={b.versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt, active: v.active, createdBy: v.createdBy, problems: v.problems, looser: specLooser(s, v.spec), when: when(v.createdAt) }))}
        activate={activateSpec.bind(null, id)}
        controls={controls}
      />

      <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Latest runs</span>
        {!b.runs.length && <span className="sub">None yet. Press Preview to try one.</span>}
        {b.runs.map((r, i) => (
          <details key={r.id} open={i === 0} className={i ? "rule" : undefined} style={{ paddingTop: i ? 10 : 0 }}>
            <summary style={{ cursor: "pointer", fontSize: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{when(r.started_at)}</span>
              <span className="muted">{r.trigger}</span>
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
