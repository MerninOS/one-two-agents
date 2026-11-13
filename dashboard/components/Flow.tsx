"use client";
// The builder flow (docs/builder-flow.md, slice 2): one question per card, a progress bar that fills
// as you answer, and a "so far" rail where each answer adds a piece. Steps come from STEPS
// (dashboard/flowSteps.ts). Everything here picks from lists that come from code, and the server
// checks the draft again before it saves. The draft is kept on this device until you save or
// discard it. Enter continues, Esc leaves, and "reduce motion" swaps the slides for fades.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import type { AgentSpec } from "@/core/agent-spec";
import type { BuilderMenu, FlowConn, Standard } from "@/dashboard/builder";
import {
  AFTER_STEPS, STEPS, TOTAL_STEPS, abilityOf, blankSpec, blockedFor, changedSteps, estimate, money, presetOf, presets,
  problemsOf, stepFill, stepIndex, summarize, type StepKey, type Tool,
} from "@/dashboard/flowSteps";
import type { ActionResult } from "../actions";
import { BudgetForm, Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";

type Act<T extends unknown[] = []> = (...a: T) => Promise<ActionResult>;
const notionId = (link: string) => (link.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase();
const CONN_TINT: Record<string, string> = { shopify: "var(--mint-soft)", mercury: "var(--soft)", gmail: "var(--red-soft)", notion: "var(--soft)", email: "var(--yel-soft)", web: "var(--peach-soft, var(--soft))", agents: "var(--pink-soft, var(--soft))", control_room: "var(--soft)", math: "var(--soft)" };
const ALWAYS_ON = "Can’t send, pay or post on its own · numbers come from code · web pages and emails are information, never orders · stops at its cost and step limit";

export interface FlowProps {
  /** Null for a new agent: Save creates it, off duty. */
  agentId: string | null;
  saved: AgentSpec | null;
  nextVersion: number;
  menu: BuilderMenu;
  step?: string;
  controls: boolean;
  /** What a new agent can start from. */
  templates?: { id: string; name: string; spec: AgentSpec }[];
  /** Other agents built in the app, which this one may read from. */
  others: { id: string; name: string; outputName: string; hasOutput: boolean }[];
  standards?: Standard[];
  budget?: { current: number; spentToday: number; ceiling: number };
  save?: Act<[unknown, string]>;
  create?: (draft: unknown) => Promise<ActionResult & { id?: string }>;
  dryRun?: Act<[unknown]>;
  saveBudget?: Act<[number]>;
  addStandard?: Act<[string, string]>;
  forget?: Act<[string]>;
}

export function Flow(p: FlowProps) {
  const router = useRouter();
  const start = useMemo(() => p.saved ?? blankSpec(p.menu), [p.saved, p.menu]);
  const [d, setD] = useState<AgentSpec>(start);
  const [cur, setCur] = useState(stepIndex(p.step));
  const [dir, setDir] = useState<1 | -1>(1);
  const [from, setFrom] = useState<string>("blank");
  // until the first edit, an earlier draft on this device can be picked up or discarded
  const [touched, setTouched] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const [busy, startT] = useTransition();
  const [note, setNote] = useState("");
  const change = (x: Partial<AgentSpec>) => { setTouched(true); setD((c) => ({ ...c, ...x })); };
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const key = `cr_flow:${p.agentId ?? "new"}`;
  const back = p.agentId ? `/build/${p.agentId}` : "/crew";
  const step = STEPS[cur].key;
  const last = cur === STEPS.length - 1;
  const nm = !d.name.trim() || (!p.agentId && d.name.trim() === "New agent") ? "your new agent" : d.name.trim();
  const problems = problemsOf(d, p.menu);
  const stepProblems = problems.filter((x) => x.step === step);

  // the draft lives on this device until it is saved or discarded
  const stored = useSyncExternalStore(subscribeStorage, () => readStored(key), () => null);
  const earlier = !touched && stored != null && stored !== JSON.stringify(start) ? parseDraft(stored) : null;
  useEffect(() => {
    if (!touched) return;
    try { if (dirty) window.localStorage.setItem(key, JSON.stringify(d)); else window.localStorage.removeItem(key); } catch { /* no storage here: the draft just isn't kept */ }
  }, [d, dirty, key, touched]);
  const forgetDraft = () => { try { window.localStorage.removeItem(key); } catch { /* fine */ } };

  const go = (i: number) => { if (i < 0 || i >= STEPS.length) return; setDir(i > cur ? 1 : -1); setCur(i); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const leave = useCallback(() => {
    if (!dirty) { router.push(back); return; }
    setConfirm({ c: { title: "Leave the builder?", body: "Your draft stays on this device, so you can pick it up here later. Nothing is saved to the agent.", confirmLabel: "Leave", kind: "dark" }, go: () => router.push(back) });
  }, [dirty, back, router]);

  const act = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => startT(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r); router.refresh();
  });

  const doSave = () => {
    if (!p.agentId) {
      startT(async () => {
        const r = await p.create!(d).catch((e) => ({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }) as ActionResult & { id?: string });
        setToast(r);
        if (r.ok && r.id) { forgetDraft(); router.push(`/build/${r.id}?saved=1`); }
      });
      return;
    }
    const steps = changedSteps(p.saved, d, p.menu).map((k) => STEPS[stepIndex(k)].title.toLowerCase());
    const why = note.trim() || (steps.length ? `Changed ${steps.join(", ")}` : "Edited in the builder");
    act(() => p.save!(d, why), (r) => { if (r.ok) { forgetDraft(); router.push(`${back}?saved=1`); } });
  };
  const onSave = () => {
    if (problems.length) { go(stepIndex(problems[0].step)); setToast({ ok: false, text: `Fix first: ${problems.map((x) => x.text).join("; ")}.` }); return; }
    if (p.agentId && !dirty) { router.push(back); return; }
    // a save is a draft: what runs changes only at Go live, which asks about anything that loosens
    doSave();
  };
  const next = () => (last ? onSave() : go(cur + 1));

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (confirm || busy) return;
      if (e.key === "Escape") { e.preventDefault(); leave(); return; }
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || (tag === "INPUT" && !["checkbox", "radio"].includes((t as HTMLInputElement).type));
      if (typing && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      next();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const fill = stepFill(step, d, p.menu);
  const left = STEPS.length - 1 - cur;
  return (
    <div className="bf">
      <header className="bf-head">
        <span className="av" style={{ width: 36, height: 36, fontSize: 15 }}>{(d.name.trim() || "?").slice(0, 1).toUpperCase()}</span>
        <span className="bf-title">{p.agentId ? `Building ${nm}` : "New agent"}</span>
        <span className="muted bf-status">
          {earlier ? <>An unsaved draft from earlier is on this device · <button type="button" className="linkish" onClick={() => { setTouched(true); setD({ ...start, ...earlier }); }}>Pick it up</button> · <button type="button" className="linkish" onClick={() => { forgetDraft(); setTouched(true); }}>Discard it</button></> : dirty ? "Draft kept on this device" : p.agentId ? "No changes yet" : "Nothing saved yet"}
          {p.agentId ? ` · today’s ${p.saved?.name ?? "version"} keeps running` : " · it starts off duty"}
        </span>
        <button type="button" className="btn ghost sm" onClick={leave}>Esc to leave</button>
      </header>

      <div className="bf-progress" aria-label={`Step ${cur + 1} of ${TOTAL_STEPS}`}>
        <div className="bf-segs">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => <span key={i} className="bf-seg"><i style={{ width: `${i < cur ? 100 : i === cur ? Math.round(fill * 100) : 0}%` }} /></span>)}
        </div>
        <div className="bf-progress-t"><span><b>{STEPS[cur].title}</b> · step {cur + 1} of {TOTAL_STEPS}</span><span>{last ? "Last question before you save" : `${left} more after this, then save`}</span></div>
      </div>

      <div className="bf-body">
        <SoFar d={d} menu={p.menu} cur={cur} onJump={go} />

        <main className="bf-main">
          <section key={`${cur}`} className={`bf-card ${dir > 0 ? "fwd" : "back"}`}>
            <div className="bf-ask">
              <span className="bf-n">Step {cur + 1}</span>
              <h1 className="bf-q">{step === "job" ? `What should ${nm} do?` : step === "connections" ? `Where should ${nm} look?` : step === "hands" ? `What does ${nm} hand you?` : `How hard should ${nm} think?`}</h1>
              <p className="bf-sub">{SUBS[step]}</p>
            </div>

            {step === "job" && <JobStep d={d} change={change} p={p} from={from} setFrom={setFrom} act={act} busy={busy} />}
            {step === "connections" && <ConnStep d={d} change={change} p={p} setToast={setToast} act={act} busy={busy} />}
            {step === "hands" && <HandsStep d={d} change={change} p={p} setToast={setToast} />}
            {step === "brain" && <BrainStep d={d} change={change} p={p} />}

            {stepProblems.length > 0 && (touched || p.agentId) && <div className="ted-warn">Before you save: {stepProblems.map((x) => x.text).join("; ")}.</div>}

            {last && p.agentId && dirty && (
              <label className="bf-field"><span className="bf-k">What changed? (optional, for the version list)</span><input className="input" maxLength={300} value={note} placeholder={(() => { const s = changedSteps(p.saved, d, p.menu); return s.length ? `Changed ${s.map((k) => STEPS[stepIndex(k)].title.toLowerCase()).join(", ")}` : ""; })()} onChange={(e) => setNote(e.target.value)} /></label>
            )}

            <div className="bf-foot">
              {cur > 0 ? <button type="button" className="linkish" onClick={() => go(cur - 1)}>← Back</button> : <span />}
              <span className="bf-hint">Press Enter</span>
              <button type="button" className="btn dark bf-go" disabled={busy} onClick={next}>
                {busy ? "Saving…" : !last ? "Continue →" : p.agentId ? (dirty ? `Save draft v${p.nextVersion} →` : "Done →") : `Create ${nm}, off duty →`}
              </button>
            </div>

            <div className="bf-always">
              <span className="bf-always-k"><Icon name="lock" size={12} /> Always on</span>
              <span>{ALWAYS_ON}</span>
              <details><summary>What it reads first, every run</summary><span className="setup-long">{p.menu.safety}</span></details>
            </div>
          </section>
        </main>
      </div>
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

const subscribeStorage = (cb: () => void) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); };
const readStored = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const parseDraft = (raw: string): AgentSpec | null => {
  try { const got = JSON.parse(raw) as AgentSpec; return got && typeof got === "object" && typeof got.name === "string" && Array.isArray(got.tools) ? got : null; } catch { return null; }
};

const SUBS: Record<StepKey, string> = {
  job: "Write it the way you’d brief a new hire: who it’s for, when, and what done looks like.",
  connections: "Tap a connection to open it, then tick what it can read there. Anything it can do there is always a card you approve, and only where code allows.",
  hands: "Pick where the result goes. Nothing goes out until a run finishes, and every result is saved for your other agents.",
  brain: "More thinking costs more. Numbers are always worked out in code, whichever you pick.",
};

type StepProps = { d: AgentSpec; change: (x: Partial<AgentSpec>) => void; p: FlowProps };
type Run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => void;

function Field({ k, children, sub }: { k: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return <label className="bf-field"><span className="bf-k">{k}</span>{children}{sub && <span className="sub">{sub}</span>}</label>;
}

function JobStep({ d, change, p, from, setFrom, act, busy }: StepProps & { from: string; setFrom: (s: string) => void; act: Run; busy: boolean }) {
  const [std, setStd] = useState(""), [link, setLink] = useState("");
  const label = (t: { name: string; spec: AgentSpec }) => { const o = t.spec.outputName; return o && o !== "result" ? o.charAt(0).toUpperCase() + o.slice(1) : `Like ${t.name}`; };
  return (
    <div className="bf-stack">
      {p.templates && (
        <div className="bf-field">
          <span className="bf-k">Start from</span>
          <div className="bf-chips">
            {p.templates.map((t) => <button key={t.id} type="button" className={`bf-chip${from === t.id ? " on" : ""}`} onClick={() => { setFrom(t.id); change({ ...t.spec, name: d.name.trim() && d.name !== "New agent" ? d.name : `${t.name} copy` }); }}>{label(t)}</button>)}
            <button type="button" className={`bf-chip${from === "blank" ? " on" : ""}`} onClick={() => { setFrom("blank"); change({ ...blankSpec(p.menu, d.name) }); }}>Blank</button>
          </div>
          <span className="sub">A copy picks up that agent’s answers in every step. Actions stay behind: code names which agents may ask for them.</span>
        </div>
      )}
      <Field k="Name"><input className="input" value={d.name} maxLength={80} onChange={(e) => change({ name: e.target.value })} /></Field>
      <Field k="Its job, in your words" sub={`${d.directive.length} of 4,000`}><textarea className="input ted-text" rows={6} maxLength={4000} value={d.directive} onChange={(e) => change({ directive: e.target.value })} placeholder="Each weekday morning, tell me the one thing I should focus on today and why…" /></Field>
      <Field k="What a good result looks like"><textarea className="input ted-text" rows={3} maxLength={1000} value={d.goodResult} onChange={(e) => change({ goodResult: e.target.value })} placeholder="A focus line, then at most five short watch lines. Every number exactly as the data says." /></Field>
      <Field k="One line for the agent list"><input className="input" value={d.mandate} maxLength={200} onChange={(e) => change({ mandate: e.target.value })} placeholder="Morning focus and watch list" /></Field>
      {p.agentId && p.standards && (
        <details className="bf-more">
          <summary>Rules it always follows ({p.standards.length})</summary>
          <div className="bf-stack" style={{ gap: 0, paddingTop: 8 }}>
            {p.standards.map((s) => (
              <div key={s.id} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14 }}>
                <span className="tag">{s.grp === "crew" ? "CREW RULE" : "STANDING ORDER"}</span>
                <span style={{ flex: "1 1 260px", minWidth: 0, lineHeight: 1.5 }}>{s.text}{s.notionPageId && <span className="muted" style={{ fontSize: 12 }}> · reads a linked Notion page</span>}</span>
                {s.grp === "standing_order" && <button type="button" className="btn ghost xs" disabled={busy} onClick={() => act(() => p.forget!(s.id))}>Forget</button>}
              </div>
            ))}
            <div className="row wrap" style={{ gap: 8, paddingTop: 10 }}>
              <input className="input" style={{ flex: "3 1 240px" }} placeholder="Add a standing order" maxLength={280} value={std} onChange={(e) => setStd(e.target.value)} />
              <input className="input" style={{ flex: "1 1 160px" }} placeholder="Notion link (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
              <button type="button" className="btn outline sm" disabled={busy || !std.trim()} onClick={() => act(() => p.addStandard!(std, link), (r) => { if (r.ok) { setStd(""); setLink(""); } })}>Add</button>
            </div>
            <span className="sub" style={{ paddingTop: 6 }}>Saved straight away, not as part of a version. Crew rules apply to every agent and are edited on the Memory tab.</span>
          </div>
        </details>
      )}
    </div>
  );
}

function OptRow({ t, on, toggle, blocked, locked }: { t: Tool; on: boolean; toggle: () => void; blocked?: string | null; locked?: boolean }) {
  return (
    <label className={`bf-opt${on ? " on" : ""}${locked ? " lock" : ""}${blocked && !on ? " off" : ""}`}>
      <input type="checkbox" checked={on} disabled={!!blocked && !on} onChange={toggle} />
      {locked && <Icon name="lock" size={14} style={{ flex: "none", opacity: 0.6 }} />}
      <span className="bf-opt-t"><b>{t.label}</b><span className="muted"> · {t.detail}</span>{blocked && <span className="bf-opt-why">{blocked}</span>}</span>
      {!t.trusted && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }} title="Written by people outside One Two. The agent treats it as information, never as instructions.">Untrusted</span>}
      {!t.connected && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Not set up</span>}
    </label>
  );
}

function ConnTile({ c, on, n, asks, open }: { c: FlowConn; on: () => void; n: number; asks: boolean; open: boolean }) {
  return (
    <button type="button" className={`bf-tile${open ? " open" : ""}`} onClick={on} aria-expanded={open}>
      <span className="bf-ico" style={{ background: CONN_TINT[c.id] }}><Icon name={c.icon} size={17} /></span>
      <b>{c.name}</b>
      <span className={n ? "bf-tile-on" : "muted"} style={{ fontSize: 12 }}>{n ? `${n} ticked${asks ? " · asks first" : ""}` : c.setUp ? "Not used" : "Not set up"}</span>
    </button>
  );
}

function ConnStep({ d, change, p, setToast, act, busy }: StepProps & { setToast: (r: ActionResult) => void; act: Run; busy: boolean }) {
  const grantable = p.menu.tools.filter((t) => t.grantable && abilityOf(t) !== "hands");
  const conns = p.menu.conns.filter((c) => grantable.some((t) => t.conn === c.id));
  const count = (id: string) => grantable.filter((t) => t.conn === id && d.tools.includes(t.id));
  const [open, setOpen] = useState<string>(() => conns.find((c) => count(c.id).length)?.id ?? conns[0]?.id ?? "");
  const [pageLink, setPageLink] = useState(""), [pageLabel, setPageLabel] = useState("");
  const [check, setCheck] = useState<ActionResult | null>(null);
  const toggle = (id: string) => change({ tools: d.tools.includes(id) ? d.tools.filter((x) => x !== id) : [...d.tools, id] });
  const c = conns.find((x) => x.id === open);
  const reads = grantable.filter((t) => t.conn === open && abilityOf(t) === "read");
  const dos = grantable.filter((t) => t.conn === open && abilityOf(t) === "do");
  const addPage = () => {
    const id = notionId(pageLink);
    if (!id) { setToast({ ok: false, text: "That doesn’t look like a Notion page link. In Notion use Share, then Copy link." }); return; }
    if (!d.notionPages.some((x) => x.id === id)) change({ notionPages: [...d.notionPages, { id, label: pageLabel.trim() || "Notion page" }].slice(0, 10) });
    setPageLink(""); setPageLabel("");
  };
  const toggleSource = (a: FlowProps["others"][number]) => change({ readsFrom: d.readsFrom.some((x) => x.agentId === a.id) ? d.readsFrom.filter((x) => x.agentId !== a.id) : [...d.readsFrom, { agentId: a.id, label: `${a.name}: ${a.outputName}` }].slice(0, 10) });
  return (
    <div className="bf-stack">
      <div className="bf-tiles">
        {conns.map((x) => { const got = count(x.id); return <ConnTile key={x.id} c={x} n={got.length} asks={got.some((t) => abilityOf(t) === "do")} open={open === x.id} on={() => setOpen(x.id)} />; })}
      </div>
      {c && (
        <div className="bf-panel" key={c.id}>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="bf-ico sm" style={{ background: CONN_TINT[c.id] }}><Icon name={c.icon} size={14} /></span>
            <b style={{ flex: 1 }}>{c.name}</b>
            {!c.setUp && <Link href={`/connections?c=${c.id}`} className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Not set up · how</Link>}
          </div>
          <span className="sub">{c.about}</span>
          <span className="bf-k">Can read · looks only</span>
          {reads.map((t) => <OptRow key={t.id} t={t} on={d.tools.includes(t.id)} toggle={() => toggle(t.id)} />)}
          {!reads.length && <span className="sub">Nothing to read here.</span>}
          {c.id === "notion" && d.tools.includes("notion_read_page") && (
            <div className="bf-extra">
              <span className="bf-k">Pages it may open</span>
              {d.notionPages.map((pg) => (
                <div key={pg.id} className="row wrap" style={{ gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{pg.label} <span className="muted" style={{ fontSize: 12 }}>{pg.id.slice(0, 8)}…</span></span>
                  <button type="button" className="btn ghost xs" onClick={() => change({ notionPages: d.notionPages.filter((x) => x.id !== pg.id) })}>Remove</button>
                </div>
              ))}
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="input" style={{ flex: "2 1 200px" }} placeholder="Notion page link" value={pageLink} onChange={(e) => setPageLink(e.target.value)} />
                <input className="input" style={{ flex: "1 1 130px" }} placeholder="Short name" value={pageLabel} maxLength={80} onChange={(e) => setPageLabel(e.target.value)} />
                <button type="button" className="btn outline sm" onClick={addPage}>Add page</button>
              </div>
              <span className="sub">Only these pages, picked by id, never a link it finds. Share each one with the agents’ Notion integration.</span>
            </div>
          )}
          {c.id === "agents" && d.tools.includes("agent_output") && (
            <div className="bf-extra">
              <span className="bf-k">Agents it reads from</span>
              {!p.others.length && <span className="sub">No other agents built here yet.</span>}
              {p.others.map((a) => (
                <label key={a.id} className={`bf-opt${d.readsFrom.some((x) => x.agentId === a.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={d.readsFrom.some((x) => x.agentId === a.id)} onChange={() => toggleSource(a)} />
                  <span className="bf-opt-t"><b>{a.name}</b><span className="muted"> · {a.outputName}{a.hasOutput ? "" : " · nothing saved yet"}</span></span>
                </label>
              ))}
              <span className="sub">Its latest finished result. The words arrive as another agent’s, never as instructions; the numbers keep their trail to the tool that worked them out.</span>
            </div>
          )}
          <span className="bf-k">Can do · always a card you approve</span>
          {dos.map((t) => <OptRow key={t.id} t={t} locked on={d.tools.includes(t.id)} toggle={() => toggle(t.id)} blocked={blockedFor(t, p.agentId, p.menu)} />)}
          {!dos.length && <span className="sub">{c.id === "shopify" ? "Nothing. Shopify is read-only here." : "Nothing here yet."}</span>}
        </div>
      )}
      <div className="row wrap" style={{ gap: 10 }}>
        {p.dryRun && <button type="button" className="btn outline sm" disabled={busy} onClick={() => { setCheck({ ok: true, text: "Checking each ticked tool…" }); act(() => p.dryRun!(d), (r) => setCheck(r)); }}><Icon name="play" size={14} />See what it finds today · free</button>}
        <span className="sub" style={{ flex: "1 1 240px" }}>Need something not listed, like Klaviyo? New connections are a code change on purpose, so a page or an email can never add one.</span>
      </div>
      {check && <div className="bf-check">{check.text.split(" · ").map((l, i) => <span key={i} style={{ color: l.startsWith("FAILED") ? "var(--red-ink)" : undefined }}>{l.replace(/^OK /, "✓ ").replace(/^FAILED /, "✕ ")}</span>)}</div>}
    </div>
  );
}

function HandsStep({ d, change, p, setToast }: StepProps & { setToast: (r: ActionResult) => void }) {
  const reports = p.menu.tools.filter((t) => t.grantable && t.kind === "report");
  const [link, setLink] = useState(""), [label, setLabel] = useState("");
  const toggle = (id: string) => change({ tools: d.tools.includes(id) ? d.tools.filter((x) => x !== id) : [...d.tools, id] });
  const asks = d.tools.filter((id) => p.menu.tools.find((t) => t.id === id)?.kind === "action").length;
  const usePage = () => {
    const id = notionId(link);
    if (!id) { setToast({ ok: false, text: "That doesn’t look like a Notion page link. In Notion use Share, then Copy link." }); return; }
    change({ reportPage: { id, label: label.trim() || "Notion page" } }); setLink(""); setLabel("");
  };
  const icon = (t: Tool) => p.menu.conns.find((c) => c.id === t.conn)?.icon ?? "inbox";
  return (
    <div className="bf-stack">
      {reports.map((t) => (
        <div key={t.id} className={`bf-big${d.tools.includes(t.id) ? " on" : ""}`}>
          <label className="row" style={{ gap: 14, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={d.tools.includes(t.id)} onChange={() => toggle(t.id)} style={{ marginTop: 10 }} />
            <span className="bf-ico" style={{ background: CONN_TINT[t.conn] }}><Icon name={icon(t)} size={17} /></span>
            <span className="bf-opt-t"><b style={{ fontSize: 15 }}>{t.label}</b><span className="ink2" style={{ display: "block", fontSize: 13, lineHeight: 1.5 }}>{t.detail}</span></span>
            {!t.connected && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Not set up</span>}
          </label>
          {t.id === "report_notion_page" && d.tools.includes(t.id) && (
            <div className="bf-extra">
              <span className="bf-k">Page to write under</span>
              {d.reportPage ? (
                <div className="row wrap" style={{ gap: 8, fontSize: 14 }}><span style={{ flex: 1 }}>{d.reportPage.label} <span className="muted" style={{ fontSize: 12 }}>{d.reportPage.id.slice(0, 8)}…</span></span><button type="button" className="btn ghost xs" onClick={() => change({ reportPage: null })}>Change</button></div>
              ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  <input className="input" style={{ flex: "2 1 200px" }} placeholder="Notion page link" value={link} onChange={(e) => setLink(e.target.value)} />
                  <input className="input" style={{ flex: "1 1 130px" }} placeholder="Short name" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
                  <button type="button" className="btn outline sm" onClick={usePage}>Use page</button>
                </div>
              )}
              <span className="sub">Each finished run adds one page under it. Share the page with the agents’ Notion integration.</span>
            </div>
          )}
        </div>
      ))}
      <div className="bf-big on always">
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <span className="bf-ico" style={{ background: CONN_TINT.agents }}><Icon name="users" size={17} /></span>
          <span className="bf-opt-t" style={{ flex: 1 }}>
            <span className="row wrap" style={{ gap: 8 }}><b style={{ fontSize: 15 }}>Save it for your other agents</b><span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Always on</span></span>
            <span className="ink2" style={{ display: "block", fontSize: 13, lineHeight: 1.5 }}>Every finished run is saved in its own words plus the numbers behind it, each traced to the tool that worked it out. Any agent can pick it in its Connections step.</span>
          </span>
        </div>
        <Field k="Called" sub={`Other agents see it as “${d.name.trim() || "This agent"}: ${d.outputName || "result"}”.`}><input className="input" value={d.outputName} maxLength={60} onChange={(e) => change({ outputName: e.target.value })} /></Field>
      </div>
      <span className="sub">Approval cards come from Connections, under Can do. {asks ? `${d.name.trim() || "It"} has ${asks}, so it may ask you to approve things.` : `${d.name.trim() || "It"} has none, so it never asks you to approve anything.`}</span>
    </div>
  );
}

function BrainStep({ d, change, p }: StepProps) {
  const ps = presets(p.menu.models);
  const pick = presetOf(d, p.menu.models);
  const L = p.menu.limits;
  const est = estimate(d, p.menu.models);
  const label = (id: string) => p.menu.models.find((m) => m.id === id)?.label.replace(/^Claude /, "") ?? id;
  return (
    <div className="bf-stack">
      <div className="bf-presets" role="radiogroup" aria-label="How hard it thinks">
        {ps.map((x) => {
          const e = estimate({ ...d, model: x.model, effort: x.effort }, p.menu.models);
          return (
            <button key={x.key} type="button" role="radio" aria-checked={pick?.key === x.key} className={`bf-preset${pick?.key === x.key ? " on" : ""}`} onClick={() => change({ model: x.model, effort: x.effort })}>
              <span className="row" style={{ gap: 8, justifyContent: "space-between" }}><b style={{ fontSize: 17 }}>{x.label}</b>{x.recommended && <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Recommended</span>}</span>
              <span className="ink2" style={{ fontSize: 13, lineHeight: 1.45 }}>{x.about}</span>
              <span className="muted" style={{ fontSize: 12 }}>{label(x.model)}, {x.effort} effort</span>
              <span style={{ marginTop: "auto" }}><b style={{ fontSize: 18 }}>≈ {e == null ? "?" : money(e)}</b><span className="muted" style={{ fontSize: 12 }}> a run</span></span>
            </button>
          );
        })}
      </div>
      {!pick && <span className="sub">Custom: {label(d.model)}, {d.effort} effort (set under Advanced).</span>}
      <div className="bf-cap">
        <span className="bf-k">Never spend more than</span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>$</span>
          <input className="input" type="number" min={L.maxCostUsd.min} max={L.maxCostUsd.max} step={0.05} style={{ width: 110, fontSize: 18, fontWeight: 700 }} value={d.limits.maxCostUsd} onChange={(e) => change({ limits: { ...d.limits, maxCostUsd: Number(e.target.value) } })} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>a run</span>
        </span>
        <span className="sub">A normal run is about {est == null ? "?" : money(est)}. It stops before a turn that could go over. Up to ${L.maxCostUsd.max.toFixed(2)}, the ceiling in code.</span>
      </div>
      <div className="bf-field">
        <span className="bf-k">Daily budget</span>
        {p.budget && p.saveBudget ? (
          <>
            <BudgetForm current={p.budget.current} save={p.saveBudget} controls={p.controls} />
            <span className="sub">Spent in the last 24 hours: {money(p.budget.spentToday)}. Up to ${p.budget.ceiling} a day, the ceiling in code. Saved straight away, not as part of a version.</span>
          </>
        ) : <span className="sub">Starts at $1.00 a day, off duty. You can change it after it’s created.</span>}
      </div>
      <details className="bf-more">
        <summary>Advanced: step limit {d.limits.maxSteps}, {label(d.model)} {d.effort}</summary>
        <div className="ted-grid" style={{ paddingTop: 10 }}>
          <Field k="Tool calls per run" sub={`Up to ${L.maxSteps.max} (ceiling in code). After the last one it gets one turn to finish.`}>
            <input className="input" type="number" min={L.maxSteps.min} max={L.maxSteps.max} step={1} value={d.limits.maxSteps} onChange={(e) => change({ limits: { ...d.limits, maxSteps: Number(e.target.value) } })} />
          </Field>
          <Field k="Model" sub="Claude models only, straight to the Claude API.">
            <select className="input" value={d.model} onChange={(e) => change({ model: e.target.value })}>
              {p.menu.models.map((m) => <option key={m.id} value={m.id}>{m.label} · ${+(m.in * 1e6).toFixed(2)} in, ${+(m.out * 1e6).toFixed(2)} out per million</option>)}
            </select>
          </Field>
          <div className="bf-field">
            <span className="bf-k">Effort</span>
            <div className="seg" role="radiogroup" aria-label="Effort">
              {p.menu.efforts.map((e) => <button key={e} type="button" role="radio" aria-checked={d.effort === e} className={d.effort === e ? "on" : ""} onClick={() => change({ effort: e })}>{e}</button>)}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

/** The "so far" rail: each answered step with what it holds. Tap one to jump to it. On save it grows into the agent map. */
function SoFar({ d, menu, cur, onJump }: { d: AgentSpec; menu: BuilderMenu; cur: number; onJump: (i: number) => void }) {
  const sum = summarize(d, menu);
  const done = cur;
  return (
    <aside className="bf-rail" aria-label={`${d.name || "Agent"} so far`}>
      <span className="bf-k" style={{ marginBottom: 12 }}>{d.name.trim() || "It"} so far</span>
      {STEPS.map((s, i) => {
        const state = i < done ? "done" : i === done ? "now" : "later";
        const inner = (
          <>
            <span className="bf-node"><span className={`bf-dot ${state}`}>{state === "done" ? "✓" : i + 1}</span><span className={`bf-line ${i < done ? "done" : ""}`} /></span>
            <span className="bf-rail-t">
              <b>{s.title}</b>
              {state !== "later" && <span className="muted">{sum[s.key].line}</span>}
              {state !== "later" && sum[s.key].chips.length > 0 && <span className="bf-chips sm">{sum[s.key].chips.map((c, j) => <span key={`${c.label}${j}`} className={`bf-pop tone-${c.tone}`} style={{ animationDelay: `${j * 60}ms` }}>{c.label}</span>)}</span>}
            </span>
          </>
        );
        return <button key={s.key} type="button" className={`bf-rail-row ${state}`} onClick={() => onJump(i)}>{inner}</button>;
      })}
      <div className="bf-rail-row later"><span className="bf-node"><span className="bf-dot later">{STEPS.length + 1}</span></span><span className="bf-rail-t"><b>{AFTER_STEPS.join(", then ")}</b></span></div>
      <span className="sub" style={{ marginTop: 14 }}>Each answer adds a piece here. Tap one to go back to it.</span>
    </aside>
  );
}
