"use client";
// The Guardrails box on the agent canvas (docs/agent-setup.md, slice 6). Three bands: the crew's
// hard rules (locked), this agent's limits (in code; the daily budget can change up to its
// ceiling), and the crew-wide money and email caps (lower any time; raising needs a confirm and
// DASHBOARD_CONTROLS=on, and stops at the limit in code). Every line here is enforced in code;
// the server checks every change again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/dashboard/actions";
import type { CapDef, CapKey } from "@/core/gateway/policy";
import { Icon } from "./Icon";
import { Modal, Toast, type Confirm } from "./client";

export interface GuardLine { label: string; value: string; where: string }
export interface CapLine extends CapDef { key: CapKey; value: number; missing: boolean; used: string }
export interface GuardrailsData {
  agentId: string; agentName: string;
  hardRules: string[];
  limits: GuardLine[];
  budget: { current: number; max: number } | null;
  caps: CapLine[] | null; capsProblem?: string;
  log: { key: string; from: number | null; to: number; by: string; at: string }[];
  controls: boolean;
}

const fmt = (c: { unit: CapDef["unit"] }, v: number) => (c.unit === "usd" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : c.unit === "minutes" ? `${v} min` : `${v}`);
const Enforced = () => <span className="home-chip" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Enforced in code</span>;

function CapRow({ c, controls, save }: { c: CapLine; controls: boolean; save: (key: string, v: number, confirmed: boolean) => Promise<ActionResult> }) {
  const [v, setV] = useState(String(c.value));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const n = Number(v);
  const changed = v.trim() !== "" && Number.isFinite(n) && n !== c.value;
  const looser = changed && (c.looser === "up" ? n > c.value : n < c.value);
  const past = changed && (c.looser === "up" ? n > c.limit : n < c.limit);
  const go = (confirmed: boolean) => start(async () => {
    let r: ActionResult;
    try { r = await save(c.key, n, confirmed); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); router.refresh();
  });
  const bounds = c.looser === "up" ? `Ceiling in code: ${fmt(c, c.limit)}` : `Floor in code: ${fmt(c, c.limit)}, up to ${fmt(c, c.safest)}`;
  return (
    <div className="guard-cap">
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span className="row wrap" style={{ gap: 8 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.label}</span><Enforced />{c.missing && <span className="home-chip" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }}>Using the code default</span>}</span>
        <span className="sub">{c.about}</span>
        <span className="sub">{c.used}. {bounds}.</span>
      </div>
      <div className="row" style={{ gap: 6, flex: "none" }}>
        {c.unit === "usd" && <span className="muted">$</span>}
        <input className="input" type="number" min={0} step={c.unit === "usd" ? "0.01" : "1"} style={{ width: 96 }} value={v} aria-label={c.label} onChange={(e) => setV(e.target.value)} />
        <button className="btn dark sm" disabled={busy || !changed || past || (looser && !controls)}
          title={past ? bounds : looser && !controls ? "Raising needs DASHBOARD_CONTROLS=on" : looser ? "Needs a confirm" : "Lowering applies right away"}
          onClick={() => (looser ? setConfirm({ title: `Loosen ${c.label.toLowerCase()}?`, body: `${c.about} Every agent gets the new limit from the next check. ${bounds}.`, lines: [{ k: "Now", v: fmt(c, c.value) }, { k: "New", v: fmt(c, n) }], confirmLabel: "Save", kind: "dark" }) : go(false))}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {past && <span className="sub" style={{ color: "var(--red-ink)", flexBasis: "100%" }}>{bounds}. A pull request can change it, not this screen.</span>}
      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { setConfirm(null); go(true); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export function GuardrailsEditor({ d, saveCap, budgetForm }: { d: GuardrailsData; saveCap: (key: string, v: number, confirmed: boolean) => Promise<ActionResult>; budgetForm?: React.ReactNode }) {
  return (
    <div className="card" style={{ gap: 18 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="node-ic"><Icon name="lock" size={13} /></span>
        <span className="card-t">Guardrails</span>
        <span className="sub" style={{ flex: 1 }}>Everything code enforces for {d.agentName}. Instructions and standing orders are guidance, so they live in Thinking and Memory, not here.</span>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <span className="ted-k"><Icon name="lock" size={12} /> Crew hard rules · locked</span>
        <ol className="guard-rules">{d.hardRules.map((r) => <li key={r}>{r}</li>)}</ol>
        <span className="sub">From CLAUDE.md, enforced by the gateway, lint and token scopes. No setting can switch them off.</span>
      </section>

      <section className="stack" style={{ gap: 4 }}>
        <span className="ted-k">Limits for {d.agentName}</span>
        {d.budget && (
          <div className="setup-row">
            <span className="setup-k">Daily budget</span>
            <span className="setup-v"><span>${d.budget.current.toFixed(2)} of model spend per UTC day. Ceiling in code: ${d.budget.max}</span>{budgetForm}</span>
            <span className="setup-w"><Enforced /><span className="sub">agents.daily_budget_usd, checked by withRun. Lowering applies right away; raising needs DASHBOARD_CONTROLS=on</span></span>
          </div>
        )}
        {d.limits.map((l) => (
          <div key={l.label} className="setup-row">
            <span className="setup-k">{l.label}</span>
            <span className="setup-v"><span>{l.value}</span></span>
            <span className="setup-w"><Enforced /><span className="sub">{l.where}</span></span>
          </div>
        ))}
        <span className="sub">The others change with a pull request for now. Rowan, Quinn and Morgan get their menus in the next slice.</span>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <span className="ted-k">Money and email caps · every agent</span>
        {d.capsProblem && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{d.capsProblem}</div>}
        {d.caps?.map((c) => <CapRow key={`${c.key}:${c.value}`} c={c} controls={d.controls} save={saveCap} />)}
        <span className="sub">Lowering a cap applies right away. Raising needs a confirm{d.controls ? "" : " and DASHBOARD_CONTROLS=on"}, and stops at the limit in code. Trust levels aren’t editable here.</span>
        {d.log.length > 0 && (
          <details>
            <summary className="sub">Recent changes</summary>
            {d.log.map((l, i) => <div key={i} className="sub" style={{ padding: "4px 0" }}>{l.key}: {l.from ?? "default"} to {l.to} · {l.by} · {new Date(l.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>)}
          </details>
        )}
      </section>
    </div>
  );
}
