"use client";
// Crew > Org chart (docs/org-chart.md, slice 1): you on top, Avery's company seat, then each
// department with its head and the seats under it. A seat links to the agent sitting there, or for
// an open seat to New agent with the seat filled in. Edit chart opens each seat and department to
// rename it, add seats under it, pick who sits there or remove it. The server checks every change.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import type { DeptView, OrgView, SeatAgent, SeatView } from "../org";
import { Toast } from "./client";
import { Icon } from "./Icon";

type Act<T extends unknown[]> = (...a: T) => Promise<ActionResult>;
export interface OrgActions {
  addDept: Act<[string]>;
  renameDept: Act<[string, string]>;
  removeDept: Act<[string]>;
  addSeat: Act<[string, string, string]>;
  editSeat: Act<[string, string, string]>;
  removeSeat: Act<[string]>;
  setHolder: Act<[string, string]>;
}

type Open = { kind: "seat"; seat: SeatView; head: boolean; company: boolean } | { kind: "dept"; dept: DeptView } | null;

export function OrgChart({ v, actions }: { v: OrgView; actions: OrgActions }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const [dept, setDept] = useState("");
  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); if (r.ok) after?.(r); router.refresh();
  });
  const pick = (seat: SeatView, head = false, company = false) => setOpen({ kind: "seat", seat, head, company });

  return (
    <div className="org">
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <span className="ink2" style={{ flex: "1 1 300px", fontSize: 13, lineHeight: 1.5 }}>
          Where each agent sits and who it reports to. A seat gives an agent nothing by itself: what it can read or do is still its own setup.
        </span>
        <button type="button" className={`btn ${editing ? "dark" : "outline"} sm`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
          <Icon name={editing ? "check" : "pencil"} size={14} />{editing ? "Done editing" : "Edit chart"}
        </button>
      </div>

      {v.problems.length > 0 && <div className="card" style={{ borderLeft: "4px solid var(--red)", gap: 4 }}>{v.problems.map((p) => <span key={p} style={{ fontSize: 13 }}>{p}</span>)}</div>}

      <div className="org-top">
        <div className="org-seat you"><span className="av" style={{ width: 32, height: 32, background: "var(--ink)", color: "var(--ws)", fontSize: 13, fontWeight: 700 }}>Z</span><span className="org-who"><b>You</b><span>Owner · every approval is yours</span></span></div>
        <span className="org-stem" aria-hidden="true" />
        {v.company ? <SeatCard s={v.company} editing={editing} onPick={() => pick(v.company!, false, true)} wide /> : <span className="muted" style={{ fontSize: 13 }}>No company seat yet.</span>}
        {v.departments.length > 0 && <span className="org-stem" aria-hidden="true" />}
      </div>

      <div className="org-depts">
        {v.departments.map((d) => (
          <section key={d.id} className={`card org-dept${wideDept(d) ? " wide" : ""}`} aria-label={`${d.name} department`}>
            <div className="org-dept-h">
              <span className="org-dept-n">{d.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{d.seats} seat{d.seats === 1 ? "" : "s"}{d.planned ? ` · ${d.planned} planned` : ""}{d.open ? ` · ${d.open} open` : ""}</span>
              {editing && <button type="button" className="btn ghost xs" style={{ marginLeft: "auto" }} onClick={() => setOpen({ kind: "dept", dept: d })}>Edit</button>}
            </div>
            <Tree s={d.head} editing={editing} onPick={pick} head cols={wideDept(d)} />
          </section>
        ))}
        {editing && (
          <section className="card dashed org-dept" aria-label="Add a department">
            <span className="org-dept-n">New department</span>
            <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>It starts with an open head seat. Add seats under the head, then build agents for them.</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Customer care" maxLength={60} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department name" />
              <button type="button" className="btn dark sm" disabled={busy || !dept.trim()} onClick={() => run(() => actions.addDept(dept), () => setDept(""))}>Add</button>
            </div>
          </section>
        )}
      </div>

      {v.offChart.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="card-t">Not on the chart yet</span>
          <span className="ink2" style={{ fontSize: 13 }}>Put one in a seat with Edit chart, or from step 1 when you edit it.</span>
          <div className="crew-grid">{v.offChart.map((a) => <AgentCard key={a.id} a={a} />)}</div>
        </div>
      )}

      {open?.kind === "seat" && <SeatEditor o={open} v={v} busy={busy} run={run} actions={actions} close={() => setOpen(null)} />}
      {open?.kind === "dept" && <DeptEditor d={open.dept} busy={busy} run={run} actions={actions} close={() => setOpen(null)} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** A department with leads that have their own teams spreads its leads side by side, like a printed chart. */
const wideDept = (d: DeptView) => d.head.kids.length >= 3 && d.head.kids.some((k) => k.kids.length > 0);

function Tree({ s, editing, onPick, head, cols }: { s: SeatView; editing: boolean; onPick: (s: SeatView, head?: boolean) => void; head?: boolean; cols?: boolean }) {
  return (
    <div className="org-node">
      <SeatCard s={s} editing={editing} onPick={() => onPick(s, head)} head={head} />
      {s.kids.length > 0 && <div className={`org-kids${cols ? " cols" : ""}`}>{s.kids.map((k) => <Tree key={k.id} s={k} editing={editing} onPick={onPick} />)}</div>}
    </div>
  );
}

function Face({ a }: { a: SeatAgent }) {
  return <span className={`av${a.planned ? " planned" : ""}`} style={{ width: 32, height: 32, background: a.hue ?? undefined }}><Icon name={a.icon} size={15} style={a.hue ? undefined : { opacity: 0.6 }} /></span>;
}

function SeatCard({ s, editing, onPick, head, wide }: { s: SeatView; editing: boolean; onPick: () => void; head?: boolean; wide?: boolean }) {
  const cls = `org-seat${s.holder === "open" ? " open" : s.holder === "zak" ? " you" : s.agent?.planned ? " plan" : ""}${wide ? " wide" : ""}`;
  const inner = (
    <>
      {s.agent ? <Face a={s.agent} /> : s.holder === "zak" ? <span className="av" style={{ width: 32, height: 32, background: "var(--ink)", color: "var(--ws)", fontSize: 13, fontWeight: 700 }}>Z</span> : <span className="av org-plus" style={{ width: 32, height: 32 }}><Icon name="plus" size={15} /></span>}
      <span className="org-who">
        <b>{s.agent ? s.agent.name : s.holder === "zak" ? "You" : s.title}</b>
        <span>{s.agent || s.holder === "zak" ? [s.title, s.sub].filter(Boolean).join(" · ") : s.sub || "Open seat"}</span>
        {s.agent && !s.agent.planned && <span className="org-last">{s.agent.look.label} · {s.agent.last}</span>}
        {s.holder === "open" && !editing && <span className="org-last">Open · build an agent for it</span>}
      </span>
      {head && <span className="tag" style={{ flex: "none" }}>HEAD</span>}
      {s.agent?.planned && <span className="tag" style={{ flex: "none" }}>PLANNED</span>}
      {editing && <Icon name="pencil" size={13} style={{ flex: "none", opacity: 0.5 }} />}
    </>
  );
  if (editing) return <button type="button" className={cls} onClick={onPick} aria-label={`Edit seat ${s.title}`}>{inner}</button>;
  if (s.agent) return <Link href={s.agent.href} className={cls}>{inner}</Link>;
  if (s.holder === "open") return <Link href={`/build/new?seat=${s.id}`} className={cls}>{inner}</Link>;
  return <div className={cls}>{inner}</div>;
}

function AgentCard({ a }: { a: SeatAgent }) {
  return (
    <Link href={a.href} className={`card crew-card${a.planned ? " dashed" : ""}`}>
      <span className="row" style={{ gap: 12 }}>
        <Face a={a} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span><span className="muted clip" style={{ fontSize: 12.5 }}>{a.role}</span></span>
        <span className="pill sm" style={{ background: a.look.bg, color: a.look.fg }}>{a.look.label}</span>
      </span>
      <span className="muted" style={{ fontSize: 12 }}>{a.last}</span>
    </Link>
  );
}

type Runner = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => void;

function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal org-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", flex: 1 }}>{title}</h3>
          <button type="button" className="btn ghost sm" onClick={close} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SeatEditor({ o, v, busy, run, actions, close }: { o: Extract<Open, { kind: "seat" }>; v: OrgView; busy: boolean; run: Runner; actions: OrgActions; close: () => void }) {
  const s = o.seat;
  const [title, setTitle] = useState(s.title), [sub, setSub] = useState(s.sub);
  const [who, setWho] = useState(s.holder === "agent" && s.agent ? `agent:${s.agent.id}` : s.holder);
  const [kt, setKt] = useState(""), [ks, setKs] = useState("");
  const canRemove = !o.head && !o.company && s.holder === "open" && !s.kids.length;
  return (
    <Sheet title={s.title} close={close}>
      <div className="bf-stack" style={{ gap: 14 }}>
        <div className="org-form">
          <label className="bf-field"><span className="bf-k">Seat name</span><input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="bf-field"><span className="bf-k">What it covers</span><input className="input" value={sub} maxLength={120} onChange={(e) => setSub(e.target.value)} placeholder="Klaviyo flows" /></label>
          <button type="button" className="btn outline sm" disabled={busy || !title.trim() || (title === s.title && sub === s.sub)} onClick={() => run(() => actions.editSeat(s.id, title, sub))}>Save name</button>
        </div>
        <div className="org-form">
          <label className="bf-field">
            <span className="bf-k">Who sits here</span>
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="open">Nobody yet (open)</option>
              <option value="zak">You (a job that stays with a person)</option>
              {v.choices.map((c) => <option key={c.id} value={`agent:${c.id}`}>{c.label}{c.seat && `agent:${c.id}` !== (s.agent ? `agent:${s.agent.id}` : "") ? ` · now in ${c.seat}` : ""}</option>)}
            </select>
            <span className="sub">An agent that sits somewhere else moves here, and its old seat opens.</span>
          </label>
          <button type="button" className="btn dark sm" disabled={busy || who === (s.holder === "agent" && s.agent ? `agent:${s.agent.id}` : s.holder)} onClick={() => run(() => actions.setHolder(s.id, who), close)}>Set</button>
        </div>
        {!o.company && (
          <div className="org-form">
            <span className="bf-k">Add a seat under it</span>
            <input className="input" value={kt} maxLength={60} onChange={(e) => setKt(e.target.value)} placeholder="Seat name, like Subscriptions" aria-label="New seat name" />
            <input className="input" value={ks} maxLength={120} onChange={(e) => setKs(e.target.value)} placeholder="What it covers (optional)" aria-label="What the new seat covers" />
            <button type="button" className="btn outline sm" disabled={busy || !kt.trim()} onClick={() => run(() => actions.addSeat(s.id, kt, ks), () => { setKt(""); setKs(""); })}>Add seat</button>
          </div>
        )}
        {canRemove && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", color: "var(--red-ink)" }} disabled={busy} onClick={() => run(() => actions.removeSeat(s.id), close)}><Icon name="trash-2" size={14} />Remove this seat</button>}
        {!canRemove && !o.company && <span className="sub">{o.head ? "A department keeps its head seat; remove the department instead." : s.kids.length ? "Remove the seats under it first to remove this one." : "Open the seat first to remove it."}</span>}
      </div>
    </Sheet>
  );
}

function DeptEditor({ d, busy, run, actions, close }: { d: DeptView; busy: boolean; run: Runner; actions: OrgActions; close: () => void }) {
  const [name, setName] = useState(d.name);
  const empty = d.open === d.seats;
  return (
    <Sheet title={d.name} close={close}>
      <div className="bf-stack" style={{ gap: 14 }}>
        <div className="org-form">
          <label className="bf-field"><span className="bf-k">Department name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" className="btn outline sm" disabled={busy || !name.trim() || name === d.name} onClick={() => run(() => actions.renameDept(d.id, name), close)}>Rename</button>
        </div>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", color: "var(--red-ink)" }} disabled={busy || !empty} onClick={() => run(() => actions.removeDept(d.id), close)}><Icon name="trash-2" size={14} />Remove {d.name}</button>
        {!empty && <span className="sub">Only a department where every seat is open can be removed. Move its agents and your seats out first.</span>}
      </div>
    </Sheet>
  );
}
