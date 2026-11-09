import Link from "next/link";
import { cookies } from "next/headers";
import { BUILT, CREW, INTEGRATIONS, PLANNED } from "@/dashboard/crew";
import { getFloor } from "@/dashboard/data";
import { longDay } from "@/dashboard/format";
import { needs } from "@/dashboard/needs";
import { STATE_LOOK, stateOf } from "@/dashboard/status";
import { RailLink, SideLink, ThemeToggle } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";

export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  const floor = await getFloor();
  const theme = (await cookies()).get("cr_theme")?.value === "dark" ? "dark" : "light";
  const open = needs(floor, floor.now);
  const notSetUp = INTEGRATIONS.filter((i) => !floor.health[i.id]).length;
  const rail = CREW.map((a) => {
    const st = stateOf(a, floor.agents[a.id], floor.runs, floor.spentToday[a.id] ?? 0);
    return { a, st, badge: open.filter((n) => n.agentId === a.id).length };
  });
  const firstBuilt = BUILT[0].id;
  const nav = [
    { label: "Floor", items: [{ href: "/", match: "/", icon: "layout-dashboard", label: "Mission control" }, { href: "/runs/latest", match: "/runs/*", icon: "history", label: "Run replay" }, { href: "/runs", match: "/runs", icon: "list", label: "Run log" }] },
    { label: "Crew", items: [{ href: `/agents/${firstBuilt}`, match: "/agents/*", tab: "!memory", icon: "users", label: "Crew profiles", count: `${BUILT.length} + ${PLANNED.length}` }, { href: `/agents/${firstBuilt}?tab=memory`, match: "/agents/*", tab: "memory", icon: "brain", label: "Memory", note: "Later", noteColor: "var(--mut)" }] },
    { label: "Trust", items: [{ href: "/access", match: "/access", icon: "shield-check", label: "Access" }, { href: "/approvals", match: "/approvals", icon: "inbox", label: "Approvals", note: "Later", noteColor: "var(--mut)" }] },
    { label: "System", items: [{ href: "/integrations", match: "/integrations", icon: "plug", label: "Integrations", note: notSetUp ? `${notSetUp} not set up` : undefined, noteColor: "var(--red-ink)" }] },
  ];

  return (
    <div className="page">
      <div className="ws">
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark">12</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>One Two</span><span style={{ fontSize: 12 }} className="muted">Mission control</span></span>
          </Link>
          <nav className="rail" aria-label="Crew">
            {rail.filter((r) => r.a.built).map(({ a, st, badge }) => <RailLink key={a.id} id={a.id} icon={a.icon} title={`${a.name} · ${a.role} · ${STATE_LOOK[st].label}`} running={st === "running"} badge={badge} />)}
            <span className="rail-sep" />
            {rail.filter((r) => !r.a.built).map(({ a, st }) => <RailLink key={a.id} id={a.id} icon={a.icon} title={`${a.name} · ${a.role} · ${STATE_LOOK[st].label}`} planned />)}
          </nav>
          <div className="top-right">
            <ThemeToggle initial={theme} />
            <Link href="/" className="round" title={open.length ? `${open.length} things need you` : "Nothing needs you"} style={{ position: "relative" }}>
              <Icon name="bell" />
              {!!open.length && <span style={{ position: "absolute", top: 11, right: 12, width: 7, height: 7, borderRadius: 999, background: "var(--red)", border: "1.5px solid var(--soft)" }} />}
            </Link>
            <span className="date-pill"><Icon name="calendar" size={16} />{longDay(floor.now).replace(/^(\w{3})\w*/, "$1")}</span>
            <span className="me" title="Zak">Z</span>
          </div>
        </header>
        <div className="body">
          <aside className="side">
            {nav.map((g) => (
              <div key={g.label} className="side-group">
                <span className="side-label">{g.label}</span>
                {g.items.map((it) => <SideLink key={it.label} {...it} />)}
              </div>
            ))}
            <div className="side-spacer" style={{ flex: 1 }} />
            <SideLink href="/settings" match="/settings" icon="settings" label="Settings" />
          </aside>
          <main className="main">{children}</main>
        </div>
      </div>
    </div>
  );
}
