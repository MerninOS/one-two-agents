"use client";
// Custom servers on Connections (docs/custom-servers.md, slice 1): the forms the owner fills in.
// Every check is made again on the server; these only collect the words.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { Modal, Toast, type Confirm } from "./client";

// Each field sits in a column, so no flex basis here: in a column it sets the height, not the width.
const input = { width: "100%", minWidth: 0, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 14 } as const;

/** Name, address and how it signs in. The warning is confirmed before anything is saved. */
/** `start` fills it in from a server on the known list in code (never from a page or an agent). */
export function AddServerForm({ add, warning, controls, start: init }: { add: (name: string, url: string, auth: string) => Promise<ActionResult & { id?: string }>; warning: string; controls: boolean; start?: { name: string; url: string } | null }) {
  const [name, setName] = useState(init?.name ?? "");
  const [url, setUrl] = useState(init?.url ?? "");
  const [auth, setAuth] = useState<"oauth" | "key">("oauth");
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const confirm: Confirm = { title: `Add ${name.trim() || "this server"}?`, body: warning, lines: [{ k: "Address", v: url.trim() }, { k: "Signs in", v: auth === "oauth" ? "On its own page" : "With a key you paste" }], confirmLabel: "I trust it, add it", kind: "dark" };
  const go = () => {
    setOpen(false);
    start(async () => {
      let r: ActionResult & { id?: string };
      try { r = await add(name, url, auth); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      setToast(r);
      if (r.ok && r.id) router.push(`/connections?s=${r.id}`); else router.refresh();
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>Name
        <input id="custom-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="PostHog" maxLength={60} style={input} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>Server address
        <input id="custom-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" maxLength={300} spellCheck={false} autoComplete="off" style={input} />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, paddingBottom: 4 }}>How it signs in</legend>
        <label className="row" style={{ gap: 8, fontSize: 13.5 }}><input id="custom-auth-oauth" type="radio" name="custom-auth" checked={auth === "oauth"} onChange={() => setAuth("oauth")} />On its own sign-in page (most servers)</label>
        <label className="row" style={{ gap: 8, fontSize: 13.5 }}><input id="custom-auth-key" type="radio" name="custom-auth" checked={auth === "key"} onChange={() => setAuth("key")} />With a key the service gave you</label>
      </fieldset>
      <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn dark sm" disabled={!controls || busy || !name.trim() || !url.trim()} title={!controls ? "DASHBOARD_CONTROLS is off" : undefined} onClick={() => setOpen(true)}>{busy ? "Checking the address…" : "Add server"}</button>
        {!controls && <span className="muted" style={{ fontSize: 12 }}>Adding a server needs DASHBOARD_CONTROLS=on in Vercel.</span>}
      </span>
      {open && <Modal c={confirm} busy={busy} onCancel={() => setOpen(false)} onGo={go} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** The scopes the server offers, none ticked. Saving them sends the owner to the server's own sign-in page. */
export function ScopesAndConnect({ id, offered, chosen, save, controls, again }: { id: string; offered: string[]; chosen: string[]; save: (scopes: string[]) => Promise<ActionResult>; controls: boolean; again?: boolean }) {
  const [picked, setPicked] = useState<string[]>(chosen);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const flip = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await save(picked); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    // a full page load: the connect route answers with a redirect to the server's own sign-in page
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.ok) window.location.assign(`/connections/${id}/connect`); else setToast(r);
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {offered.length ? (
        <>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 700 }}>What the sign-in asks for</span><span className="muted" style={{ fontSize: 12.5 }}>Nothing is ticked for you. Tick only what reading needs; anything with write, admin or manage in it is more than an agent should have.</span></span>
          <span className="row wrap" style={{ gap: 6 }}>
            {offered.map((s, i) => (
              <label key={s} className="pill sm" style={{ gap: 6, cursor: "pointer", background: picked.includes(s) ? "var(--ink)" : "var(--soft)", color: picked.includes(s) ? "var(--card)" : "var(--ink2)" }}>
                <input id={`scope-${i}`} type="checkbox" checked={picked.includes(s)} onChange={() => flip(s)} style={{ margin: 0 }} />{s}
              </label>
            ))}
          </span>
        </>
      ) : <span className="muted" style={{ fontSize: 12.5 }}>The server doesn’t list scopes, so the sign-in asks for none by name. Check what its own page says before you say yes.</span>}
      <span className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" disabled={!controls || busy} title={!controls ? "DASHBOARD_CONTROLS is off" : undefined} onClick={go}>{busy ? "Working…" : again ? "Sign in again" : "Connect"}</button>
      </span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export interface ToolFormInput { name: string; kind: string; required: boolean; options?: string[]; about: string }

/** Turn a tool on (or edit it): the name and line agents get, and any inputs to pin. */
export function ToolOnForm({ tool, inputs, initial, save, controls, editing }: { tool: string; inputs: ToolFormInput[]; initial: { label: string; line: string; pins: Record<string, string> }; save: (label: string, line: string, pins: Record<string, string>) => Promise<ActionResult>; controls: boolean; editing: boolean }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(initial.label);
  const [line, setLine] = useState(initial.line);
  const [pins, setPins] = useState<Record<string, string>>(initial.pins);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const pinnable = inputs.filter((i) => i.kind !== "other");
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await save(label, line, pins); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r);
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  if (!open) return (
    <>
      <button className={`btn ${editing ? "outline" : "dark"} sm`} disabled={!controls} title={!controls ? "DASHBOARD_CONTROLS is off" : undefined} onClick={() => setOpen(true)}>{editing ? "Edit" : "Turn on"}</button>
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
  const sid = tool.replace(/[^A-Za-z0-9_-]/g, "-");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", paddingTop: 4 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Name agents see
        <input id={`tool-${sid}-label`} className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} style={input} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>The one line agents read about it (instead of the server’s own words)
        <input id={`tool-${sid}-line`} className="input" value={line} maxLength={300} onChange={(e) => setLine(e.target.value)} style={input} />
      </label>
      {pinnable.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Pin an input to always send that value. Agents can’t change a pinned input. Leave it blank to let the agent fill it in.</span>}
      {pinnable.map((i) => (
        <label key={i.name} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>
          <span>{i.name}{i.required ? " (needed)" : ""} <span className="muted" style={{ fontWeight: 400 }}>{i.kind === "choice" ? `one of ${i.options?.join(", ")}` : i.kind}{i.about ? `. Server says: ${i.about}` : ""}</span></span>
          {i.kind === "choice" || i.kind === "boolean" ? (
            <select id={`tool-${sid}-pin-${i.name}`} className="input" value={pins[i.name] ?? ""} onChange={(e) => setPins({ ...pins, [i.name]: e.target.value })} style={input}>
              <option value="">Not pinned</option>
              {(i.kind === "boolean" ? ["true", "false"] : i.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input id={`tool-${sid}-pin-${i.name}`} className="input" value={pins[i.name] ?? ""} maxLength={300} placeholder="Not pinned" onChange={(e) => setPins({ ...pins, [i.name]: e.target.value })} style={input} />
          )}
        </label>
      ))}
      <span className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" disabled={busy || !label.trim() || !line.trim()} onClick={go}>{busy ? "Saving…" : editing ? "Save" : "Turn on"}</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export interface NumberFormValue { field: string; label: string; unit: string; shape: string; brief?: boolean }

/**
 * Use a turned-on tool as a goal number (core/goal-number-rules.ts): which field of its reply holds
 * the number, its name, unit and shape. Code checks everything again on save.
 */
export function GoalNumberForm({ tool, initial, save, stop, controls }: { tool: string; initial: NumberFormValue | null; save: (f: NumberFormValue) => Promise<ActionResult>; stop: () => Promise<ActionResult>; controls: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<NumberFormValue>(initial ?? { field: "", label: "", unit: "count", shape: "floor" });
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const run = (act: () => Promise<ActionResult>) => start(async () => {
    let r: ActionResult;
    try { r = await act(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r);
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  const sid = tool.replace(/[^A-Za-z0-9_-]/g, "-");
  if (!open) return (
    <>
      <button className="btn ghost sm" disabled={!controls} title={!controls ? "DASHBOARD_CONTROLS is off" : "Code calls it with its pinned inputs and reads one number for a goal"} onClick={() => setOpen(true)}>{initial ? "Edit goal number" : "Use as a goal number"}</button>
      {initial && <button className="btn ghost sm" disabled={busy || !controls} onClick={() => run(stop)}>Stop using as a goal number</button>}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", paddingTop: 4 }}>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>Code calls this tool with only its pinned inputs, reads one number from its reply, and shows it on goals. Every needed input has to be pinned.</span>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Field in the reply
        <input id={`num-${sid}-field`} className="input" value={f.field} maxLength={200} placeholder="numbers.lowest_days_of_cover" onChange={(e) => setF({ ...f, field: e.target.value })} style={input} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Name on goals
        <input id={`num-${sid}-label`} className="input" value={f.label} maxLength={60} placeholder="Lowest days of green cover" onChange={(e) => setF({ ...f, label: e.target.value })} style={input} />
      </label>
      <span className="row wrap" style={{ gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>It counts
          <select id={`num-${sid}-unit`} className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} style={input}>
            <option value="count">A count</option><option value="usd">Dollars</option><option value="days">Days</option><option value="months">Months</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, flex: "1 1 180px" }}>A goal on it is
          <select id={`num-${sid}-shape`} className="input" value={f.shape} onChange={(e) => setF({ ...f, shape: e.target.value })} style={input}>
            <option value="floor">A level to stay at or above</option><option value="total">A total to reach by a date</option>
          </select>
        </label>
      </span>
      <label className="row" style={{ gap: 8, fontSize: 12.5, alignItems: "center" }}>
        <input id={`num-${sid}-brief`} type="checkbox" checked={!!f.brief} onChange={(e) => setF({ ...f, brief: e.target.checked })} />
        Also show it under Numbers in the morning brief
      </label>
      <span className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" disabled={busy || !f.field.trim() || !f.label.trim()} onClick={() => run(() => save(f))}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
