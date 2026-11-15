"use client";
// Set or change a goal (docs/company-mode.md, slice 2). The measure is picked from the list in code;
// code checks everything again on save (core/goal-rules.ts planGoal).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MEASURES, measureOf } from "@/core/goal-rules";
import type { ActionResult } from "../actions";
import type { GoalForm as Form } from "../goalActions";
import { Toast } from "./client";

export function GoalForm({ depts, dept, initial, save, cancelHref }: {
  depts?: { id: string; name: string }[];
  dept?: string;
  initial?: Form;
  /** New: (dept, form). Edit: dept is ignored. */
  save: (dept: string, f: Form) => Promise<ActionResult & { id?: string }>;
  cancelHref?: string;
}) {
  const [d, setD] = useState(dept ?? depts?.[0]?.id ?? "");
  const [f, setF] = useState<Form>(initial ?? { title: "", measure: "", target: "", dueOn: "" });
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const m = measureOf(f.measure);
  const countable = !!m?.available;
  const set = (k: keyof Form, v: string) => setF({ ...f, [k]: v });
  const go = () => start(async () => {
    let r: ActionResult & { id?: string };
    try { r = await save(d, f); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Couldn’t save that." }; }
    setToast(r);
    if (r.ok && r.id) router.push(`/goals/${r.id}`);
    else if (r.ok) router.refresh();
  });
  const unit = m?.unit === "usd" ? "Dollars" : m?.unit === "days" ? "Days" : m?.unit === "months" ? "Months" : "Number";
  return (
    <div className="stack" style={{ gap: 14 }}>
      {depts && (
        <label className="bf-field"><span className="bf-k">Department</span>
          <select className="input" value={d} disabled={busy} onChange={(e) => setD(e.target.value)}>{depts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
      )}
      <label className="bf-field"><span className="bf-k">The goal, in your words</span>
        <input className="input" value={f.title} maxLength={120} disabled={busy} onChange={(e) => set("title", e.target.value)} placeholder="Land 5 wholesale accounts by Mar 31" />
      </label>
      <label className="bf-field"><span className="bf-k">How code measures it</span>
        <select className="input" value={f.measure} disabled={busy} onChange={(e) => setF({ ...f, measure: e.target.value, target: "", dueOn: measureOf(e.target.value)?.shape === "month" ? "" : f.dueOn })}>
          <option value="">Pick a measure…</option>
          <optgroup label="Code can count these">{MEASURES.filter((x) => x.available).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
          <optgroup label="Can’t count yet">{MEASURES.filter((x) => !x.available).map((x) => <option key={x.key} value={x.key}>{x.label} (needs a new read)</option>)}</optgroup>
        </select>
        {m && <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{m.available ? `Counted in code: ${m.how}` : `Code can’t count this until ${m.needs} exists. The goal shows “No measure yet” until then.`}</span>}
      </label>
      {countable && (
        <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
          <label className="bf-field" style={{ flex: "1 1 160px" }}><span className="bf-k">{m!.shape === "floor" ? "Stay at or above" : m!.shape === "month" ? "Target each month" : "Target"} · {unit}</span>
            <input className="input" inputMode="decimal" value={f.target} disabled={busy} onChange={(e) => set("target", e.target.value)} placeholder={m!.unit === "usd" ? "3000" : m!.shape === "floor" ? "45" : "5"} />
          </label>
          {m!.shape !== "month" && (
            <label className="bf-field" style={{ flex: "1 1 160px" }}><span className="bf-k">{m!.shape === "total" ? "Reach it by" : "Until (optional)"}</span>
              <input className="input" type="date" value={f.dueOn} disabled={busy} onChange={(e) => set("dueOn", e.target.value)} />
            </label>
          )}
        </div>
      )}
      {countable && m!.shape === "month" && <span className="muted" style={{ fontSize: 12 }}>A monthly goal starts again on the 1st, so it has no date.</span>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn dark" disabled={busy || !f.title.trim() || !d} onClick={go}>{busy ? "Saving…" : initial ? "Save goal" : "Set goal"}</button>
        {cancelHref && <a className="btn ghost" href={cancelHref}>Cancel</a>}
      </div>
      <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>A goal is what you want. It never lets an agent do anything new: heads read it and plan around it.</span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
