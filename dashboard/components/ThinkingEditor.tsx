"use client";
// The Thinking editor on the agent canvas (docs/agent-setup.md, slice 2): model, effort,
// fallback model and instructions, picked from the agent's menu. The locked safety block is
// shown but can't be edited. The draft, Preview, save and versions are shared with the other
// boxes (setupEditor.tsx). The server checks everything again.
import type { Effort } from "@/core/setup";
import { Icon } from "./Icon";
import { DraftPill, EditorFooter, money, n0, useSetupEditor, type SetupEditorData } from "./setupEditor";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const perM = (p: number | null) => (p == null ? "no price" : `$${+(p * 1e6).toFixed(2)}`);

export function ThinkingEditor({ d }: { d: SetupEditorData }) {
  const e = useSetupEditor(d);
  const { draft, change, start: base } = e;
  const picked = d.models.find((m) => m.id === draft.model);
  const providers = [...new Set(d.models.map((m) => m.provider))];
  const name = (id: string | null) => (id ? d.models.find((m) => m.id === id)?.label ?? id : "None");
  const runCost = (m: string) => {
    const p = d.models.find((x) => x.id === m);
    return d.usage && p?.in != null && p.out != null ? d.usage.avgIn * p.in + d.usage.avgOut * p.out : null;
  };
  const tooLong = draft.instructions.length > d.maxChars, empty = !draft.instructions.trim();
  const nowCost = runCost(base.model), draftCost = runCost(draft.model);
  return (
    <div className="card" style={{ gap: 16 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="node-ic"><Icon name="cpu" size={13} /></span>
        <span className="card-t">Edit Thinking</span>
        <span className="sub" style={{ flex: 1 }}>{d.stepLabel}. Needs: {d.needs}</span>
        <DraftPill d={d} e={e} />
      </div>
      {d.blocked && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{d.blocked}</div>}

      <div className="ted-grid">
        <label className="ted-field">
          <span className="ted-k">Model</span>
          <select className="input" value={draft.model} onChange={(e) => change({ model: e.target.value, fallback: draft.fallback === e.target.value ? null : draft.fallback })}>
            {providers.map((p) => <optgroup key={p} label={p}>{d.models.filter((m) => m.provider === p).map((m) => <option key={m.id} value={m.id}>{m.label} · {perM(m.in)} in, {perM(m.out)} out per million</option>)}</optgroup>)}
          </select>
          <span className="sub">{picked?.gateway ? `Through Vercel AI Gateway. Today’s facts and Avery’s memory go to ${picked.provider} for this call.${d.gatewayReady ? "" : " The gateway can’t sign in here (no AI_GATEWAY_API_KEY, not on Vercel), so this would fall back."}` : "Straight to the Claude API, with Avery’s Claude key."} Only models that can return the watch list, focus and memory shape are listed.</span>
        </label>
        <div className="ted-field">
          <span className="ted-k">Effort</span>
          <div className="seg" role="radiogroup" aria-label="Effort">
            {EFFORTS.map((e) => <button key={e} type="button" role="radio" aria-checked={draft.effort === e} className={draft.effort === e ? "on" : ""} onClick={() => change({ effort: e })}>{e}</button>)}
          </div>
          <span className="sub">{picked?.gateway ? "On other providers, effort sets a thinking budget (about 1K, 4K or 10K tokens) that the gateway maps to the model’s own setting." : "How hard Claude thinks before it answers. More effort, more tokens."}</span>
        </div>
        <label className="ted-field">
          <span className="ted-k">Fallback model</span>
          <select className="input" value={draft.fallback ?? ""} onChange={(e) => change({ fallback: e.target.value || null })}>
            <option value="">None. Straight to the fixed rules.</option>
            {d.models.filter((m) => m.id !== draft.model).map((m) => <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>)}
          </select>
          <span className="sub">Tried once if {name(draft.model)} can’t be reached or answers in the wrong shape. If both fail, fixed rules write the watch list and focus.</span>
        </label>
        <div className="ted-field">
          <span className="ted-k">Cost per run</span>
          {d.usage ? (
            <span style={{ fontSize: 14 }}>About <b>{nowCost == null ? "?" : money(nowCost)}</b> now{draft.model !== base.model && <> · <b>{draftCost == null ? "?" : money(draftCost)}</b> with this draft</>}</span>
          ) : <span style={{ fontSize: 14 }}>No real run has called a model yet, so there is nothing to estimate from.</span>}
          <span className="sub">{d.usage ? `From the price table and the average tokens of the last ${d.usage.runs} real run${d.usage.runs === 1 ? "" : "s"} (${n0(d.usage.avgIn)} in, ${n0(d.usage.avgOut)} out). Effort changes how many tokens a run uses, so treat this as a guide.` : "The price table is in integrations/models.ts."}</span>
        </div>
      </div>

      <div className="ted-field">
        <span className="ted-k"><Icon name="lock" size={12} /> Safety block · locked</span>
        <span className="setup-long" style={{ marginTop: 0 }}>{d.safety}</span>
        <span className="sub">Always sent first, before the instructions below. Set in code; no setup can change it.</span>
      </div>

      <label className="ted-field">
        <span className="row wrap" style={{ gap: 8, justifyContent: "space-between" }}>
          <span className="ted-k">Instructions</span>
          <span className="row" style={{ gap: 8 }}>
            <span className="sub" style={tooLong ? { color: "var(--red-ink)" } : undefined}>{n0(draft.instructions.length)} of {n0(d.maxChars)} characters</span>
            {draft.instructions.trim() !== d.builtIn.trim() && <button type="button" className="btn ghost xs" onClick={() => change({ instructions: d.builtIn })}>Use the built-in text</button>}
          </span>
        </span>
        <textarea className="input ted-text" rows={14} value={draft.instructions} onChange={(e) => change({ instructions: e.target.value })} aria-label="Instructions" />
        {empty && <span className="sub" style={{ color: "var(--red-ink)" }}>Instructions can’t be empty.</span>}
      </label>

      <EditorFooter d={d} e={e} lines={[{ k: "Model", v: name(draft.model) }, { k: "Effort", v: draft.effort }, { k: "Fallback", v: name(draft.fallback) }, { k: "Instructions", v: `${n0(draft.instructions.trim().length)} characters` }]} />
    </div>
  );
}

