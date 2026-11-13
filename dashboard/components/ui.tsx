import Link from "next/link";
import type { CrewMember } from "../crew";
import { linkParts } from "../format";
import type { Look } from "../status";
import { Icon } from "./Icon";

export function Avatar({ a, size = 30, working }: { a: CrewMember; size?: number; working?: boolean }) {
  const icon = Math.round(size * 0.46);
  return (
    <span className={"av" + (a.built ? "" : " planned") + (working ? " working" : "")} title={working ? `${a.name} is working` : undefined} style={{ width: size, height: size, background: a.built ? a.hue : undefined }}>
      <Icon name={a.icon} size={icon} style={a.built ? undefined : { opacity: 0.55 }} />
    </span>
  );
}

export function Pill({ look, sm }: { look: Look; sm?: boolean }) {
  return <span className={"pill" + (sm ? " sm" : "")} style={{ background: look.bg, color: look.fg }}><span className={"dot" + (look.pulse ? " pulse" : "")} style={{ background: look.dot, width: sm ? 6 : 7, height: sm ? 6 : 7 }} />{look.label}</span>;
}

export const Later = ({ children = "COMING LATER" }: { children?: React.ReactNode }) => <span className="later">{children}</span>;

export function Summary({ text }: { text: string | null }) {
  return <>{linkParts(text).map((p, i) => p.url ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">{p.text}</a> : <span key={i}>{p.text}</span>)}</>;
}

export function LockList({ rules, dark }: { rules: string[]; dark?: boolean }) {
  return (
    <>
      {rules.map((r) => (
        <div key={r} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: dark ? undefined : "1px solid var(--bd)", fontSize: 13, lineHeight: 1.45, color: dark ? "#D6D6DC" : undefined }}>
          <Icon name="lock" size={13} style={{ marginTop: 3, flex: "none", opacity: 0.5 }} />{r}
        </div>
      ))}
    </>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="card dashed" style={{ padding: 40, alignItems: "center", textAlign: "center", gap: 8 }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      {children && <span style={{ fontSize: 13.5, maxWidth: 460 }} className="ink2">{children}</span>}
      {action && <Link className="btn ghost sm" href={action.href}>{action.label}</Link>}
    </div>
  );
}

export type AgentTab = "overview" | "edit" | "memory" | "runs";
/**
 * An agent's four tabs (docs/builder-flow.md, slice 5). Edit is the builder page (`/build/<id>`: the
 * map, Try it, Go live), so it shows only once the agent has a saved setup to edit.
 */
export function AgentTabs({ id, on, editable }: { id: string; on: AgentTab; editable: boolean }) {
  const tabs: [AgentTab, string, string][] = [
    ["overview", "Overview", `/agents/${id}`],
    ...(editable ? [["edit", "Edit", `/build/${id}`] as [AgentTab, string, string]] : []),
    ["memory", "Memory", `/agents/${id}?tab=memory`],
    ["runs", "Runs", `/agents/${id}?tab=runs`],
  ];
  return (
    <nav className="row wrap tabs" style={{ gap: 6 }} aria-label="Agent">
      {tabs.map(([k, l, href]) => (
        <Link key={k} href={href} aria-current={on === k ? "page" : undefined} className="btn sm" style={{ height: 38, fontSize: 13.5, background: on === k ? "var(--ink)" : "var(--soft)", color: on === k ? "var(--ws)" : "var(--ink)" }}>
          {k === "edit" && <Icon name="pencil" size={14} />}{l}
        </Link>
      ))}
    </nav>
  );
}
