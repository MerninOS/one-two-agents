import Link from "next/link";
import { notFound } from "next/navigation";
import { addStandard, dryRunBuilt, forgetMemoryLine, goBack, goLive, saveSpec, setBuiltBudget, tryBuilt } from "@/dashboard/actions";
import { builderMenu, getBuilder } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { m4, when } from "@/dashboard/format";
import { specLooser } from "@/core/agent-spec";
import { TryLive } from "@/dashboard/components/TryLive";
import { estimate } from "@/dashboard/flowSteps";
import { Flow } from "@/dashboard/components/Flow";
import { BY_ID } from "@/dashboard/crew";
import { schedSentence, schedWords } from "@/dashboard/schedule";
import { RunSteps } from "@/dashboard/components/RunSteps";
import { AgentTabs } from "@/dashboard/components/ui";
import { placeAgent } from "@/dashboard/orgActions";
import { seatChoices } from "@/dashboard/org";
import { loadOrg, seatOf } from "@/core/org";

// One agent's builder page, its Edit tab (docs/builder-flow.md, slices 2-5). With ?edit it is the flow, steps 1-4,
// one per card, editing the draft (else the live version). Without it, the agent map (tap a box to
// change that step; it builds itself right after a save, ?saved), step 5 Try it, step 6 Go live,
// the versions to go back to, its latest result and its latest runs.

export default async function BuildAgent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; step?: string; saved?: string }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  const b = await getBuilder(id);
  if (!b) notFound();
  const menu = builderMenu();
  const controls = controlsOn();
  const live = b.active;
  const working = b.draft ?? (live ? { ...live, active: true } : null);
  const s = working?.spec ?? null;
  const top = b.versions[0]?.version ?? 0;

  if (sp.edit != null || !s) {
    const org = await loadOrg();
    return (
      <Flow
        key={working?.version ?? 0}
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
        seats={org ? seatChoices(org, id) : undefined}
        seatId={org ? seatOf(org, id)?.id ?? null : null}
        place={placeAgent.bind(null, id)}
      />
    );
  }

  const crew = !!BY_ID[id];
  const sch = BY_ID[id]?.schedule;
  const saved = sp.saved != null;
  return (
    <div className="stack" style={{ maxWidth: 1180 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <span className="sub"><Link href="/crew">Crew</Link> / {s.name}</span>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="h1">{saved ? `Saved. Here’s ${s.name}.` : s.name}</h1>
            <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{b.enabled ? "On duty" : "Off duty"}</span>
            {live && <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Live: v{live.version}</span>}
            {b.draft && <span className="pill sm" style={{ background: "var(--acc-soft)", color: "var(--acc-ink)" }}>Draft v{b.draft.version}</span>}
          </div>
          {saved && <span className="sub">{b.draft ? `Saved as draft v${b.draft.version}. ${live ? `v${live.version} keeps running until you try the draft and go live.` : "Try it, then go live."}` : `Version ${working?.version ?? top}. Try it, then go live.`}</span>}
          {working?.problems.length ? <span className="sub" style={{ color: "var(--red-ink)" }}>v{working.version} asks for something code no longer offers: {working.problems.join("; ")}. Edit it and save.</span> : null}
        </div>
        <Link href={`/build/${id}?edit=1`} className="btn dark">Edit {s.name}</Link>
      </div>
      {crew && <AgentTabs id={id} on="edit" editable />}

      <TryLive
        key={`${working?.version ?? 0}-${b.playbooks?.pending?.id ?? 0}`}
        map={{ agentId: id, spec: s, menu: { tools: menu.tools, models: menu.models, conns: menu.conns }, schedule: sch && sch.kind !== "manual" ? schedWords(sch) : null, chain: sch?.chain ?? null, usedBy: b.usedBy, edit: `/build/${id}?edit=1` }}
        name={s.name}
        draw={saved}
        working={{ version: working!.version, isDraft: !!b.draft }}
        live={live?.version ?? null}
        tried={b.tried}
        today={b.today}
        routine={{ pending: b.playbooks?.pending ? { steps: b.playbooks.pending.steps, changes: b.playbooks.pending.changes } : null, active: b.playbooks?.active ? { version: b.playbooks.active.version, steps: b.playbooks.active.steps } : null, hold: b.playbooks?.hold ?? null }}
        looser={b.draft && live ? specLooser(live.spec, b.draft.spec) : []}
        when={`${schedSentence(sch)}${sch?.chain ? ` In the ${sch.chain} chain.` : ""}`}
        estimate={estimate(s, menu.models)}
        controls={controls}
        versions={b.versions.map((v) => ({ version: v.version, note: v.note, when: when(v.createdAt), active: v.active, createdBy: v.createdBy, problems: v.problems, looser: live ? specLooser(live.spec, v.spec) : [] }))}
        tryIt={tryBuilt.bind(null, id)}
        goLive={goLive.bind(null, id)}
        goBack={goBack.bind(null, id)}
      />

      <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Latest result</span>
        {b.lastOutput ? (
          <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <span className="ted-k">{b.lastOutput.at}{b.lastOutput.finished ? "" : " · stopped early, so other agents skip it"}</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{b.lastOutput.summary}</span>
            {b.lastOutput.numbers.map((n, i) => <span key={i} style={{ fontSize: 13.5 }}>{n.label}: <b>{n.value}</b> <span className="muted" style={{ fontSize: 12 }}>from {n.tool}</span></span>)}
          </div>
        ) : <span className="sub">Nothing saved for other agents yet. Live runs save their result; tries don’t.</span>}
      </div>

      {/* the crew in code have a Runs tab with replays; agents built in the app get theirs in slice 6 */}
      {crew ? <span className="sub"><Link href={`/agents/${id}?tab=runs`}>All of {s.name}’s runs</Link>, each with a replay.</span> : <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Latest runs</span>
        {!b.runs.length && <span className="sub">None yet.</span>}
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
      </div>}
    </div>
  );
}
