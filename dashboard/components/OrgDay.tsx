"use client";
// Crew > Schedule, slice 2 (docs/org-schedule.md): the org's day (every agent's run on one timeline,
// by department), the cost table (cost a run and a month, Scheduled or By hand, the total) and one
// agent's schedule (days, time, on duty). Numbers come from dashboard/orgDay.ts, worked out in code
// on the server; this only shows them and sends the owner's choices to the server actions, which check
// everything again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/dashboard/actions";
import { DAY_RUNS, DAY_WORDS, DAYS, type AgentTime, type Days } from "@/core/flow-rules";
import type { DayRow, OrgDay as Day } from "@/dashboard/orgDay";
import { Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";

type SetTime = (agentId: string, t: AgentTime | null, confirmed: boolean) => Promise<ActionResult>;
type SetOn = (agentId: string, on: boolean) => Promise<ActionResult>;

const TZ = "America/Chicago";
const hmF = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayF = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const money = (v: number) => (v > 0 && v < 0.01 ? "under $0.01" : `$${v.toFixed(2)}`);
const perRunWords = (v: number | null) => (v == null ? "Unknown" : v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
const hourWords = (h: number) => (h === 0 || h === 24 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const t12 = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3); return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`; };
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Av({ r, size = 36 }: { r: DayRow; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: 999, background: r.hue, color: "#111114", display: "grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.34, flex: "none", opacity: r.at == null ? 0.55 : 1 }}>{initials(r.name)}</span>;
}

export function OrgDay({ day, controls, orgOn, setTime, setOn }: { day: Day; controls: boolean; orgOn: boolean; setTime: SetTime; setOn: SetOn }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => Promise<ActionResult> } | null>(null);
  const [edit, setEdit] = useState<DayRow | null>(null);

  const run = (go: () => Promise<ActionResult>) => start(async () => {
    let res: ActionResult;
    try { res = await go(); } catch (e) { res = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(res); setConfirm(null); if (res.ok) setEdit(null); router.refresh();
  });

  const toHand = (r: DayRow) => setConfirm({
    c: { title: `Make ${r.name} run only by hand?`, body: `${r.name} leaves the schedule${r.schedule.chain ? ` (and the ${r.schedule.chain} chain)` : ""} and runs only when you press Run.`, lines: [{ k: "A month", v: `${money(r.perMonth)} → $0 unless you press Run` }], confirmLabel: "By hand only" },
    go: () => setTime(r.id, null, true),
  });

  const [from, to] = day.window;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
  const anchor = day.rows.filter((r) => r.reportsToYou && r.at != null).sort((a, b) => a.at! - b.at!)[0];

  return (
    <>
      {/* ---- the org's day */}
      <section className="card" aria-label="The org's day" style={{ gap: 12 }}>
        <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="card-t">The org’s day</span>
            <span className="sub">Central Time{orgOn ? "" : " · runs only once the org is on"} · tap an agent to change when it runs</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div className="od-wrap">
            <div className="od-row od-head">
              <span />
              <div style={{ position: "relative", height: 34 }}>
                {hours.map((h, i) => <span key={h} className={"sub" + (i % 2 && i !== hours.length - 1 ? " od-odd" : "")} style={{ position: "absolute", bottom: 0, left: pct(i / (to - from)), transform: i === 0 ? "none" : i === hours.length - 1 ? "translateX(-100%)" : "translateX(-50%)", whiteSpace: "nowrap" }}>{hourWords(h)}</span>)}
                {anchor && <span className="pill sm od-anchor" style={{ position: "absolute", top: 0, left: pct(anchor.at!), transform: "translateX(-50%)", background: "var(--acc)", color: "#111114" }}>{t12(anchor.schedule.time!)} · {anchor.name} reports to you</span>}
              </div>
            </div>
            {day.groups.map((g) => (
              <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="sub" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", paddingTop: 4 }}>{g.name}</span>
                {g.rows.map((r) => (
                  <div key={r.id} id={`agent-${r.id}`} className="od-row">
                    <button type="button" onClick={() => setEdit(r)} className="row" style={{ gap: 10, border: 0, background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", minWidth: 0 }}>
                      <Av r={r} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
                        <span className="sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.role}{r.enabled ? "" : " · off duty"}</span>
                      </span>
                    </button>
                    {r.at == null ? (
                      <button type="button" onClick={() => setEdit(r)} style={{ height: 46, borderRadius: 14, border: "1.5px dashed var(--mut2)", background: "transparent", textAlign: "left", padding: "0 14px", fontSize: 12.5, color: "var(--ink2)", cursor: "pointer" }}>
                        By hand only{r.perRun != null ? ` · ${perRunWords(r.perRun)} a run` : ""} · give it a schedule
                      </button>
                    ) : (
                      <div style={{ position: "relative", height: 46, borderRadius: 14, background: r.reportsToYou ? "var(--acc-soft)" : "var(--canvas)", backgroundImage: `repeating-linear-gradient(to right, var(--bd) 0, var(--bd) 1px, transparent 1px, transparent ${100 / (to - from)}%)` }}>
                        <button type="button" onClick={() => setEdit(r)} className="pill sm" style={{ position: "absolute", top: "50%", left: pct(r.at), transform: "translate(-50%, -50%)", border: 0, cursor: "pointer", background: r.reportsToYou ? "var(--acc)" : "var(--ink)", color: r.reportsToYou ? "#111114" : "var(--ws)" }}>
                          {t12(r.schedule.time!)} · {r.schedule.kind}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {!day.rows.length && <span className="sub">No agent is in the org yet.</span>}
          </div>
        </div>
        {day.left.length > 0 && <span className="sub">Left out of the org (test): {day.left.join(", ")}. Turning on the org never wakes them.</span>}
      </section>

      {/* ---- what the org costs */}
      <section className="card" aria-label="What the org costs a month" style={{ gap: 12 }}>
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 320px" }}>
            <span className="card-t">What the org costs a month</span>
            <span className="sub">Each agent’s average over its last 10 runs (or its cap before it has run), times its runs in 30 days. By hand costs nothing unless you press Run.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.02em" }}>{money(day.totalMonth)}</span>
            <span className="sub">{day.scheduled} scheduled · {day.byHand} by hand{day.unknownCost.length ? ` · ${day.unknownCost.join(", ")} not counted yet (no runs)` : ""}</span>
          </div>
        </div>
        {day.totalMonth > 0 && (
          <div role="img" aria-label="Share of the monthly cost by agent" style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", gap: 2, background: "var(--soft)" }}>
            {day.rows.filter((r) => r.perMonth > 0).map((r) => <span key={r.id} title={`${r.name}: ${money(r.perMonth)}`} style={{ flex: `${r.perMonth} 1 0`, background: r.hue }} />)}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <div className="oc-wrap">
            <div className="sub oc-row oc-head">
              <span>Agent</span><span>When</span><span style={{ textAlign: "right" }}>A run</span><span style={{ textAlign: "right" }}>A month</span><span style={{ textAlign: "right" }}>Runs</span>
            </div>
            {day.rows.map((r) => (
              <div key={r.id} className="rule oc-row">
                <button type="button" onClick={() => setEdit(r)} className="row" style={{ gap: 10, border: 0, background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", minWidth: 0 }}>
                  <Av r={r} size={30} />
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
                </button>
                <span className="ink2 oc-when" style={{ fontSize: 13 }}>{r.at == null ? "Only when you press Run" : r.when}</span>
                <span className="ink2 oc-run" style={{ fontSize: 13, textAlign: "right" }}>{perRunWords(r.perRun)}<span className="oc-label"> a run</span></span>
                <span className="oc-month" style={{ fontSize: 13.5, fontWeight: 700, textAlign: "right", color: r.perMonth ? "var(--ink)" : "var(--mut)" }}>{r.at == null ? "$0.00" : r.perRun == null ? "Unknown" : money(r.perMonth)}<span className="oc-label"> a month</span></span>
                <span className="oc-toggle">
                  <span className="seg" role="group" aria-label={`${r.name}: scheduled or by hand`}>
                    <button type="button" aria-pressed={r.at != null} disabled={busy} onClick={() => (r.at == null ? setEdit(r) : undefined)}
                      style={r.at != null ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 4px rgba(17,17,26,.12)" } : undefined}>Scheduled</button>
                    <button type="button" aria-pressed={r.at == null} disabled={busy} onClick={() => (r.at != null ? toHand(r) : undefined)}
                      style={r.at == null ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 4px rgba(17,17,26,.12)" } : undefined}>By hand</button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {edit && <Editor r={edit} controls={controls} orgOn={orgOn} busy={busy} onClose={() => setEdit(null)}
        onSave={(t, needsConfirm) => {
          if (!needsConfirm) return run(() => setTime(edit.id, t, false));
          setConfirm({
            c: { title: `Let ${edit.name} run ${DAY_WORDS[t.days]} at ${t12(t.time)}?`, body: `${edit.name} runs on this schedule while the org is on and ${edit.name} is on duty, inside its daily budget.`, lines: [{ k: "A run", v: perRunWords(edit.perRun) }, { k: "A month", v: edit.perRun == null ? "Unknown until it has run" : money(edit.perRun * DAY_RUNS[t.days]) }], confirmLabel: "Save schedule" },
            go: () => setTime(edit.id, t, true),
          });
        }}
        onHand={() => toHand(edit)}
        onDuty={(on) => run(() => setOn(edit.id, on))} />}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => run(confirm.go)} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}

function Editor({ r, controls, orgOn, busy, onClose, onSave, onHand, onDuty }: {
  r: DayRow; controls: boolean; orgOn: boolean; busy: boolean; onClose: () => void;
  onSave: (t: AgentTime, needsConfirm: boolean) => void; onHand: () => void; onDuty: (on: boolean) => void;
}) {
  const [days, setDays] = useState<Days>(r.schedule.kind === "manual" ? "weekdays" : r.schedule.kind);
  const [time, setTimeV] = useState(r.schedule.time ?? "07:00");
  const scheduled = r.at != null;
  const changed = !scheduled || days !== r.schedule.kind || time !== r.schedule.time;
  // moving or adding a schedule needs Controls (the server checks again); by hand never does
  const blocked = changed && !controls;
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`${r.name}'s schedule`} onClick={(e) => e.stopPropagation()} style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <Av r={r} size={44} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>{r.name}</h3>
            <span className="sub">{r.role}{r.schedule.chain ? ` · in the ${r.schedule.chain} chain` : ""}</span>
          </div>
          <button type="button" className="round" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="soft-box">
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>On duty</span><span className="sub">{r.enabled ? "Runs go through" : "Every run is skipped at $0"}{orgOn ? "" : " · the org switch turns everyone on at once"}</span></div>
          <button type="button" className={"switch" + (r.enabled ? " on" : "")} aria-pressed={r.enabled} aria-label="On duty" disabled={busy || (!r.enabled && !controls)} title={!r.enabled && !controls ? "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this." : undefined} onClick={() => onDuty(!r.enabled)}><span /></button>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ fontSize: 13.5, fontWeight: 600, paddingBottom: 8 }}>When {r.name} runs</legend>
          <div className="seg" role="radiogroup" aria-label="Days">
            {DAYS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} style={days === d ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 4px rgba(17,17,26,.12)" } : undefined}>{{ daily: "Every day", weekdays: "Weekdays", mondays: "Mondays" }[d]}</button>
            ))}
          </div>
          <label className="row" style={{ justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
            <span>At</span>
            <select value={time} onChange={(e) => setTimeV(e.target.value)} style={{ height: 40, padding: "0 10px", borderRadius: 10, border: "1px solid var(--mut2)", background: "var(--card)" }}>
              {QUARTERS.map((q) => <option key={q} value={q}>{t12(q)}</option>)}
            </select>
          </label>
        </fieldset>

        {scheduled && r.next.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Next runs{orgOn ? "" : " once the org is on"}</span>
            <div className="row wrap" style={{ gap: 6 }}>{r.next.map((t) => <span key={t} className="pill sm" style={{ background: "var(--soft)" }}>{dayF.format(new Date(t))} · {hmF.format(new Date(t))}</span>)}</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[["A run", perRunWords(r.perRun)], ["A month", scheduled ? (r.perRun == null ? "Unknown" : money(r.perMonth)) : "$0 by hand"], ["Daily budget", `$${r.budget.toFixed(2)}`]].map(([k, v]) => (
            <div key={k} style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}><span className="sub">{k}</span><span style={{ fontSize: 15, fontWeight: 700 }}>{v}</span></div>
          ))}
        </div>

        {blocked && <span className="sub">Giving {r.name} a schedule or moving it needs DASHBOARD_CONTROLS=on in Vercel.</span>}
        <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          {scheduled ? <button type="button" className="btn ghost" onClick={onHand} disabled={busy}>Make it by hand only</button> : <span />}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn dark" disabled={busy || !changed || blocked} onClick={() => onSave({ days, time }, true)}>{busy ? "Working…" : "Save schedule"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
