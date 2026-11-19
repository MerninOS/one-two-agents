// Custom servers on Connections (docs/custom-servers.md, slice 1): servers the owner adds by their
// address, for tools the built-in connectors don't have. Every tool starts off. What the server
// says about its tools is its own words and is shown as such.
import Link from "next/link";
import { CUSTOM_WARNING, cantTurnOn, type CustomServer, type CustomTool } from "@/core/custom-mcp-rules";
import type { McpLogRow, McpStatus } from "@/integrations/mcp";
import type { KnownServer } from "@/core/connector-rules";
import { customAdd, customCheck, customKey, customNumber, customPause, customRemove, customScopes, customToolOff, customToolOn } from "@/dashboard/connectionActions";
import { when } from "@/dashboard/format";
import { Icon } from "./Icon";
import { ActionButton, KeyForm } from "./client";
import { AddServerForm, GoalNumberForm, ScopesAndConnect, ToolOnForm } from "./customClient";

export const EVENT_LABEL: Record<McpLogRow["event"], string> = {
  connected: "Connected", refreshed: "Sign-in renewed", refresh_failed: "Renewal failed, paused", refused: "Server refused the sign-in, paused",
  revoked: "Cancelled at the server", revoke_failed: "Cancel not confirmed by the server", disconnected: "Disconnected", resealed: "Re-locked with the current key",
  tools_changed: "Tools changed, paused", tools_checked: "Tools checked",
  added: "Added", tool_on: "Tool turned on", tool_off: "Tool turned off", paused: "Paused", resumed: "Running again", tools_accepted: "Changed tools accepted",
};

export function SignInLog({ log }: { log: McpLogRow[] }) {
  if (!log.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>Sign-in log</span>
      {log.map((e, i) => (
        <span key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
          <span className="muted" style={{ flex: "none", minWidth: 92 }}>{when(e.at)}</span>
          <span className="ink2">{EVENT_LABEL[e.event] ?? e.event}{e.detail && e.event !== "resealed" ? `: ${e.detail}` : ""}</span>
        </span>
      ))}
    </div>
  );
}

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

type State = "new" | "on" | "paused";
const stateOf = (s: McpStatus | null): State => (!s?.connected ? "new" : s.paused ? "paused" : "on");
const PILL: Record<State, { text: string; bg: string; fg: string }> = {
  new: { text: "Not connected", bg: "var(--soft)", fg: "var(--ink2)" },
  on: { text: "Connected", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  paused: { text: "Paused", bg: "var(--red-soft)", fg: "var(--red-ink)" },
};
const Pill = ({ s }: { s: State }) => <span className="pill sm" style={{ background: PILL[s].bg, color: PILL[s].fg }}>{PILL[s].text}</span>;

/** The tiles under "Your servers", plus the one that opens the add form. */
export function CustomTiles({ servers, statuses, sel }: { servers: CustomServer[]; statuses: Record<string, McpStatus | null>; sel: string | null }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
      {servers.map((c) => {
        const on = Object.keys(c.toolsOn).length;
        return (
          <Link key={c.id} href={sel === c.id ? "/connections" : `/connections?s=${c.id}`} scroll={false} className="card" style={{ gap: 10, padding: 16, textDecoration: "none", color: "var(--ink)", outline: sel === c.id ? "2px solid var(--ink)" : undefined }}>
            <span className="row" style={{ gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="plug" size={17} /></span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</span><span className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host(c.url)}</span></span>
            </span>
            <span className="row" style={{ justifyContent: "space-between", gap: 8 }}><Pill s={stateOf(statuses[c.id] ?? null)} /><span className="muted" style={{ fontSize: 12 }}>{on ? `${on} tool${on === 1 ? "" : "s"} on` : "No tools on"}</span></span>
          </Link>
        );
      })}
      <Link href={sel === "new" ? "/connections" : "/connections?s=new"} scroll={false} className="card" style={{ gap: 10, padding: 16, textDecoration: "none", color: "var(--ink)", border: "1px dashed var(--mut2)", outline: sel === "new" ? "2px solid var(--ink)" : undefined }}>
        <span className="row" style={{ gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="plus" size={17} /></span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>Add a server by URL</span><span className="muted" style={{ fontSize: 12 }}>For a tool not listed here</span></span>
        </span>
      </Link>
    </div>
  );
}

const Warning = () => <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.5, background: "var(--yel-soft)", color: "var(--yel-ink)" }}>{CUSTOM_WARNING}</span>;

/** The add form, with what a custom server can and can't do. */
/** `known`: a server from the list in code (core/connector-rules.ts), picked on Find a tool. */
export function AddServerCard({ controls, known }: { controls: boolean; known?: KnownServer | null }) {
  return (
    <div className="card" style={{ gap: 14 }}>
      <span className="row" style={{ gap: 12 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="plug" /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}><span style={{ fontSize: 19, fontWeight: 700 }}>Add a server by URL</span><span className="muted" style={{ fontSize: 12.5 }}>Any MCP server, for a tool the list above doesn’t have</span></span>
      </span>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        Most services publish an MCP server address in their docs. After you add it and sign in, you’ll see its tools, all off. You can turn on tools that only read; anything that might change something stays off. If a tool you turned on changes later, the server pauses until you look.
      </span>
      {known?.url && (
        <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Filled in with {known.name}’s address from our list. We haven’t vetted it: {known.name} runs it. {known.docs && <a href={known.docs} target="_blank" rel="noreferrer">Its docs ›</a>}
        </span>
      )}
      <Warning />
      <AddServerForm key={known?.key ?? "blank"} add={customAdd} warning={CUSTOM_WARNING} controls={controls} start={known?.url ? { name: known.name, url: known.url } : null} />
      <span className="muted" style={{ fontSize: 12 }}>Don’t know its address? <Link href="/connections/find">Find a tool</Link> lists servers we know of.</span>
    </div>
  );
}

function ToolRow({ c, t, paused, controls }: { c: CustomServer; t: CustomTool; paused: boolean; controls: boolean }) {
  const on = c.toolsOn[t.name];
  const why = cantTurnOn(t);
  const changed = !!on && on.fingerprint !== t.fingerprint;
  const pins = on ? Object.entries(on.pins) : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 14, background: "var(--soft)", border: changed ? "1px solid var(--red)" : why ? "1px dashed var(--mut2)" : undefined }}>
      <span className="row wrap" style={{ gap: 8, alignItems: "flex-start" }}>
        <span style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{on ? on.label : t.title || t.name}</span>
          <code className="muted" style={{ fontSize: 11.5, wordBreak: "break-all" }}>{t.name}</code>
        </span>
        {changed && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>Changed</span>}
        {on && !changed && <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>On</span>}
        <span className="pill sm" style={why ? { background: "var(--red-soft)", color: "var(--red-ink)" } : { background: "var(--card)", color: "var(--ink2)" }}>{why ? (t.readOnly ? "Odd inputs" : "Changes things") : "Reads"}</span>
      </span>
      {on && <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>Agents read: “{on.line}”{pins.length ? ` Pinned: ${pins.map(([k, v]) => `${k} = ${String(v)}`).join(", ")}.` : ""}</span>}
      {on?.number && <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>Goal number: “{on.number.label}”, read from <code>{on.number.field}</code>.</span>}
      {t.about && <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}><span className="muted">The server says: </span>{t.about}</span>}
      {t.inputs.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Inputs: {t.inputs.map((i) => `${i.name}${i.required ? "" : "?"} (${i.kind === "other" ? "list or object" : i.kind})`).join(", ")}</span>}
      {why && <span className="muted" style={{ fontSize: 12 }}>{why}</span>}
      {!why && !paused && (
        <span className="row wrap" style={{ gap: 8 }}>
          <ToolOnForm tool={t.name} inputs={t.inputs} editing={!!on} controls={controls}
            initial={{ label: on?.label ?? (t.title || t.name).slice(0, 60), line: on?.line ?? t.about.slice(0, 300), pins: Object.fromEntries(pins.map(([k, v]) => [k, String(v)])) }}
            save={customToolOn.bind(null, c.id, t.name)} />
          {on && <ActionButton className="btn ghost sm" action={customToolOff.bind(null, c.id, t.name)}>Turn off</ActionButton>}
          {on && !changed && <GoalNumberForm tool={t.name} controls={controls} initial={on.number ? { ...on.number } : null}
            save={customNumber.bind(null, c.id, t.name)} stop={customNumber.bind(null, c.id, t.name, null)} />}
        </span>
      )}
      {(why || paused) && on && <span className="row"><ActionButton className="btn ghost sm" action={customToolOff.bind(null, c.id, t.name)}>Turn off</ActionButton></span>}
    </div>
  );
}

/** One custom server: sign-in, the tool check, its tools (all off to start) and its log. */
export function CustomDetail({ c, status, log, controls, note, usedBy }: { c: CustomServer; status: McpStatus | null; log: McpLogRow[]; controls: boolean; note: { ok: boolean; text: string } | null; usedBy: string[] }) {
  const st = stateOf(status);
  const reason = status?.lastError ?? "";
  const toolsPause = st === "paused" && reason.startsWith("the server ");
  const ownerPause = st === "paused" && reason === "Paused by you";
  const gone = Object.keys(c.toolsOn).filter((n) => !c.tools.some((t) => t.name === n));
  const sorted = [...c.tools].sort((a, b) => Number(!!c.toolsOn[b.name]) - Number(!!c.toolsOn[a.name]) || Number(!cantTurnOn(b)) - Number(!cantTurnOn(a)) || a.name.localeCompare(b.name));
  const onCount = Object.keys(c.toolsOn).length;
  return (
    <div className="card" style={{ gap: 16 }}>
      <span className="row" style={{ gap: 12 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="plug" /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}><span style={{ fontSize: 19, fontWeight: 700 }}>{c.name}</span><span className="muted" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{c.url}</span></span>
        <Pill s={st} />
      </span>
      <Warning />
      {note && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45, background: note.ok ? "var(--mint-soft)" : "var(--red-soft)", color: note.ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{note.text}</span>}
      {!status && <span className="soft-box" style={{ fontSize: 12.5 }}>The MCP tables aren’t set up yet.</span>}

      {st === "new" && (c.auth === "oauth"
        ? <ScopesAndConnect id={c.id} offered={c.scopesOffered} chosen={c.scopes} save={customScopes.bind(null, c.id)} controls={controls} />
        : <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <KeyForm label={`${c.name} key`} save={customKey.bind(null, c.id)} placeholder="The key from the service" />
            <span className="muted" style={{ fontSize: 12 }}>It’s sent only to {host(c.url)}, as a bearer token. {c.name} must accept it before it’s kept, and it’s never shown again.{controls ? "" : " Connecting needs DASHBOARD_CONTROLS=on."}</span>
          </span>)}

      {st !== "new" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {st === "paused"
            ? <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Paused: {reason || "the sign-in stopped working"}. No agent can reach {c.name} until {toolsPause ? "you accept the change" : ownerPause ? "you run it again" : c.auth === "oauth" ? "you sign in again" : "you paste a new key"}.</span>
            : <span style={{ fontSize: 13 }}>{c.auth === "oauth" ? "Signed in" : "Key locked in the vault"}{status?.connectedAt ? ` ${when(status.connectedAt)}` : ""}. {status?.toolsCheckedAt ? `Tools checked ${when(status.toolsCheckedAt)}.` : ""}</span>}
          {toolsPause && (
            <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              The tools marked Changed below show the server’s new words and inputs. {gone.length ? `Gone from the server: ${gone.join(", ")}. ` : ""}Accepting keeps your names, lines and pins, takes the new version, and turns off anything gone or that no longer only reads.
            </span>
          )}
          <span className="row wrap" style={{ gap: 8 }}>
            {toolsPause && <ActionButton className="btn dark sm" disabled={!controls} action={customCheck.bind(null, c.id, true)} confirm={{ title: `Accept ${c.name}’s changed tools?`, body: "Only if the new descriptions and inputs look right to you. Agents read a tool’s description, so a change there can change what they do.", confirmLabel: "Accept", kind: "dark" }}>Accept the change</ActionButton>}
            {ownerPause && <ActionButton className="btn dark sm" disabled={!controls} action={customPause.bind(null, c.id, false)}>Run again</ActionButton>}
            {st === "on" && <ActionButton className="btn outline sm" action={customCheck.bind(null, c.id, false)}>Check tools now</ActionButton>}
            {st === "on" && <ActionButton className="btn outline sm" action={customPause.bind(null, c.id, true)}>Pause for every agent</ActionButton>}
            {c.auth === "oauth" && !ownerPause && !toolsPause && <a className="btn outline sm" href={`/connections/${c.id}/connect`}>Sign in again</a>}
            <ActionButton className="btn ghost sm" action={customRemove.bind(null, c.id)} confirm={{ title: `Remove ${c.name}?`, body: `${c.auth === "oauth" ? `${c.name} is asked to cancel the sign-in, and it’s forgotten here.` : "The key is forgotten here; rotate it at the service to stop it working there too."} Its tools are turned off and the server is taken off Connections. The log stays.`, confirmLabel: "Remove", kind: "danger" }}>Remove server</ActionButton>
          </span>
          {c.auth === "key" && !ownerPause && !toolsPause && <KeyForm label={`New ${c.name} key`} save={customKey.bind(null, c.id)} placeholder="A new key from the service" replace />}
        </div>
      )}

      {st !== "new" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Tools</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{c.tools.length} listed, {onCount} on. Every tool starts off. Turning one on gives it to no agent: you give it to an agent on that agent’s Tools step in the builder, and it’s checked against the server before every run.</span>
            <span className="ink2" style={{ fontSize: 12.5 }}>{usedBy.length ? `Given to ${usedBy.join(", ")}.` : "No agent has these tools yet."}</span>
          </span>
          {sorted.map((t) => <ToolRow key={t.name} c={c} t={t} paused={st === "paused"} controls={controls} />)}
          {!c.tools.length && <span className="muted" style={{ fontSize: 13 }}>No tools listed yet. Tap Check tools now.</span>}
        </div>
      )}
      <SignInLog log={log} />
    </div>
  );
}
