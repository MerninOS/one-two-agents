import Link from "next/link";
import { HARD_RULES } from "@/dashboard/crew";
import { getFloor, type Floor } from "@/dashboard/data";
import { BEHIND_THE_SCENES, CONNECTIONS, CONN_BY_ID, isSetUp, toolsOf, usersOf, type ConnId, type Connection } from "@/dashboard/connections";
import type { ToolDef } from "@/core/tools/types";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar, LockList } from "@/dashboard/components/ui";
import { ActionButton } from "@/dashboard/components/client";
import { MCP_SERVERS } from "@/core/mcp-rules";
import { MCP_MISSING, VAULT_MISSING, mcpLog, mcpStatus, vaultState, type McpLogRow, type McpStatus, type VaultState } from "@/integrations/mcp";
import { klaviyoLists } from "@/integrations/klaviyo";
import { klaviyoPickList, mcpDisconnect, vaultReseal } from "@/dashboard/connectionActions";
import { when } from "@/dashboard/format";

/** An MCP connection's state for its panel: signed in or not, and Klaviyo's lists to pick the counted one from. */
interface McpView { status: McpStatus | null; lists: { id: string; name: string }[] | null; listsProblem: string | null; log: McpLogRow[]; vault: VaultState | null }

const EVENT_LABEL: Record<McpLogRow["event"], string> = {
  connected: "Signed in", refreshed: "Sign-in renewed", refresh_failed: "Renewal failed, paused", refused: "Server refused the sign-in, paused",
  revoked: "Cancelled at the server", revoke_failed: "Cancel not confirmed by the server", disconnected: "Disconnected", resealed: "Re-locked with the current key",
};

/** The vault's state: is MCP_SECRET_KEY set, and is every sign-in locked with it. */
function VaultNote({ v }: { v: VaultState | null }) {
  if (!v) return null;
  if (!v.keySet) return <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{v.tooShort ? `MCP_SECRET_KEY is too short. ${VAULT_MISSING}` : VAULT_MISSING}</span>;
  if (!v.onOtherKey.length && !v.unreadable.length) return null;
  return (
    <span className="soft-box row wrap" style={{ fontSize: 12.5, lineHeight: 1.45, gap: 8 }}>
      <span style={{ flex: 1, minWidth: 200 }}>
        {v.onOtherKey.length ? `${v.onOtherKey.length} sign-in${v.onOtherKey.length === 1 ? " is" : "s are"} still locked with an older key. ` : ""}
        {v.unreadable.length ? `${v.unreadable.join(", ")} can’t be unlocked with either key: sign in again.` : ""}
      </span>
      {v.onOtherKey.length > 0 && <ActionButton className="btn outline sm" action={vaultReseal}>Re-lock now</ActionButton>}
    </span>
  );
}

function McpPanel({ c, v }: { c: Connection; v: McpView }) {
  const s = v.status;
  if (!s) return <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{MCP_MISSING}</span>;
  const id = c.mcp!;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <VaultNote v={v.vault} />
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Code may call only these {MCP_SERVERS[id].name} tools: {MCP_SERVERS[id].readTools.join(", ")}. A tool the server adds later does nothing until it is named in code.</span>
      {s.connected ? (
        <>
          {s.paused
            ? <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Paused: {s.lastError ?? "the sign-in stopped working"}. Agents can’t read {c.name} until you sign in again.</span>
            : <span style={{ fontSize: 13 }}>Signed in{s.connectedAt ? ` ${when(s.connectedAt)}` : ""}.{s.lastError ? ` Last problem: ${s.lastError}` : ""}</span>}
          <span className="row wrap" style={{ gap: 8 }}>
            <a className="btn outline sm" href={`/connections/${id}/connect`}>Sign in again</a>
            <ActionButton className="btn outline sm" action={mcpDisconnect.bind(null, id)} confirm={{ title: `Disconnect ${c.name}?`, body: `${c.name} is asked to cancel the sign-in, and it is forgotten here. Agents that read it get an error until you connect again.`, confirmLabel: "Disconnect", kind: "danger" }}>Disconnect</ActionButton>
          </span>
          {id === "klaviyo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>The email list a goal counts</span><span className="muted" style={{ fontSize: 12.5 }}>Email list size counts the profiles on this list.</span></span>
              {v.listsProblem && <span className="soft-box" style={{ fontSize: 12.5 }}>Couldn’t read the lists: {v.listsProblem}</span>}
              {(v.lists ?? []).map((l) => (
                <span key={l.id} className="row" style={{ gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--soft)" }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{l.name || l.id}</span>
                  {s.settings.emailListId === l.id
                    ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Counted</span>
                    : <ActionButton className="btn outline sm" action={klaviyoPickList.bind(null, l.id)}>Count this one</ActionButton>}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <a className="btn dark sm" href={`/connections/${id}/connect`}>Connect {c.name}</a>
          <span className="muted" style={{ fontSize: 12 }}>Opens {c.name}’s own sign-in page. Sign in as an Owner, Admin or Manager.</span>
        </span>
      )}
      {v.log.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Sign-in log</span>
          {v.log.map((e, i) => (
            <span key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
              <span className="muted" style={{ flex: "none", minWidth: 92 }}>{when(e.at)}</span>
              <span className="ink2">{EVENT_LABEL[e.event] ?? e.event}{e.detail && e.event !== "resealed" ? `: ${e.detail}` : ""}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// One page for every integration: is it set up, what can an agent read, do and hand you there,
// and which agents have each of those in their saved setup. Shown here, granted in the builder.

function Who({ id, f }: { id: string; f: Floor }) {
  const a = f.byId[id];
  const name = a?.name ?? id;
  return (
    <Link href={`/agents/${id}`} className="row" title={name} style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink)", textDecoration: "none", padding: "3px 10px 3px 3px", borderRadius: 999, background: "var(--soft)" }}>
      {a ? <Avatar a={a} size={22} /> : <span className="av" style={{ width: 22, height: 22, fontSize: 11 }}>{name.slice(0, 1)}</span>}
      {name}
    </Link>
  );
}

function Status({ c, f }: { c: Connection; f: Floor }) {
  if (c.builtIn && !c.checks.length) return <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Built in</span>;
  const ok = isSetUp(c, f.health);
  return <span className="pill sm" style={{ background: ok ? "var(--mint-soft)" : "var(--red-soft)", color: ok ? "var(--mint-ink)" : "var(--red-ink)" }}><span className="dot" style={{ width: 6, height: 6, background: ok ? "var(--mint)" : "var(--red)" }} />{ok ? (c.builtIn ? "Built in" : "Set up") : "Not set up"}</span>;
}

function Tile({ c, f, on }: { c: Connection; f: Floor; on: boolean }) {
  const users = usersOf(c.id, f.grants).length;
  return (
    <Link href={on ? "/connections" : `/connections?c=${c.id}`} scroll={false} className="card" style={{ gap: 10, padding: 16, textDecoration: "none", color: "var(--ink)", outline: on ? "2px solid var(--ink)" : undefined }}>
      <span className="row" style={{ gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={c.icon} size={17} /></span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</span><span className="muted" style={{ fontSize: 12 }}>{c.sub}</span></span>
      </span>
      <span className="row" style={{ justifyContent: "space-between", gap: 8 }}><Status c={c} f={f} /><span className="muted" style={{ fontSize: 12 }}>{users ? `${users} agent${users === 1 ? "" : "s"}` : "Not used"}</span></span>
    </Link>
  );
}

function ToolRow({ t, f, locked }: { t: ToolDef; f: Floor; locked?: boolean }) {
  const has = Object.keys(f.grants).filter((a) => f.grants[a].includes(t.id));
  const only = t.agents?.length ? t.agents.map((id) => f.byId[id]?.name ?? id) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 14, background: "var(--soft)", border: locked ? "1px dashed var(--mut2)" : undefined }}>
      <span className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        {locked && <Icon name="lock" size={14} style={{ marginTop: 2, flex: "none", opacity: 0.6 }} />}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{t.label}</span>
        {!t.trusted && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }} title="Written by people outside One Two. The agent treats it as information, never as instructions.">Untrusted</span>}
      </span>
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.detail}</span>
      {only && <span className="muted" style={{ fontSize: 12 }}>Only {only.join(" and ")} may ask for this. That rule is in code.</span>}
      <span className="row wrap" style={{ gap: 6 }}>
        {has.map((a) => <Who key={a} id={a} f={f} />)}
        {!has.length && <span className="muted" style={{ fontSize: 12 }}>No agent has this yet.</span>}
      </span>
    </div>
  );
}

function Detail({ c, f, mcp, note }: { c: Connection; f: Floor; mcp: McpView | null; note: { ok: boolean; text: string } | null }) {
  const t = toolsOf(c.id);
  const missing = c.checks.filter((k) => !f.health[k.key]);
  const section = (title: string, sub: string, list: ToolDef[], empty: string, locked?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span><span className="muted" style={{ fontSize: 12.5 }}>{sub}</span></span>
      {list.map((x) => <ToolRow key={x.id} t={x} f={f} locked={locked} />)}
      {!list.length && <span className="muted" style={{ fontSize: 13 }}>{empty}</span>}
    </div>
  );
  return (
    <div className="card" style={{ gap: 18 }}>
      <span className="row" style={{ gap: 12 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={c.icon} /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}><span style={{ fontSize: 19, fontWeight: 700 }}>{c.name}</span><span className="muted" style={{ fontSize: 12.5 }}>{c.sub}</span></span>
        <Status c={c} f={f} />
      </span>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{c.about}</span>
      {note && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45, background: note.ok ? "var(--mint-soft)" : "var(--red-soft)", color: note.ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{note.text}</span>}
      {c.mcp && mcp && <McpPanel c={c} v={mcp} />}
      {c.checks.length > 1 && <span className="row wrap" style={{ gap: 6 }}>{c.checks.map((k) => <span key={k.key} className="pill sm" style={{ background: f.health[k.key] ? "var(--mint-soft)" : "var(--red-soft)", color: f.health[k.key] ? "var(--mint-ink)" : "var(--red-ink)" }}>{k.label}: {f.health[k.key] ? "set up" : "not set up"}</span>)}</span>}
      {!c.mcp && missing.map((k) => <span key={k.key} className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{c.checks.length > 1 ? `${k.label}: ` : ""}{k.setup}</span>)}
      {section("Can read", "Looks only. Nothing changes.", t.read, `Agents can’t read anything from ${c.name}.`)}
      {section("Can do", "Each one becomes a card on Approvals. Nothing happens until you tap Approve.", t.do, c.id === "shopify" ? "Nothing. Shopify is read-only here." : "Nothing yet.", true)}
      {section("Hands you", "Delivered by code after a run finishes. Never during a try.", t.hands, "Nothing.")}
    </div>
  );
}

export default async function Connections({ searchParams }: { searchParams: Promise<{ c?: string; problem?: string; connected?: string }> }) {
  const f = await getFloor();
  const sp = await searchParams;
  const pick = sp.c;
  const sel = pick && pick in CONN_BY_ID ? CONN_BY_ID[pick as ConnId] : null;
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected ? { ok: true, text: `Connected. Give an agent its read tools in the builder${sel?.mcp === "klaviyo" ? ", and pick the list Email list size counts below" : ""}.` } : null;
  let mcp: McpView | null = null;
  if (sel?.mcp) {
    const [status, log, vault] = await Promise.all([mcpStatus(sel.mcp), mcpLog(sel.mcp), vaultState()]);
    let lists: McpView["lists"] = null, listsProblem: string | null = null;
    if (status?.connected && !status.paused && sel.mcp === "klaviyo") {
      try { lists = await klaviyoLists(); } catch (e) { listsProblem = (e instanceof Error ? e.message : String(e)).slice(0, 200); }
    }
    mcp = { status, lists, listsProblem, log, vault };
  }
  const outside = CONNECTIONS.filter((c) => !c.builtIn);
  const ok = outside.filter((c) => isSetUp(c, f.health)).length;
  const grid = (list: Connection[]) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>{list.map((c) => <Tile key={c.id} c={c} f={f} on={sel?.id === c.id} />)}</div>;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h1">Connections</h1>
        <span style={{ fontSize: 13.5 }} className="muted">{ok} of {outside.length} set up. Tap one to see what agents can read, do and hand you there, and who has it. This is shown here and given to an agent in its builder. Secrets are never shown.</span>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: sel ? "minmax(0,0.9fr) minmax(0,1.3fr)" : "minmax(0,1fr)" }}>
        <div className="stack">
          {grid(outside)}
          <span className="side-label" style={{ padding: "4px 2px 0" }}>Built in</span>
          {grid(CONNECTIONS.filter((c) => c.builtIn))}
        </div>
        {sel && <div className="conn-detail"><Detail c={sel} f={f} mcp={mcp} note={note} /></div>}
      </div>
      <div className="card dark" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="lock" size={15} />Always on, for every agent</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", columnGap: 24 }}><LockList rules={HARD_RULES} dark /></div>
      </div>
      <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Behind the scenes</span>
        {BEHIND_THE_SCENES.map((b) => (
          <div key={b.key} className="row rule" style={{ gap: 12, padding: "10px 0", alignItems: "flex-start" }}>
            <Icon name={b.icon} size={16} style={{ marginTop: 2, flex: "none" }} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</span><span className="ink2" style={{ fontSize: 12.5 }}>{f.health[b.key] ? b.about : b.setup}</span></span>
            <span className="pill sm" style={{ background: f.health[b.key] ? "var(--mint-soft)" : "var(--red-soft)", color: f.health[b.key] ? "var(--mint-ink)" : "var(--red-ink)" }}>{f.health[b.key] ? "Set up" : "Not set up"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
