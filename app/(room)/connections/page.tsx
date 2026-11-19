import Link from "next/link";
import { HARD_RULES } from "@/dashboard/crew";
import { getFloor, requireSession, type Floor } from "@/dashboard/data";
import { BEHIND_THE_SCENES, CONNECTIONS, CONN_BY_ID, isSetUp, toolsOf, usersOf, type ConnId, type Connection } from "@/dashboard/connections";
import type { ToolDef } from "@/core/tools/types";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar, LockList } from "@/dashboard/components/ui";
import { ActionButton, KeyForm } from "@/dashboard/components/client";
import { claudeRemoveKey, claudeSaveKey } from "@/dashboard/connectionActions";
import { MCP_SERVERS, type McpId } from "@/core/mcp-rules";
import { CLAUDE_KEY_ID, MCP_MISSING, VAULT_MISSING, getCustomServer, listCustomServers, mcpLog, mcpStatus, vaultState, type McpLogRow, type McpStatus, type VaultState } from "@/integrations/mcp";
import { AddServerCard, CustomDetail, CustomTiles, SignInLog } from "@/dashboard/components/CustomServers";
import { serverOfToolId } from "@/core/custom-mcp-rules";
import { knownServer } from "@/core/connector-rules";
import { controlsOn } from "@/dashboard/session";
import { klaviyoLists } from "@/integrations/klaviyo";
import { mercuryOrgName } from "@/integrations/mercury";
import { klaviyoPickList, mcpDisconnect, mcpSaveKey, vaultReseal } from "@/dashboard/connectionActions";
import { when } from "@/dashboard/format";

/** An MCP connection's state for its panel: signed in or not, and Klaviyo's lists to pick the counted one from. */
interface McpView { status: McpStatus | null; lists: { id: string; name: string }[] | null; listsProblem: string | null; log: McpLogRow[]; vault: VaultState | null; org?: string | null; orgProblem?: string | null }


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

const KEY_HINT: Partial<Record<McpId, string>> = { shopify: "shpat_…", mercury_files: "secret-token:mercury_…" };

function McpPanel({ c: base, id, v }: { c: Connection; id: McpId; v: McpView }) {
  const s = v.status;
  if (!s) return <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{MCP_MISSING}</span>;
  const srv = MCP_SERVERS[id];
  const c = { ...base, name: srv.name };
  const writes = (srv.writeTools as readonly { tool: string }[]).map((w) => w.tool);
  // a Connect button (hosted servers and Google), or a pasted key; only hosted servers get the tool check
  const oauth = srv.auth !== "token";
  const hosted = srv.auth === "oauth";
  const google = srv.auth === "google";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <VaultNote v={v.vault} />
      {!srv.readTools.length
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Only the gateway uses this {oauth ? "sign-in" : "key"}, after you approve: {writes.join(", ")}. {oauth ? `Sign-in asks only for: ${srv.scopes.join(", ")}.` : `It should be ${srv.scopes.join(", ")}, and is locked in the vault, never shown again.`}</span>
        : google
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.join(", ")}; it has no tool that drafts, sends, labels or deletes. Sign-in asks Google only for: {srv.scopes.join(", ")}, and is refused if Google grants anything else.</span>
        : oauth
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Code may call only these {srv.name} tools: {srv.readTools.join(", ")}. A tool the server adds later does nothing until it is named in code. Sign-in asks only for: {srv.scopes.join(", ")}.</span>
        : <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Agents may read with: {srv.readTools.join(", ")}.{srv.reportTools.length ? ` Code writes reports with: ${srv.reportTools.join(", ")}; a model never calls those.` : " Nothing here can write."} The key reaches {srv.scopes.join(", ")}, and is locked in the vault, never shown again.</span>}
      {hosted && s.connected && !s.paused && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {s.toolsCheckedAt ? `Tools checked ${when(s.toolsCheckedAt)}: all ${s.toolsSeen.length} are there with the inputs code expects. If one changes, ${c.name} pauses until you sign in again.` : "Tools not checked yet: the next agent call checks them first."}
        </span>
      )}
      {s.connected ? (
        <>
          {s.paused
            ? <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Paused: {s.lastError ?? "the sign-in stopped working"}. Agents can’t reach {c.name} until you {oauth ? "sign in again" : "paste a new key"}.</span>
            : <span style={{ fontSize: 13 }}>{oauth ? "Signed in" : "Key locked in the vault"}{s.connectedAt ? ` ${when(s.connectedAt)}` : ""}.{s.lastError ? ` Last problem: ${s.lastError}` : ""}</span>}
          {!oauth && <KeyForm label={`New ${c.name} key`} save={mcpSaveKey.bind(null, id)} placeholder={KEY_HINT[id]} replace />}
          <span className="row wrap" style={{ gap: 8 }}>
            {oauth && <a className="btn outline sm" href={`/connections/${id}/connect`}>Sign in again</a>}
            <ActionButton className="btn outline sm" action={mcpDisconnect.bind(null, id)} confirm={{ title: `Disconnect ${c.name}?`, body: google ? `Google is asked to cancel the sign-in, and it is forgotten here. Google may cancel the other Gmail sign-in too (both use the same app); if it shows Paused, tap Sign in again there.` : oauth ? `${c.name} is asked to cancel the sign-in, and it is forgotten here. Agents that read it get an error until you connect again.` : `The key is forgotten here. Agents and reports that use ${c.name} get an error until you paste a key again.`, confirmLabel: "Disconnect", kind: "danger" }}>Disconnect</ActionButton>
          </span>
          {google && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {s.settings.mailbox ? <>Signed in as <b>{s.settings.mailbox}</b>. If that isn’t the business’s mailbox, tap Disconnect, then Connect again with the right Google account.</> : "Couldn’t read which mailbox this is."}
            </span>
          )}
          {id === "mercury" && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {v.org ? <>Signed in to <b>{v.org}</b>. If that isn’t the business’s Mercury org, tap Disconnect, then Connect again and pick the business on Mercury’s page.</> : `Couldn’t read which organization this is${v.orgProblem ? `: ${v.orgProblem}` : ""}.`}
            </span>
          )}
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
      ) : oauth ? (
        <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <a className="btn dark sm" href={`/connections/${id}/connect`}>Connect {c.name}</a>
          <span className="muted" style={{ fontSize: 12 }}>Opens {google ? "Google" : c.name}’s own sign-in page. {srv.signInHint}</span>
        </span>
      ) : (
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <KeyForm label={`${c.name} key`} save={mcpSaveKey.bind(null, id)} placeholder={KEY_HINT[id]} />
          <span className="muted" style={{ fontSize: 12 }}>{srv.signInHint} {c.name} is asked whose key it is before it is kept.</span>
        </span>
      )}
      <SignInLog log={v.log} />
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
        {!t.trusted && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }} title="Written by people outside the business. The agent treats it as information, never as instructions.">Untrusted</span>}
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

function Detail({ c, f, mcp, more, note }: { c: Connection; f: Floor; mcp: McpView | null; more: { id: McpId; v: McpView }[]; note: { ok: boolean; text: string } | null }) {
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
      {c.mcp && mcp && <McpPanel c={c} id={c.mcp} v={mcp} />}
      {more.map((m) => (
        <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{MCP_SERVERS[m.id].name}</span>
          <McpPanel c={c} id={m.id} v={m.v} />
        </div>
      ))}
      {c.checks.length > 1 && <span className="row wrap" style={{ gap: 6 }}>{c.checks.map((k) => <span key={k.key} className="pill sm" style={{ background: f.health[k.key] ? "var(--mint-soft)" : "var(--red-soft)", color: f.health[k.key] ? "var(--mint-ink)" : "var(--red-ink)" }}>{k.label}: {f.health[k.key] ? "set up" : "not set up"}</span>)}</span>}
      {!c.mcp && missing.map((k) => <span key={k.key} className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{c.checks.length > 1 ? `${k.label}: ` : ""}{k.setup}</span>)}
      {section("Can read", "Looks only. Nothing changes.", t.read, `Agents can’t read anything from ${c.name}.`)}
      {section("Can do", "Each one becomes a card on Approvals. Nothing happens until you tap Approve.", t.do, c.id === "shopify" ? "Nothing. Shopify is read-only here." : "Nothing yet.", true)}
      {section("Hands you", "Delivered by code after a run finishes. Never during a try.", t.hands, "Nothing.")}
    </div>
  );
}

export default async function Connections({ searchParams }: { searchParams: Promise<{ c?: string; s?: string; known?: string; problem?: string; connected?: string }> }) {
  const [f, me] = await Promise.all([getFloor(), requireSession()]);
  const sp = await searchParams;
  const pick = sp.c;
  // a custom server (s=<id>) or the add form (s=new) takes the detail pane instead of a built-in connection
  const customs = await listCustomServers();
  const custom = sp.s && sp.s !== "new" ? await getCustomServer(sp.s).catch(() => null) : null;
  const adding = sp.s === "new";
  const sel = !custom && !adding && pick && pick in CONN_BY_ID ? CONN_BY_ID[pick as ConnId] : null;
  const customStatuses = Object.fromEntries(await Promise.all(customs.map(async (c) => [c.id, await mcpStatus(c.id)] as const)));
  const customLog = custom ? await mcpLog(custom.id, 10) : [];
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected ? { ok: true, text: custom ? "Connected. Its tools are listed below, all off." : `Connected. Give an agent its read tools in the builder${sel?.mcp === "klaviyo" ? ", and pick the list Email list size counts below" : ""}.` } : null;
  let mcp: McpView | null = null;
  if (sel?.mcp) {
    const [status, log, vault] = await Promise.all([mcpStatus(sel.mcp), mcpLog(sel.mcp), vaultState()]);
    let lists: McpView["lists"] = null, listsProblem: string | null = null;
    if (status?.connected && !status.paused && sel.mcp === "klaviyo") {
      try { lists = await klaviyoLists(); } catch (e) { listsProblem = (e instanceof Error ? e.message : String(e)).slice(0, 200); }
    }
    let org: string | null = null, orgProblem: string | null = null;
    if (status?.connected && !status.paused && sel.mcp === "mercury") {
      try { org = await mercuryOrgName(); } catch (e) { orgProblem = (e instanceof Error ? e.message : String(e)).slice(0, 200); }
    }
    mcp = { status, lists, listsProblem, log, vault, org, orgProblem };
  }
  const more = await Promise.all((sel?.mcpMore ?? []).map(async (id) => {
    const [status, log] = await Promise.all([mcpStatus(id), mcpLog(id)]);
    return { id, v: { status, lists: null, listsProblem: null, log, vault: null } as McpView };
  }));
  const outside = CONNECTIONS.filter((c) => !c.builtIn);
  const ok = outside.filter((c) => isSetUp(c, f.health)).length;
  const grid = (list: Connection[]) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>{list.map((c) => <Tile key={c.id} c={c} f={f} on={sel?.id === c.id} />)}</div>;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h1">Connections</h1>
        <span style={{ fontSize: 13.5 }} className="muted">{ok} of {outside.length} set up. Tap one to see what agents can read, do and hand you there, and who has it. This is shown here and given to an agent in its builder. Secrets are never shown. Looking for something else? <Link href="/connections/find">Find a tool</Link>.</span>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: sel || custom || adding ? "minmax(0,0.9fr) minmax(0,1.3fr)" : "minmax(0,1fr)" }}>
        <div className="stack">
          {grid(outside)}
          <span className="side-label" style={{ padding: "4px 2px 0" }}>Built in</span>
          {grid(CONNECTIONS.filter((c) => c.builtIn))}
          <span className="side-label" style={{ padding: "4px 2px 0" }}>Your servers</span>
          <CustomTiles servers={customs} statuses={customStatuses} sel={custom?.id ?? (adding ? "new" : null)} />
        </div>
        {sel && <div className="conn-detail"><Detail c={sel} f={f} mcp={mcp} more={more} note={note} /></div>}
        {custom && <div className="conn-detail"><CustomDetail c={custom} status={customStatuses[custom.id] ?? null} log={customLog} controls={controlsOn()} note={note} usedBy={Object.keys(f.grants).filter((a) => f.grants[a].some((t) => serverOfToolId(t) === custom.id)).map((a) => f.agents[a]?.name ?? a)} /></div>}
        {adding && <div className="conn-detail"><AddServerCard controls={controlsOn()} known={knownServer(sp.known)} /></div>}
      </div>
      <div className="card dark" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="lock" size={15} />Always on, for every agent</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", columnGap: 24 }}><LockList rules={HARD_RULES} dark /></div>
      </div>
      <ClaudeKeyCard owner={me.role === "owner"} />
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

/** The business's own Claude API key (docs/tenancy.md, slice 8.1c): agents' model calls are billed to it. */
async function ClaudeKeyCard({ owner }: { owner: boolean }) {
  const st = await mcpStatus(CLAUDE_KEY_ID);
  const own = !!st?.connected, paused = !!st?.paused;
  const ok = own && !paused;
  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="cpu" size={15} />Claude API</span>
        <span className="pill sm" style={{ background: ok ? "var(--mint-soft)" : "var(--red-soft)", color: ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{ok ? "Set up" : "Not set up"}</span>
      </span>
      <span className="ink2" style={{ fontSize: 12.5 }}>
        {own ? (paused ? `Paused: ${st?.lastError ?? "Anthropic stopped accepting the key"}. Paste a new one.` : "Agents think with this business’s own Claude key, locked in the vault. Anthropic bills it directly; spend also shows in the run log.")
          : "Paste a Claude API key from the Claude Console (Settings > API keys). Until then agents can’t think, so runs stop with a note."}
      </span>
      {owner && <KeyForm label="Claude API key" save={claudeSaveKey} placeholder="sk-ant-…" replace={own} />}
      {owner && own && <ActionButton className="btn outline sm" action={claudeRemoveKey} confirm={{ title: "Forget the Claude key?", body: "The key is forgotten here. Delete it in the Claude Console too if it shouldn’t work anywhere.", confirmLabel: "Forget it", kind: "danger" }}>Forget the key</ActionButton>}
    </div>
  );
}
