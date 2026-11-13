import Link from "next/link";
import { BY_ID, HARD_RULES } from "@/dashboard/crew";
import { getFloor, type Floor } from "@/dashboard/data";
import { BEHIND_THE_SCENES, CONNECTIONS, CONN_BY_ID, isSetUp, toolsOf, usersOf, type ConnId, type Connection } from "@/dashboard/connections";
import type { ToolDef } from "@/core/tools/types";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar, LockList } from "@/dashboard/components/ui";

// One page for every integration: is it set up, what can an agent read, do and hand you there,
// and which agents have each of those in their saved setup. Shown here, granted in the builder.

function Who({ id, f }: { id: string; f: Floor }) {
  const a = BY_ID[id];
  const name = a?.name ?? f.setupNames[id] ?? id;
  return (
    <Link href={a ? `/agents/${id}` : `/build/${id}`} className="row" title={name} style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink)", textDecoration: "none", padding: "3px 10px 3px 3px", borderRadius: 999, background: "var(--soft)" }}>
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
  const only = t.agents?.length ? t.agents.map((id) => BY_ID[id]?.name ?? id) : null;
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

function Detail({ c, f }: { c: Connection; f: Floor }) {
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
      {c.checks.length > 1 && <span className="row wrap" style={{ gap: 6 }}>{c.checks.map((k) => <span key={k.key} className="pill sm" style={{ background: f.health[k.key] ? "var(--mint-soft)" : "var(--red-soft)", color: f.health[k.key] ? "var(--mint-ink)" : "var(--red-ink)" }}>{k.label}: {f.health[k.key] ? "set up" : "not set up"}</span>)}</span>}
      {missing.map((k) => <span key={k.key} className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{c.checks.length > 1 ? `${k.label}: ` : ""}{k.setup}</span>)}
      {section("Can read", "Looks only. Nothing changes.", t.read, `Agents can’t read anything from ${c.name}.`)}
      {section("Can do", "Each one becomes a card on Approvals. Nothing happens until you tap Approve.", t.do, c.id === "shopify" ? "Nothing. Shopify is read-only here." : "Nothing yet.", true)}
      {section("Hands you", "Delivered by code after a run finishes. Never during a try.", t.hands, "Nothing.")}
    </div>
  );
}

export default async function Connections({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const f = await getFloor();
  const pick = (await searchParams).c;
  const sel = pick && pick in CONN_BY_ID ? CONN_BY_ID[pick as ConnId] : null;
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
        {sel && <div className="conn-detail"><Detail c={sel} f={f} /></div>}
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
