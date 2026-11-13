"use client";
// An agent's builder page after the flow (docs/builder-flow.md, slices 3 and 4): the agent map,
// then step 5, Try it (a real run of the draft on today's data that sends and saves nothing, played
// on the map as its steps arrive, next to what today's version handed you), then step 6, Go live
// (unlocked only by a try of that version where every step worked: approve its routine and make it
// the version that runs), then the versions to go back to.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { mapOf, type MapInput, type MapStep } from "../agentMap";
import type { TryView } from "../builder";
import type { ActionResult } from "../actions";
import { money } from "../flowSteps";
import { AgentMap } from "./AgentMap";
import { Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";

type Act<T extends unknown[] = []> = (...a: T) => Promise<ActionResult>;
export interface VersionRow { version: number; note: string | null; when: string; active: boolean; createdBy: string; problems: string[]; looser: string[] }
interface Live { status: string; costUsd: number; tokensIn: number; tokensOut: number; steps: MapStep[] }

export interface TryLiveProps {
  map: Omit<MapInput, "run">;
  name: string;
  draw: boolean;
  /** The version Try it and Go live work on: the draft, else the live one. */
  working: { version: number; isDraft: boolean };
  live: number | null;
  tried: TryView | null;
  today: { at: string; summary: string } | null;
  routine: { pending: { steps: string[]; changes: string | null } | null; active: { version: number; steps: string[] } | null; hold: string | null };
  /** What going live with the working version lets a run do or spend more than the live one. */
  looser: string[];
  when: string;
  estimate: number | null;
  controls: boolean;
  versions: VersionRow[];
  tryIt: Act<[boolean]>;
  goLive: Act<[number, number[] | null, boolean]>;
  goBack: Act<[number, boolean]>;
}

const ALWAYS = "Can’t send, pay or post on its own · numbers come from code · web pages and emails are information, never orders · stops at its cost and step limit";

export function TryLive(p: TryLiveProps) {
  const router = useRouter();
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const [trying, setTrying] = useState<{ since: string; t0: number } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [secs, setSecs] = useState(0);
  const [keep, setKeep] = useState<number[]>(() => p.routine.pending?.steps.map((_, i) => i) ?? []);

  const act = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r); router.refresh();
  });

  // while a try runs: play its steps on the map as they are saved, and count the seconds
  useEffect(() => {
    if (!trying) return;
    let stop = false;
    const tick = async () => {
      setSecs(Math.round((Date.now() - trying.t0) / 1000));
      try {
        const r = await fetch(`/build/${p.map.agentId}/try?since=${encodeURIComponent(trying.since)}`, { cache: "no-store" });
        const j = (await r.json()) as { run: Live | null };
        if (!stop && j.run) setLive(j.run);
      } catch { /* the next tick tries again */ }
    };
    const h = setInterval(tick, 1200);
    return () => { stop = true; clearInterval(h); };
  }, [trying, p.map.agentId]);

  const tool = (id: string | null) => p.map.menu.tools.find((t) => t.id === id)?.label ?? id ?? "Step";
  const showRun = trying
    ? { status: "running" as const, trigger: "preview", at: `Trying now · ${secs}s`, tokensIn: live?.tokensIn ?? 0, tokensOut: live?.tokensOut ?? 0, costUsd: live?.costUsd ?? 0, memory: null, steps: live?.steps ?? [] }
    : p.tried ? { status: (p.tried.status === "ok" || p.tried.status === "failed" || p.tried.status === "running" ? p.tried.status : "failed") as "ok" | "failed" | "running", trigger: "preview", at: p.tried.at, tokensIn: 0, tokensOut: 0, costUsd: p.tried.costUsd, memory: null, steps: p.tried.steps }
    : null;
  const m = mapOf({ ...p.map, run: showRun });
  if (showRun && !trying && p.tried) m.cols.find((c) => c.key === "thinks")!.nodes[0].sub = `Try of v${p.tried.version}${p.tried.secs != null ? ` · ${p.tried.secs}s` : ""}`;

  const v = p.working.version;
  const isLive = !p.working.isDraft;
  const unlocked = !!p.tried?.clean && p.tried.version === v;
  const routineDone = !p.routine.pending && !!p.routine.active;
  const alreadyLive = isLive && routineDone;

  const onTry = (fresh: boolean) => setConfirm({
    c: {
      title: fresh ? `Try v${v} fresh?` : `Try v${v}?`,
      body: `${fresh || !p.routine.active ? `The model picks its own steps, up to its step limit.` : `It follows routine v${p.routine.active.version}: code makes its ${p.routine.active.steps.length} calls on today’s data, then the model writes the result. If a step fails it explores instead.`} ${p.estimate != null ? `About ${money(p.estimate)}, ` : ""}never more than its cost cap, and it counts against today’s budget. Nothing is sent or saved.`,
      confirmLabel: fresh ? "Try fresh" : "Try it", kind: "dark",
    },
    go: () => {
      setLive(null); setSecs(0);
      setTrying({ since: new Date(Date.now() - 5000).toISOString(), t0: Date.now() });
      act(() => p.tryIt(fresh), () => setTrying(null));
    },
  });

  const onGoLive = () => {
    const lines = [
      ...p.looser.map((x) => ({ k: "Lets it", v: x })),
      ...(p.routine.pending ? [{ k: "Routine", v: `${keep.length} of ${p.routine.pending.steps.length} steps, approved once; later tweaks apply on their own` }] : []),
    ];
    setConfirm({
      c: { title: `Put v${v} to work?`, body: `It becomes the version that runs. ${p.live && p.live !== v ? `v${p.live} is kept, and you can go back in one tap. ` : ""}On or off duty and its schedule don’t change.`, lines, confirmLabel: p.routine.pending ? "Approve routine and go live" : "Go live", kind: "dark" },
      go: () => act(() => p.goLive(v, p.routine.pending ? keep : null, true)),
    });
  };

  const onBack = (r: VersionRow) => {
    if (r.looser.length && !p.controls) { setToast({ ok: false, text: `Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this: ${r.looser.join("; ")}.` }); return; }
    if (r.looser.length) setConfirm({ c: { title: `Go back to v${r.version}?`, body: "It lets a run do or spend more than the live version.", lines: r.looser.map((x) => ({ k: "Change", v: x })), confirmLabel: `Use v${r.version}`, kind: "dark" }, go: () => act(() => p.goBack(r.version, true)) });
    else act(() => p.goBack(r.version, false));
  };

  const older = p.versions.filter((r) => p.live != null && r.version < p.live);

  return (
    <div className="stack">
      <AgentMap m={m} draw={p.draw && !showRun} foot={
        <div className="am-foot">
          <b>Always on</b>
          <span style={{ flex: "1 1 320px" }}>{ALWAYS}</span>
          <span className="muted" style={{ fontSize: 12 }}>Tap a box to change that step</span>
        </div>
      } />

      <section className="card tl-card" aria-labelledby="tl-try">
        <div className="tl-head">
          <span className="tl-step">Step 5 of 6</span>
          <h2 id="tl-try" className="tl-h">Try {p.working.isDraft ? `draft v${v}` : `v${v}`}</h2>
          <span className="sub">Runs it on today’s real data and plays it on the map. Nothing is sent or saved, and no other agent sees the result.{p.estimate != null ? ` About ${money(p.estimate)} a try.` : ""}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn dark" disabled={busy || !p.controls} onClick={() => onTry(false)}><Icon name="play" size={15} />{trying ? `Trying… ${secs}s` : p.tried?.version === v ? "Try again" : "Try it"}</button>
          {p.routine.active && <button type="button" className="btn outline" disabled={busy || !p.controls} onClick={() => onTry(true)}>Try fresh</button>}
          {!p.controls && <span className="sub">A try spends money, so it needs DASHBOARD_CONTROLS=on in Vercel.</span>}
        </div>

        {trying && (
          <div className="tl-log" aria-live="polite">
            <b>As it happens</b>
            {!live?.steps.length && <span>Starting: loading its memory and its routine…</span>}
            {live?.steps.map((s, i) => <span key={i}>{s.kind === "tool" ? `${s.ok ? "✓" : "✕"} ${tool(s.tool)} · ${(s.ms / 1000).toFixed(1)}s` : s.kind === "model" ? "Thought about it" : "Stopped"}</span>)}
          </div>
        )}

        {!trying && p.tried && p.tried.version === v && (
          <>
            <div className="row wrap" style={{ gap: 6 }}>
              {p.tried.steps.filter((s) => s.kind === "tool").map((s, i) => <span key={i} className={`tl-chip ${s.ok ? "ok" : "bad"}`}>{s.ok ? "✓" : "✕"} {tool(s.tool)}</span>)}
            </div>
            <div className="tl-compare">
              <div className="tl-box">
                <span className="tl-box-h"><b>Today’s {p.name}</b><span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{p.today ? p.today.at : "No run yet"}</span></span>
                <span className="tl-text">{p.today?.summary ?? `${p.name} hasn’t handed you anything yet.`}</span>
              </div>
              <div className="tl-box new">
                <span className="tl-box-h"><b>{p.working.isDraft ? `Draft v${v}` : `v${v}`}</b><span className="pill sm" style={{ background: "var(--acc-soft)", color: "var(--acc-ink)" }}>Not sent · {p.tried.at}</span></span>
                <span className="tl-text">{p.tried.summary || "No result."}</span>
              </div>
            </div>
            <div className={`tl-verdict ${unlocked ? "ok" : "bad"}`}>
              <span className="tl-mark">{unlocked ? "✓" : "!"}</span>
              <span style={{ flex: "1 1 240px" }}><b>{unlocked ? "Every step worked. Go live is unlocked." : `Go live is locked: the latest try ${p.tried.why}.`}</b><span className="sub" style={{ display: "block" }}>{money(p.tried.costUsd)}{p.tried.secs != null ? ` · ${p.tried.secs}s` : ""}{unlocked ? "" : " · fix the step it names, or try again"}</span></span>
            </div>
          </>
        )}
      </section>

      <section className="card tl-card" aria-labelledby="tl-live">
        <div className="tl-head">
          <span className="tl-step">Step 6 of 6</span>
          <h2 id="tl-live" className="tl-h">{alreadyLive ? `v${v} is live` : `Put v${v} to work`}</h2>
          <span className="sub">{alreadyLive ? `Each run of ${p.name} uses v${v} and its routine.` : `Going live makes v${v} the version that runs. Only after a try of v${v} where every step worked.`}</span>
        </div>
        {p.routine.hold && <div className="ted-warn">On hold: {p.routine.hold}. The next routine waits for you.</div>}
        <div className="stack" style={{ gap: 8 }}>
          <b style={{ fontSize: 14.5 }}>Its routine</b>
          <span className="sub">Saved from a try: the calls that worked. It does these first on every run, then the model writes the result. You approve it once; later tweaks apply on their own and show what changed.</span>
          {p.routine.pending ? (
            <div className="tl-steps">
              {p.routine.pending.changes && <span className="sub">{p.routine.pending.changes}</span>}
              {p.routine.pending.steps.map((st, i) => (
                <label key={i} className="tl-rstep">
                  <input type="checkbox" checked={keep.includes(i)} onChange={() => setKeep(keep.includes(i) ? keep.filter((x) => x !== i) : [...keep, i].sort((a, b) => a - b))} />
                  <span className="tl-n">{i + 1}</span><span>{st}</span>
                </label>
              ))}
            </div>
          ) : p.routine.active ? (
            <div className="tl-steps">{p.routine.active.steps.map((st, i) => <span key={i} className="tl-rstep"><span className="tl-n">{i + 1}</span><span>{st}</span></span>)}<span className="sub">Routine v{p.routine.active.version}, approved.</span></div>
          ) : <span className="sub">None yet. A try saves one from the calls that worked.</span>}
        </div>
        <div className="tl-facts">
          <div><b>When it runs</b><span>{p.when}</span><span className="tl-note">Going live doesn’t turn it on or change its schedule.</span></div>
          <div><b>Versions</b><span>{p.live == null ? `v${v} becomes the live version.` : p.live === v ? `v${v} is the live version.` : `v${v} becomes the live version. v${p.live} (today’s) is kept, and you can go back in one tap.`}</span></div>
        </div>
        {p.looser.length > 0 && !alreadyLive && <div className="ted-warn">Going live lets it do or spend more: {p.looser.join("; ")}.</div>}
        {!alreadyLive && (
          <div className="row wrap" style={{ gap: 10, justifyContent: "flex-end" }}>
            {!unlocked && <span className="sub" style={{ flex: 1 }}>{p.tried?.version === v ? `Locked: the latest try ${p.tried.why}.` : `Locked until you try v${v}.`}</span>}
            <button type="button" className="btn dark" disabled={busy || !unlocked || !p.controls || (!!p.routine.pending && !keep.length)} onClick={onGoLive}>{p.routine.pending ? "Approve routine and go live" : "Go live"}</button>
          </div>
        )}
      </section>

      {older.length > 0 && (
        <section className="card" style={{ gap: 6 }}>
          <span className="card-t">Go back</span>
          {older.map((r) => (
            <div key={r.version} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14 }}>
              <span style={{ fontWeight: 600, minWidth: 30 }}>v{r.version}</span>
              <span style={{ flex: "1 1 220px", minWidth: 0 }}>{r.note ?? "No note"}<span className="muted" style={{ display: "block", fontSize: 12 }}>{r.when} · {r.createdBy}{r.problems.length ? ` · can’t be used: ${r.problems.join("; ")}` : ""}</span></span>
              <button type="button" className="btn ghost xs" disabled={busy || r.problems.length > 0} onClick={() => onBack(r)}>Go back to v{r.version}</button>
            </div>
          ))}
        </section>
      )}

      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
