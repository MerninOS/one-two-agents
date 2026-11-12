"use client";
// The Reads and Writes editors on the agent canvas (docs/agent-setup.md, slice 4). Reads: each
// fact source on or off, and the reads tuning numbers within the menu's range. Writes: each
// output on or off, the Notion target picked from what the integration can see, and the
// sections of the brief, on or off and in order. The email recipient is never a choice
// (BRIEF_TO), and gateway action types are shown read only. Same draft, Preview, save and
// versions as Thinking (setupEditor.tsx); the server checks everything again.
import { useState } from "react";
import type { NotionTarget } from "@/core/setup";
import { findNotionTargets } from "../actions";
import { Icon } from "./Icon";
import { DraftPill, EditorFooter, Field, useSetupEditor, type Draft, type SetupEditorData, type SetupEditor } from "./setupEditor";

const toggle = (list: string[], id: string, on: boolean) => (on ? list.filter((x) => x !== id) : [...list, id]);

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`rw-switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Header({ d, e, icon, title, sub }: { d: SetupEditorData; e: SetupEditor; icon: string; title: string; sub: string }) {
  return (
    <>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="node-ic"><Icon name={icon} size={13} /></span>
        <span className="card-t">{title}</span>
        <span className="sub" style={{ flex: "1 1 200px" }}>{sub}</span>
        <DraftPill d={d} e={e} />
      </div>
      {d.blocked && <div className="card dashed" style={{ padding: 12, fontSize: 13 }}>{d.blocked}</div>}
    </>
  );
}

const offWords = (d: SetupEditorData, x: Draft) => {
  const off = d.reads.filter((r) => x.readsOff.includes(r.id)).map((r) => r.label);
  return off.length ? `${off.join(", ")} off` : "All on";
};

export function ReadsEditor({ d }: { d: SetupEditorData }) {
  const e = useSetupEditor(d);
  const { draft, change } = e;
  const nums = d.numbers.filter((n) => n.box === "reads");
  const dropped = (id: string) => d.sections.filter((s) => s.needs.some((n) => n.id === id)).map((s) => s.label);
  return (
    <div className="card" style={{ gap: 16 }}>
      <Header d={d} e={e} icon="database" title="Edit Reads" sub={`What ${d.agentName} looks at before thinking. Sources are code; you choose which are on.`} />
      <Field k="Fact sources">
        <div className="rw-list">
          {d.reads.map((r) => {
            const on = !draft.readsOff.includes(r.id), lose = dropped(r.id);
            return (
              <div key={r.id} className="rw-row">
                <Switch on={on} label={r.label} onChange={(v) => change({ readsOff: toggle(draft.readsOff, r.id, v) })} />
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.label}</span>
                  <span className="sub">{r.detail}</span>
                  {!on && <span className="sub" style={{ color: "var(--yel-ink)" }}>Not read. The model is told it was turned off, so it won’t treat it as zero.{lose.length ? ` ${lose.join(" and ")} ${lose.length === 1 ? "is" : "are"} left out of the brief.` : ""}</span>}
                </div>
                <span className={`pill sm`} style={r.connected ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--red-soft)", color: "var(--red-ink)" }}>{r.connected ? "Connected" : "Missing key"}</span>
              </div>
            );
          })}
        </div>
      </Field>
      {nums.length > 0 && (
        <div className="ted-grid">
          {nums.map((n) => (
            <label key={n.key} className="ted-field">
              <span className="ted-k">{n.label}</span>
              <span className="row" style={{ gap: 8 }}>
                <input className="input" type="number" min={n.min} max={n.max} step={1} style={{ width: 96 }} value={Number.isFinite(draft.numbers[n.key]) ? draft.numbers[n.key] : ""} onChange={(x) => change({ numbers: { ...draft.numbers, [n.key]: x.target.value === "" ? NaN : Number(x.target.value) } })} aria-label={n.label} />
                <span className="sub">{n.unit}</span>
              </span>
              <span className="sub">{n.min} to {n.max}. Built-in {n.default}.</span>
            </label>
          ))}
        </div>
      )}
      <EditorFooter d={d} e={e} lines={[{ k: "Sources", v: offWords(d, draft) }, ...nums.map((n) => ({ k: n.label, v: `${draft.numbers[n.key]} ${n.unit}` }))]} />
    </div>
  );
}

export function WritesEditor({ d }: { d: SetupEditorData }) {
  const e = useSetupEditor(d);
  const { draft, change } = e;
  const [picking, setPicking] = useState(false);
  const order = [...draft.sections, ...d.sections.map((s) => s.id).filter((id) => !draft.sections.includes(id))];
  const sec = (id: string) => d.sections.find((s) => s.id === id)!;
  const move = (id: string, by: -1 | 1) => {
    const on = draft.sections, i = on.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= on.length) return;
    const next = [...on]; [next[i], next[j]] = [next[j], next[i]];
    change({ sections: next });
  };
  const setOn = (id: string, on: boolean) => change({ sections: on ? [...draft.sections, id] : draft.sections.filter((x) => x !== id) });
  const notionOn = !draft.outputsOff.includes("notion");
  const target = draft.notion ? `${draft.notion.kind === "database" ? "Database" : "Page"} “${draft.notion.title}”, picked here` : d.notion?.fallback ?? "Nothing picked, and no NOTION_BRIEFS_DB_ID or NOTION_BRIEF_PARENT_ID in Vercel";
  return (
    <div className="card" style={{ gap: 16 }}>
      <Header d={d} e={e} icon="shield-check" title="Edit Writes" sub={`Where ${d.agentName}’s brief goes and what is in it. New kinds of output are code.`} />
      <Field k="Outputs">
        <div className="rw-list">
          {d.outputs.map((o) => {
            const on = !draft.outputsOff.includes(o.id);
            return (
              <div key={o.id} className="rw-row">
                <Switch on={on} label={o.label} onChange={(v) => change({ outputsOff: toggle(draft.outputsOff, o.id, v) })} />
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{o.label}</span>
                  <span className="sub">{o.detail}</span>
                  {o.id === "email" && <span className="sub"><Icon name="lock" size={11} /> The recipient is BRIEF_TO in Vercel. No setup can change who gets it.</span>}
                </div>
                <span className="pill sm" title={o.missing.length ? `Missing in Vercel: ${o.missing.join(", ")}` : undefined} style={o.ready ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--red-soft)", color: "var(--red-ink)" }}>{o.ready ? "Set up" : "Missing key"}</span>
              </div>
            );
          })}
        </div>
      </Field>

      {d.notion && (
        <Field k="Notion copy goes to" sub={notionOn ? "A database must have the Briefs columns (see docs/avery-briefs-database.md); a page gets one new page per day under it. Only pages shared with the Notion integration show up." : "The Notion copy is off."}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span style={{ fontSize: 13.5, flex: "1 1 220px" }}>{target}</span>
            <button className="btn outline xs" disabled={!notionOn || !d.notion.tokenSet} onClick={() => setPicking((x) => !x)}>{picking ? "Close" : "Change"}</button>
            {draft.notion && <button className="btn ghost xs" onClick={() => change({ notion: null })}>Use the Vercel setting</button>}
          </div>
          {!d.notion.tokenSet && <span className="sub" style={{ color: "var(--red-ink)" }}>NOTION_TOKEN isn’t set in Vercel, so nothing can be picked.</span>}
          {picking && notionOn && <NotionPicker agentId={d.agentId} current={draft.notion?.id} onPick={(t) => { change({ notion: t }); setPicking(false); }} />}
        </Field>
      )}

      <Field k="Sections, in order" sub="The email and the Notion copy use the same sections in the same order.">
        <div className="rw-list">
          {order.map((id) => {
            const s = sec(id), on = draft.sections.includes(id), i = draft.sections.indexOf(id);
            const unread = s.needs.filter((n) => draft.readsOff.includes(n.id));
            return (
              <div key={id} className="rw-row">
                <Switch on={on} label={s.label} disabled={s.locked} onChange={(v) => setOn(id, v)} />
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.label}{s.locked && <span className="sub"> · always on</span>}</span>
                  <span className="sub">{s.detail}</span>
                  {on && unread.length > 0 && <span className="sub" style={{ color: "var(--yel-ink)" }}>Left out while {unread.map((n) => n.label).join(" and ")} {unread.length === 1 ? "is" : "are"} off in Reads.</span>}
                </div>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn ghost xs" aria-label={`Move ${s.label} up`} disabled={!on || i <= 0} onClick={() => move(id, -1)}>↑</button>
                  <button className="btn ghost xs" aria-label={`Move ${s.label} down`} disabled={!on || i >= draft.sections.length - 1} onClick={() => move(id, 1)}>↓</button>
                </span>
              </div>
            );
          })}
        </div>
      </Field>

      <Field k="Gateway actions" sub="Sending, paying and posting only happen as gateway action types. Each starts at Draft (an approval card) and moves up only after 28 of its last 30 approvals went through unedited and you confirm.">
        {d.actions.length
          ? <div className="rw-list">{d.actions.map((a) => <div key={a.tool} className="rw-row"><Icon name="lock" size={13} /><div className="stack" style={{ gap: 2 }}><span style={{ fontWeight: 600, fontSize: 13.5 }}>{a.tool}</span><span className="sub">{a.note}</span></div><span className="pill sm">{a.tier}</span></div>)}</div>
          : <span style={{ fontSize: 13.5 }}>None. {d.agentName} can’t send, pay or post; its brief to you is a report, not a gateway action.</span>}
      </Field>

      <EditorFooter d={d} e={e} lines={[
        { k: "Outputs", v: d.outputs.filter((o) => !draft.outputsOff.includes(o.id)).map((o) => o.label).join(", ") || "none" },
        ...(d.notion && notionOn ? [{ k: "Notion", v: target }] : []),
        { k: "Sections", v: draft.sections.map((id) => sec(id)?.label ?? id).join(", ") },
      ]} />
    </div>
  );
}

type Place = NonNullable<Awaited<ReturnType<typeof findNotionTargets>>["places"]>[number];

function NotionPicker({ agentId, current, onPick }: { agentId: string; current?: string; onPick: (t: NotionTarget) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const search = async () => {
    setBusy(true);
    try {
      const r = await findNotionTargets(agentId, q);
      setMsg(r.text); setPlaces(r.places ?? null);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Search failed."); }
    setBusy(false);
  };
  return (
    <div className="rw-pick">
      <form className="row" style={{ gap: 8 }} onSubmit={(x) => { x.preventDefault(); void search(); }}>
        <input className="input" style={{ flex: 1, height: 34 }} placeholder="Search pages and databases (blank: recently edited)" value={q} onChange={(x) => setQ(x.target.value)} aria-label="Search Notion" />
        <button className="btn dark sm" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {msg && <span className="sub">{msg}</span>}
      {places?.map((p) => (
        <div key={p.id} className="rw-row">
          <Icon name={p.kind === "database" ? "database" : "file-text"} size={14} />
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <a href={p.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: "anywhere" }}>{p.title}</a>
            <span className="sub">{p.kind === "database" ? (p.missing.length ? `Missing ${p.missing.join(", ")}` : "Database with every Briefs column") : "Page: one new page per day goes under it"}</span>
          </div>
          <button className="btn outline xs" disabled={p.missing.length > 0 || p.id === current} onClick={() => onPick({ kind: p.kind, id: p.id, title: p.title })}>{p.id === current ? "Picked" : "Use"}</button>
        </div>
      ))}
    </div>
  );
}
