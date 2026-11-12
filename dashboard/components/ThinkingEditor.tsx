"use client";
// The Thinking editor on the agent canvas (docs/agent-setup.md, slice 2): model, effort,
// fallback model and instructions, picked from the agent's menu, plus any other thinking steps
// (Quinn's two) and pick-lists that live in this box (Rowan's kinds of business). The locked
// safety block is shown but can't be edited, and instructions fixed in code are only shown. The draft, Preview, save and versions are shared with the other
// boxes (setupEditor.tsx). The server checks everything again.
import type { Effort } from "@/core/setup";
import { Icon } from "./Icon";
import { ChoicePicker, NumberField } from "./ReadsWritesEditor";
import { DraftPill, EditorFooter, money, n0, useSetupEditor, type EditorModel, type SetupEditorData } from "./setupEditor";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const perM = (p: number | null) => (p == null ? "no price" : `$${+(p * 1e6).toFixed(2)}`);

function ModelSelect({ models, value, onChange, label }: { models: EditorModel[]; value: string; onChange: (id: string) => void; label: string }) {
  const providers = [...new Set(models.map((m) => m.provider))];
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {providers.map((p) => <optgroup key={p} label={p}>{models.filter((m) => m.provider === p).map((m) => <option key={m.id} value={m.id}>{m.label} · {perM(m.in)} in, {perM(m.out)} out per million</option>)}</optgroup>)}
    </select>
  );
}

function EffortSeg({ value, onChange, label }: { value: Effort; onChange: (e: Effort) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {EFFORTS.map((e) => <button key={e} type="button" role="radio" aria-checked={value === e} className={value === e ? "on" : ""} onClick={() => onChange(e)}>{e}</button>)}
    </div>
  );
}

export function ThinkingEditor({ d }: { d: SetupEditorData }) {
  const e = useSetupEditor(d);
  const { draft, change, start: base } = e;
  const picked = d.models.find((m) => m.id === draft.model);
  const name = (id: string | null) => (id ? d.models.find((m) => m.id === id)?.label ?? id : "None");
  const runCost = (m: string) => {
    const p = d.models.find((x) => x.id === m);
    return d.usage && p?.in != null && p.out != null ? d.usage.avgIn * p.in + d.usage.avgOut * p.out : null;
  };
  const tooLong = draft.instructions.length > d.maxChars, empty = !draft.instructions.trim();
  // with several steps the average run mixes models, so the estimate is only for one-step agents
  const nowCost = d.more.length ? null : runCost(base.model), draftCost = d.more.length ? null : runCost(draft.model);
  const nums = d.numbers.filter((n) => n.box === "thinking"), picks = d.choices.filter((c) => c.box === "thinking");
  const many = d.more.length > 0;
  return (
    <div className="card" style={{ gap: 16 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="node-ic"><Icon name="cpu" size={13} /></span>
        <span className="card-t">Edit Thinking</span>
        <span className="sub" style={{ flex: 1 }}>{many ? `${d.more.length + 1} steps, each with its own model.` : `${d.stepLabel}. Needs: ${d.needs}`}</span>
        <DraftPill d={d} e={e} />
      </div>
      {d.blocked && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{d.blocked}</div>}

      <div className="ted-grid">
        <label className="ted-field">
          <span className="ted-k">{many ? `Step 1 · ${d.stepLabel}` : "Model"}</span>
          <ModelSelect models={d.models} label={many ? `${d.stepLabel} model` : "Model"} value={draft.model} onChange={(id) => change({ model: id, fallback: draft.fallback === id ? null : draft.fallback })} />
          <span className="sub">{picked?.gateway ? `Through Vercel AI Gateway. Today’s facts and ${d.agentName}’s memory go to ${picked.provider} for this call.${d.gatewayReady ? "" : " The gateway can’t sign in here (no AI_GATEWAY_API_KEY, not on Vercel), so this would fall back."}` : `Straight to the Claude API, with ${d.agentName}’s Claude key.`} {many ? `Needs: ${d.needs}.` : "Only models that can do this step are listed."}</span>
        </label>
        <div className="ted-field">
          <span className="ted-k">{many ? "Step 1 effort" : "Effort"}</span>
          <EffortSeg value={draft.effort} label={many ? `${d.stepLabel} effort` : "Effort"} onChange={(x) => change({ effort: x })} />
          <span className="sub">{picked?.gateway ? "On other providers, effort sets a thinking budget (about 1K, 4K or 10K tokens) that the gateway maps to the model’s own setting." : "How hard Claude thinks before it answers. More effort, more tokens."}</span>
        </div>
        {d.more.map((st, k) => {
          const c = draft.more[st.id];
          if (!c) return null;
          return [
            <label key={`${st.id}-m`} className="ted-field">
              <span className="ted-k">Step {k + 2} · {st.label}</span>
              <ModelSelect models={st.models} label={`${st.label} model`} value={c.model} onChange={(id) => change({ more: { ...draft.more, [st.id]: { ...c, model: id } } })} />
              <span className="sub">Needs: {st.needs}.</span>
            </label>,
            <div key={`${st.id}-e`} className="ted-field">
              <span className="ted-k">Step {k + 2} effort</span>
              <EffortSeg value={c.effort} label={`${st.label} effort`} onChange={(x) => change({ more: { ...draft.more, [st.id]: { ...c, effort: x } } })} />
            </div>,
          ];
        })}
        {d.fallbackOff
          ? <div className="ted-field"><span className="ted-k">Fallback model</span><span style={{ fontSize: 14 }}>None</span><span className="sub">{d.agentName}’s code has no fallback for this step, so none can be picked.</span></div>
          : <label className="ted-field">
            <span className="ted-k">Fallback model</span>
            <select className="input" value={draft.fallback ?? ""} onChange={(e) => change({ fallback: e.target.value || null })}>
              <option value="">None. Straight to the fixed rules.</option>
              {d.models.filter((m) => m.id !== draft.model).map((m) => <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>)}
            </select>
            <span className="sub">Tried once if {name(draft.model)} can’t be reached or answers in the wrong shape. If both fail, {d.agentName}’s fixed rules take over.</span>
          </label>}
        {nums.map((n) => <NumberField key={n.key} n={n} value={draft.numbers[n.key]} onChange={(v) => change({ numbers: { ...draft.numbers, [n.key]: v } })} />)}
        <div className="ted-field">
          <span className="ted-k">Cost per run</span>
          {many ? (
            <span style={{ fontSize: 14 }}>{d.usage ? `About ${n0(d.usage.avgIn)} tokens in and ${n0(d.usage.avgOut)} out a run, split across the steps.` : "No real run has called a model yet, so there is nothing to estimate from."}</span>
          ) : d.usage ? (
            <span style={{ fontSize: 14 }}>About <b>{nowCost == null ? "?" : money(nowCost)}</b> now{draft.model !== base.model && <> · <b>{draftCost == null ? "?" : money(draftCost)}</b> with this draft</>}</span>
          ) : <span style={{ fontSize: 14 }}>No real run has called a model yet, so there is nothing to estimate from.</span>}
          <span className="sub">{d.usage ? `From the price table and the average tokens of the last ${d.usage.runs} real run${d.usage.runs === 1 ? "" : "s"} (${n0(d.usage.avgIn)} in, ${n0(d.usage.avgOut)} out). Effort changes how many tokens a run uses, so treat this as a guide.` : "The price table is in integrations/models.ts."}</span>
        </div>
      </div>

      <div className="ted-field">
        <span className="ted-k"><Icon name="lock" size={12} /> Safety block · locked</span>
        <span className="setup-long" style={{ marginTop: 0 }}>{d.safety}</span>
        <span className="sub">{d.instructionsLocked ? "Part of the prompts in code; no setup can change it." : "Always sent first, before the instructions below. Set in code; no setup can change it."}</span>
      </div>

      {picks.map((c) => <ChoicePicker key={c.key} c={c} value={draft.choices[c.key] ?? c.default} onChange={(v) => change({ choices: { ...draft.choices, [c.key]: v } })} />)}

      {d.instructionsLocked ? (
        <div className="ted-field">
          <span className="ted-k"><Icon name="lock" size={12} /> Instructions · fixed in code</span>
          <span className="setup-long" style={{ marginTop: 0 }}>{d.builtIn}</span>
          <span className="sub">Short prompts whose answers code checks, so a setup can’t change them. Your notes and lessons on the Memory tab still reach {d.agentName}.</span>
        </div>
      ) : (
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
      )}

      <EditorFooter d={d} e={e} lines={[
        { k: many ? d.stepLabel : "Model", v: `${name(draft.model)}${many ? `, effort ${draft.effort}` : ""}` },
        ...(many ? d.more.map((st) => ({ k: st.label, v: `${st.models.find((m) => m.id === draft.more[st.id]?.model)?.label ?? draft.more[st.id]?.model}, effort ${draft.more[st.id]?.effort}` })) : [{ k: "Effort", v: draft.effort }]),
        ...(d.fallbackOff ? [] : [{ k: "Fallback", v: name(draft.fallback) }]),
        ...nums.map((n) => ({ k: n.label, v: `${draft.numbers[n.key]} ${n.unit}` })),
        ...picks.map((c) => ({ k: c.label, v: `${(draft.choices[c.key] ?? c.default).length} picked` })),
        { k: "Instructions", v: d.instructionsLocked ? "Fixed in code" : `${n0(draft.instructions.trim().length)} characters` },
      ]} />
    </div>
  );
}

