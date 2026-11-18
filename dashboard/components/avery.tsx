"use client";
// Avery's chat on every screen (docs/company-mode.md, slice 5): a side panel on a wide screen, a bar
// at the bottom of a phone that opens into a full sheet. Each message is one logged run inside her
// budget (dashboard/chatActions.ts). The lines under a reply come from code: what it actually saved.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ChatAnswer } from "@/core/avery-chat";
import { Icon } from "./Icon";

export interface ChatMsg { id: string; role: "owner" | "avery"; text: string; runId: string | null; notes: string[] }

const STARTERS = ["What needs me today?", "How are the goals?", "Hire someone", "What are the heads planning this week?"];
const KEY = "cr_avery";
const noop = () => () => {};
const readStored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function AveryChat({ name, initial, missing, send }: { name: string; initial: ChatMsg[]; missing: string | null; send: (text: string) => Promise<ChatAnswer> }) {
  const path = usePathname();
  const router = useRouter();
  // wide screen: open by default on the Desk; elsewhere it remembers what the owner last did (this browser only).
  // phone: a bar at the bottom that opens a full sheet, closed again on the next page.
  const stored = useSyncExternalStore(noop, readStored, () => null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const open = manual[path] ?? (path === "/" || stored === "open");
  const [sheetAt, setSheetAt] = useState<string | null>(null);
  const sheet = sheetAt === path;
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs, open, sheet, busy]);

  const toggle = (next: boolean) => {
    setManual((m) => ({ ...m, [path]: next }));
    try { if (path !== "/") localStorage.setItem(KEY, next ? "open" : "closed"); } catch { /* fine without it */ }
    if (next) setTimeout(() => box.current?.focus(), 50);
  };
  const close = () => { setSheetAt(null); toggle(false); };
  const go = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText("");
    setMsgs((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: t, runId: null, notes: [] }]);
    start(async () => {
      let a: ChatAnswer;
      try { a = await send(t); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false }; }
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "avery", text: a.reply, runId: a.runId, notes: a.notes }]);
      if (a.notes.length) router.refresh();
    });
  };

  return (
    <>
      <button className="avery-bar" onClick={() => { setSheetAt(path); setTimeout(() => box.current?.focus(), 50); }} aria-label={`Ask ${name}`}>
        <span className="avery-av">{name[0]}</span>
        <span className="avery-bar-t">Ask {name}, or tell her something</span>
        <Icon name="message-circle" size={18} />
      </button>
      {!open && (
        <button className="avery-tab" onClick={() => toggle(true)} title={`Ask ${name}`} aria-label={`Open the chat with ${name}`}>
          <span className="avery-av">{name[0]}</span>
          <span className="avery-tab-t">Ask {name}</span>
        </button>
      )}
      {(open || sheet) && (
        <aside className={`avery${open ? " d-open" : ""}${sheet ? " m-open" : ""}`} aria-label={`Chat with ${name}`}>
          <div className="avery-head">
            <span className="avery-av lg">{name[0]}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <b style={{ fontWeight: 600 }}>{name}</b>
              <span className="avery-sub">Chief of staff · proposes, never changes things herself</span>
            </span>
            <button className="avery-x" onClick={close} aria-label="Close the chat"><Icon name="x" size={18} /></button>
          </div>
          <div className="avery-list" ref={list} aria-live="polite">
            {!msgs.length && (
              <p className="avery-sub" style={{ lineHeight: 1.5 }}>
                Ask how a department is doing, tell {name} a rule for an agent in your own words, or ask her to hire someone. She reads the company’s data, saves your rules and files proposals. Nothing changes until you say yes.
              </p>
            )}
            {missing && <p className="avery-sub" style={{ lineHeight: 1.5 }}>{missing}</p>}
            {msgs.map((m) => m.role === "owner"
              ? <div key={m.id} className="avery-me">{m.text}</div>
              : (
                <div key={m.id} className="avery-her">
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                  {m.notes.map((n, i) => <span key={i} className="avery-note"><Icon name="check" size={14} />{n}</span>)}
                  {m.runId && <Link href={`/runs/${m.runId}`} className="avery-run">See how she worked it out</Link>}
                </div>
              ))}
            {busy && <div className="avery-her avery-sub">{name} is looking…</div>}
          </div>
          <div className="avery-chips">
            {STARTERS.map((s) => <button key={s} className="avery-chip" disabled={busy} onClick={() => (s === "Hire someone" ? (setText("Hire someone to "), box.current?.focus()) : go(s))}>{s}</button>)}
          </div>
          <form className="avery-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <label className="avery-sub" htmlFor="avery-input">Ask {name}, or tell her something</label>
            <div className="row" style={{ gap: 8 }}>
              <textarea id="avery-input" ref={box} className="avery-input" rows={2} maxLength={1000} value={text} disabled={busy}
                placeholder="e.g. Quinn keeps putting Costco in supplies. It's groceries."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
              <button type="submit" className="avery-send" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}
