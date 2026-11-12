"use client";
// The few interactive pieces: theme, nav highlighting, and confirm-then-act buttons.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { SEEN_COOKIE, parseSeen } from "../seen";
import { Icon } from "./Icon";

export function ThemeToggle({ initial, wide }: { initial: "light" | "dark"; wide?: boolean }) {
  const [theme, setTheme] = useState(initial);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `cr_theme=${t}; path=/; max-age=31536000; samesite=lax`;
  };
  if (wide) return <button className="btn ghost sm" onClick={flip}>Switch light / dark</button>;
  return <button className="round" title="Switch theme" onClick={flip}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>;
}

/** Rendered only while an agent has run alerts Zak hasn't looked at: notes the look, then refreshes so the badge clears. */
export function MarkSeen({ agentId, at }: { agentId: string; at: number }) {
  const router = useRouter();
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(SEEN_COOKIE + "="))?.slice(SEEN_COOKIE.length + 1);
    const seen = parseSeen(raw);
    if ((seen[agentId] ?? 0) >= at) return;
    seen[agentId] = at;
    document.cookie = `${SEEN_COOKIE}=${encodeURIComponent(JSON.stringify(seen))}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [agentId, at, router]);
  return null;
}

/** Sidebar link, active when the path matches (a trailing * matches a prefix) and, if given, the tab matches. */
export function SideLink({ href, match, tab, icon, label, note, noteColor, count }: { href: string; match: string; tab?: string; icon: string; label: string; note?: string; noteColor?: string; count?: string }) {
  const path = usePathname();
  const curTab = useSearchParams().get("tab") ?? "profile";
  const pathOk = match.endsWith("*") ? path.startsWith(match.slice(0, -1)) : path === match;
  const active = pathOk && (!tab || (tab.startsWith("!") ? curTab !== tab.slice(1) : curTab === tab));
  return (
    <Link href={href} className={"side-item" + (active ? " active" : "")}>
      <Icon name={icon} size={17} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{label}</span>
      {note && <span className="side-note" style={{ color: noteColor }}>{note}</span>}
      {count && <span className="count">{count}</span>}
    </Link>
  );
}

export function RailLink({ id, name, title, icon, planned, running, badge }: { id: string; name: string; title: string; icon: string; planned?: boolean; running?: boolean; badge?: number }) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const sel = path === `/agents/${id}`;
  // switching agents keeps the tab Zak is on (Memory to Memory), except for agents not built yet
  const href = `/agents/${id}${tab && !planned && path.startsWith("/agents/") ? `?tab=${tab}` : ""}`;
  return (
    <Link href={href} title={title} className={"rail-item" + (sel ? " sel" : "") + (planned ? " planned" : "")} aria-current={sel ? "page" : undefined}>
      <span className={"rail-av" + (sel ? " sel" : planned ? " planned" : "") + (running ? " running" : "")}>
        <Icon name={icon} size={planned ? 18 : 20} style={planned && !sel ? { opacity: 0.55 } : undefined} />
      </span>
      <span className="rail-name">{name}</span>
      <span className={"rail-dot" + (sel ? " sel" : "")} />
      {!!badge && <span className="badge">{badge}</span>}
    </Link>
  );
}

/** Phones only (CSS hides it on wide screens): a menu button that opens the full navigation as a sheet. */
export function MobileMenu({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  const here = usePathname() + "?" + useSearchParams().toString();
  // remembers the page it was opened on, so it closes itself after navigating
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === here;
  const setOpen = (o: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof o === "function" ? o(open) : o) ? here : null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenOn(null); };
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button className="round menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ position: "relative" }}>
        <Icon name={open ? "x" : "menu"} />
        {alert && !open && <span className="menu-alert" />}
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <nav className="sheet" aria-label="Menu" onClick={(e) => e.stopPropagation()}>{children}</nav>
        </div>
      )}
    </>
  );
}

export interface Confirm { title: string; body: string; lines?: { k: string; v: string }[]; confirmLabel: string; kind?: "primary" | "dark" | "danger" }

type Act = () => Promise<ActionResult>;

export function Toast({ t, onDone }: { t: ActionResult | null; onDone: () => void }) {
  useEffect(() => { if (!t) return; const h = setTimeout(onDone, 6000); return () => clearTimeout(h); }, [t, onDone]);
  if (!t) return null;
  return <div className="toast" role="status"><span className="dot" style={{ background: t.ok ? "var(--mint)" : "var(--red)" }} /><span>{t.text}</span></div>;
}

function Modal({ c, busy, onCancel, onGo }: { c: Confirm; busy: boolean; onCancel: () => void; onGo: () => void }) {
  return (
    <div className="modal-bg" onClick={busy ? undefined : onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={c.title} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>{c.title}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>{c.body}</p>
        {!!c.lines?.length && <div>{c.lines.map((l) => <div key={l.k} className="modal-line"><span className="muted">{l.k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{l.v}</span></div>)}</div>}
        <div className="row wrap" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button className="btn ghost" style={{ height: 42 }} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${c.kind ?? "primary"}`} style={{ height: 42 }} onClick={onGo} disabled={busy}>{busy ? "Working…" : c.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** A button that (optionally) confirms, runs a server action, then toasts the result and refreshes. The confirm closes as soon as it's accepted. */
export function ActionButton({ action, confirm, className, children, disabled, title, busyLabel }: { action: Act; confirm?: Confirm; className?: string; children: React.ReactNode; disabled?: boolean; title?: string; busyLabel?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => {
    setOpen(false);
    start(async () => {
      let res: ActionResult;
      try { res = await action(); } catch (e) { res = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      setToast(res); router.refresh();
    });
  };
  return (
    <>
      <button className={className} disabled={disabled || busy} title={title} onClick={() => (confirm ? setOpen(true) : go())}>{busy && busyLabel ? busyLabel : busy && !confirm ? "Working…" : children}</button>
      {open && confirm && <Modal c={confirm} busy={busy} onCancel={() => setOpen(false)} onGo={go} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}

export function SwitchButton({ on, action, confirm, disabled, title }: { on: boolean; action: Act; confirm?: Confirm; disabled?: boolean; title: string }) {
  return <ActionButton className={"switch" + (on ? " on" : "")} action={action} confirm={confirm} disabled={disabled} title={title}><span /></ActionButton>;
}

/** Dry run: free, reads real data, writes nothing. Shows the result in place. */
export function DryRun({ action, compact }: { action: Act; compact?: boolean }) {
  const [res, setRes] = useState<(ActionResult & { at: string }) | null>(null);
  const [busy, start] = useTransition();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await action(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Dry run failed." }; }
    setRes({ ...r, at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) });
  });
  return (
    <>
      <button className="btn primary" style={compact ? { height: 40 } : undefined} onClick={go} disabled={busy}><Icon name="play" size={15} />{busy ? "Dry run going…" : "Dry run · free"}</button>
      {(busy || res) && !compact && (
        <div style={{ flexBasis: "100%", padding: "14px 16px", borderRadius: 18, border: "1px dashed var(--mut2)", display: "flex", flexDirection: "column", gap: 6 }}>
          {busy ? <span style={{ fontSize: 13 }} className="muted">Dry run going… reading real data, writing nothing.</span> : res && (
            <>
              <span style={{ fontSize: 11.5, fontWeight: 600 }} className="muted">Dry run · {res.at} CT · nothing written, $0</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: res.ok ? "inherit" : "var(--red-ink)" }}>{res.text}</span>
            </>
          )}
        </div>
      )}
      {compact && res && <Toast t={{ ok: res.ok, text: res.text }} onDone={() => setRes(null)} />}
    </>
  );
}

export function BudgetForm({ current, save, controls }: { current: number; save: (v: number) => Promise<ActionResult>; controls: boolean }) {
  const [v, setV] = useState(String(current));
  const n = parseFloat(v);
  const raising = n > current;
  const blocked = raising && !controls;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
        <input className="input" type="number" step="0.5" min="0" max="50" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 120, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 15, fontWeight: 600 }} aria-label="Daily budget in dollars" />
        <span className="sub">a day, UTC</span>
      </div>
      <div>
        <ActionButton className="btn dark sm" disabled={!(n >= 0) || n === current || blocked} action={() => save(n)}
          title={blocked ? "Raising a budget needs DASHBOARD_CONTROLS=on" : undefined}
          confirm={{ title: "Change the daily budget?", body: "Runs after the budget is reached are skipped for the rest of the UTC day.", lines: [{ k: "Now", v: `$${current.toFixed(2)} a day` }, { k: "New", v: `$${(n || 0).toFixed(2)} a day` }], confirmLabel: "Save budget" }}>
          Save budget
        </ActionButton>
      </div>
      {blocked && <span className="sub">Raising a budget needs DASHBOARD_CONTROLS=on. Lowering it always works.</span>}
    </div>
  );
}

export interface RecentRun { id: string; name: string; status: string; live: boolean }

/**
 * Keeps the floor current while an agent works: refreshes the server data every few seconds while any
 * run is live, and says so when one finishes. Mounted once in the room layout, so it follows Zak around.
 */
export function LiveRefresher({ runs }: { runs: RecentRun[] }) {
  const router = useRouter();
  const anyLive = runs.some((r) => r.live);
  const [seen, setSeen] = useState(runs);
  const [done, setDone] = useState<RecentRun | null>(null);
  // compare with the last render's runs (React's "adjust state on prop change" pattern)
  if (seen !== runs) {
    const finished = runs.find((r) => !r.live && seen.some((p) => p.id === r.id && p.live));
    setSeen(runs);
    if (finished) setDone(finished);
  }
  useEffect(() => {
    if (!anyLive) return;
    const h = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 4000);
    return () => clearInterval(h);
  }, [anyLive, router]);
  useEffect(() => { if (!done) return; const h = setTimeout(() => setDone(null), 10000); return () => clearTimeout(h); }, [done]);
  if (!done) return null;
  const color = done.status === "ok" ? "var(--mint)" : done.status === "failed" ? "var(--red)" : "var(--mut2)";
  const word = done.status === "ok" ? "finished" : done.status === "failed" ? "failed" : done.status === "skipped" ? "was skipped" : "stopped";
  return (
    <div className="toast" role="status">
      <span className="dot" style={{ background: color }} />
      <span>{done.name}’s run {word}.</span>
      <Link href={`/runs/${done.id}`} onClick={() => setDone(null)} style={{ fontWeight: 600, color: "inherit", textDecoration: "underline" }}>See the run</Link>
    </div>
  );
}

/** Reject with an optional reason. A reason becomes a proposed lesson for the agent. */
export function RejectButton({ reject, agentName }: { reject: (reason: string) => Promise<ActionResult>; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await reject(why); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setOpen(false); setWhy(""); setToast(r); router.refresh();
  });
  return (
    <>
      <button className="btn ghost" disabled={busy} onClick={() => setOpen(true)}>{busy ? "Working…" : "Reject"}</button>
      {open && (
        <div className="modal-bg" onClick={busy ? undefined : () => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Reject" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>Reject this change?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>Nothing goes to Mercury. If you say why, {agentName} gets it as a proposed lesson on its Memory tab, and it only sticks once you tap Keep.</p>
            <textarea className="input" rows={3} maxLength={400} value={why} onChange={(e) => setWhy(e.target.value)} disabled={busy} placeholder="Why not? (optional) e.g. Costco runs are supplies, not COGS"
              style={{ height: "auto", borderRadius: 14, padding: "10px 14px", resize: "vertical", lineHeight: 1.45 }} aria-label="Reason" />
            <div className="row wrap" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
              <button className="btn ghost" style={{ height: 42 }} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn dark" style={{ height: 42 }} onClick={go} disabled={busy}>{busy ? "Working…" : why.trim() ? "Reject and propose a lesson" : "Reject"}</button>
            </div>
          </div>
        </div>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}
