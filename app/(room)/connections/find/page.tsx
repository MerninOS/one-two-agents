import Link from "next/link";
import { getFloor } from "@/dashboard/data";
import { CONNECTIONS, isSetUp, toolsOf } from "@/dashboard/connections";
import { listCustomServers, mcpStatus } from "@/integrations/mcp";
import { KNOWN_SERVERS, knownByAddress, knownServer } from "@/core/connector-rules";
import { REQUESTS_MISSING, listRequests } from "@/core/connector-requests";
import { getProposal } from "@/core/proposals";
import { connectorAsk, connectorClose } from "@/dashboard/connectionActions";
import { ActionButton } from "@/dashboard/components/client";
import { AskForm } from "@/dashboard/components/AskForm";
import { Icon } from "@/dashboard/components/Icon";
import { when } from "@/dashboard/format";

// Find a tool (docs/custom-servers.md, slice 3). When an agent needs something no connection has:
// use one you have (granted on the builder's Tools step), add a server by its address (from the
// known list in code, never an address an agent or a page wrote), or ask for a built-in connector.
// Asks are counted per service, each with a Build Board card. Opened from a yes on a new-tool
// proposal (?for=), from the builder's Tools step and from Try it (?agent=).

const pill = (bg: string, fg: string) => ({ background: bg, color: fg });

export default async function FindATool({ searchParams }: { searchParams: Promise<{ for?: string; agent?: string }> }) {
  const f = await getFloor(); // checks the login
  const sp = await searchParams;
  const [proposal, customs, requests] = await Promise.all([
    sp.for ? getProposal(sp.for).catch(() => null) : Promise.resolve(null),
    listCustomServers().catch(() => []),
    listRequests(),
  ]);
  const forWhat = proposal?.payload.kind === "new_tool" ? proposal.payload.what : null;
  const agent = sp.agent && f.agents[sp.agent] ? f.agents[sp.agent] : null;
  const toolsStep = agent ? `/build/${agent.id}?edit=1&step=connections` : null;

  const builtIns = CONNECTIONS.filter((c) => !c.builtIn);
  const ready = builtIns.filter((c) => isSetUp(c, f.health));
  const notReady = builtIns.filter((c) => !isSetUp(c, f.health));
  const statuses = await Promise.all(customs.map((c) => mcpStatus(c.id).catch(() => null)));
  const myServers = customs.map((c, i) => ({ c, on: Object.keys(c.toolsOn).length, live: !!statuses[i]?.connected && !statuses[i]?.paused }));
  const added = new Set(customs.map((c) => knownByAddress(c.url)?.key).filter(Boolean));
  const known = KNOWN_SERVERS.filter((k) => k.url);

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="sub"><Link href="/connections">Connections</Link> › Find a tool</span>
        <h1 className="h1">Find a tool</h1>
        <span className="sub">Three ways to get an agent something to read: a connection you already have, a server you add by its address, or an ask for a built-in connector. Nothing here gives a tool to an agent: you do that on the builder’s Tools step.</span>
      </div>

      {(forWhat || agent) && (
        <div className="card" style={{ gap: 6, borderLeft: "4px solid var(--acc)" }}>
          <span className="ted-k">{forWhat ? `For the proposal you said yes to${proposal?.from_agent ? `, from ${f.agents[proposal.from_agent]?.name ?? proposal.from_agent}` : ""}` : `For ${agent!.name}`}</span>
          {forWhat && <span style={{ fontSize: 14.5, lineHeight: 1.55 }}>{forWhat}</span>}
          {toolsStep && <Link href={toolsStep} style={{ fontSize: 13 }}>Back to {agent!.name}’s Tools step ›</Link>}
        </div>
      )}

      <span className="card-t">1 · Use a connection you have</span>
      <div className="card" style={{ gap: 10 }}>
        {ready.length + myServers.filter((s) => s.live && s.on).length === 0 && <span className="sub">None is set up yet.</span>}
        {ready.map((c) => {
          const reads = toolsOf(c.id).read;
          return (
            <Link key={c.id} href={`/connections?c=${c.id}`} className="row rule" style={{ gap: 12, padding: "8px 0", textDecoration: "none", color: "inherit", alignItems: "flex-start" }}>
              <Icon name={c.icon} size={16} style={{ marginTop: 2, flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <b style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</b>
                <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{reads.length ? `Reads: ${reads.map((t) => t.label).join(", ")}` : c.sub}</span>
              </span>
            </Link>
          );
        })}
        {myServers.filter((s) => s.live && s.on).map(({ c, on }) => (
          <Link key={c.id} href={`/connections?s=${c.id}`} className="row rule" style={{ gap: 12, padding: "8px 0", textDecoration: "none", color: "inherit", alignItems: "flex-start" }}>
            <Icon name="plug" size={16} style={{ marginTop: 2, flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <b style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</b>
              <span className="ink2" style={{ fontSize: 12.5 }}>Your server · {on} tool{on === 1 ? "" : "s"} turned on</span>
            </span>
          </Link>
        ))}
        {notReady.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>Built in but not set up: {notReady.map((c, i) => <span key={c.id}>{i ? ", " : ""}<Link href={`/connections?c=${c.id}`}>{c.name}</Link></span>)}.</span>}
        <span className="sub">{toolsStep ? <>Give one to {agent!.name} on its <Link href={toolsStep}>Tools step</Link>.</> : "Give one to an agent on its builder’s Tools step."}</span>
      </div>

      <span className="card-t">2 · Add a server by its address</span>
      <div className="card" style={{ gap: 10 }}>
        <span className="sub">Servers we know of. We haven’t vetted them: each is run by its own company, and adding one still shows the warning and runs every check. Only tools that just read can be turned on.</span>
        {known.map((k) => (
          <div key={k.key} className="row wrap rule" style={{ gap: 10, padding: "8px 0", alignItems: "center" }}>
            <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="row" style={{ gap: 8 }}><b style={{ fontSize: 14, fontWeight: 600 }}>{k.name}</b><span className="pill sm" style={pill("var(--soft)", "var(--ink2)")}>Not vetted</span></span>
              <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{k.reads}</span>
            </span>
            {k.docs && <a href={k.docs} target="_blank" rel="noreferrer" className="btn outline sm">Docs</a>}
            {added.has(k.key) ? <span className="pill sm" style={pill("var(--mint-soft)", "var(--mint-ink)")}>Added</span>
              : <Link href={`/connections?s=new&known=${k.key}`} className="btn dark sm">Add</Link>}
          </div>
        ))}
        <span className="sub">Using something else? Look in its docs for “MCP server”, then <Link href="/connections?s=new">add it by its address</Link>.</span>
      </div>

      <span className="card-t">3 · Ask for a built-in connector</span>
      <div className="card" style={{ gap: 10 }}>
        <span className="sub">For a service with no server, or one you’d rather we build in. Each ask is counted, so what’s asked for most gets built next.</span>
        {requests ? <AskForm ask={connectorAsk} proposalId={forWhat ? proposal!.id : null} what={forWhat ?? undefined} />
          : <span className="soft-box" style={{ fontSize: 12.5 }}>{REQUESTS_MISSING}</span>}
      </div>

      <span className="card-t" id="requests">Asked for</span>
      {!requests?.length ? <span className="sub">Nothing asked for yet.</span> : requests.map((r) => {
        const k = knownServer(r.name);
        const last = r.notes?.[0];
        return (
          <div key={r.id} className="card" style={{ gap: 6, opacity: r.state === "closed" ? 0.7 : 1 }}>
            <span className="row wrap" style={{ gap: 8 }}>
              <b style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{r.name}</b>
              <span className="pill sm" style={r.state === "open" ? pill("var(--acc-soft)", "var(--acc-ink)") : pill("var(--soft)", "var(--ink2)")}>{r.state === "open" ? `${r.asks} ask${r.asks === 1 ? "" : "s"}` : r.outcome ?? "Closed"}</span>
            </span>
            {last && <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>{last.by}: {last.what}</span>}
            <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12, flex: 1 }}>Last asked {when(r.last_asked_at)}</span>
              {r.board_url && <a href={r.board_url} target="_blank" rel="noreferrer" className="btn outline sm">Card</a>}
              {r.state === "open" && k?.builtIn && <ActionButton className="btn dark sm" action={connectorClose.bind(null, r.id, "ready")}>A built-in connector is ready</ActionButton>}
              {r.state === "open" && <ActionButton className="btn outline sm" action={connectorClose.bind(null, r.id, "not_needed")} confirm={{ title: `Close the ${r.name} request?`, body: "Its Build Board card moves to Done. A new ask opens it again.", confirmLabel: "Close it", kind: "dark" }}>Close</ActionButton>}
            </span>
          </div>
        );
      })}
    </>
  );
}
