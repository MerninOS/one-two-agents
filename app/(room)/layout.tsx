import Link from "next/link";
import { cookies } from "next/headers";
import { BUILT, BY_ID, CREW, INTEGRATIONS, PLANNED } from "@/dashboard/crew";
import { getFloor } from "@/dashboard/data";
import { longDay } from "@/dashboard/format";
import { needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { STATE_LOOK, isLive, stateOf } from "@/dashboard/status";
import { LiveRefresher, MobileMenu, RailLink, SideLink, ThemeToggle, type RecentRun } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";

export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  const floor = await getFloor();
  const jar = await cookies();
  const theme = jar.get("cr_theme")?.value === "dark" ? "dark" : "light";
  const open = needs(floor, floor.now, parseSeen(jar.get(SEEN_COOKIE)?.value));
  const notSetUp = INTEGRATIONS.filter((i) => !floor.health[i.id]).length;
  const rail = CREW.map((a) => {
    const st = stateOf(a, floor.agents[a.id], floor.runs, floor.spentToday[a.id] ?? 0);
    return { a, st, badge: open.filter((n) => n.agentId === a.id).length };
  });
  const firstBuilt = BUILT[0].id;
  // runs from the last 10 minutes, so the refresher can poll while one is live and say when it ends
  const recent: RecentRun[] = floor.runs
    .filter((r) => floor.now - Date.parse(r.started_at) < 10 * 6e4)
    .map((r) => ({ id: r.id, name: BY_ID[r.agent_id]?.name ?? r.agent_id, status: r.status, live: isLive(r, floor.now) }));
  const nav = [
    { label: "Floor", items: [{ href: "/", match: "/", icon: "layout-dashboard", label: "Mission control" }, { href: "/runs/latest", match: "/runs/*", icon: "history", label: "Run replay" }, { href: "/runs", match: "/runs", icon: "list", label: "Run log" }] },
    { label: "Crew", items: [{ href: `/agents/${firstBuilt}`, match: "/agents/*", tab: "!memory", icon: "users", label: "Crew profiles", count: `${BUILT.length} + ${PLANNED.length}` }, { href: `/agents/${firstBuilt}?tab=memory`, match: "/agents/*", tab: "memory", icon: "brain", label: "Memory" }, { href: "/crew", match: "/crew", icon: "git-pull-request", label: "Crew canvas" }] },
    { label: "Trust", items: [{ href: "/access", match: "/access", icon: "shield-check", label: "Access" }, { href: "/approvals", match: "/approvals", icon: "inbox", label: "Approvals", count: floor.approvalsPending ? String(floor.approvalsPending) : undefined }] },
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
            {rail.filter((r) => r.a.built).map(({ a, st, badge }) => <RailLink key={a.id} id={a.id} name={a.name} icon={a.icon} title={`${a.name} · ${a.role} · ${STATE_LOOK[st].label}`} running={st === "running"} badge={badge} />)}
            <span className="rail-sep" />
            {rail.filter((r) => !r.a.built).map(({ a, st }) => <RailLink key={a.id} id={a.id} name={a.name} icon={a.icon} title={`${a.name} · ${a.role} · ${STATE_LOOK[st].label}`} planned />)}
          </nav>
          <div className="top-right">
            <span className="wide-only"><ThemeToggle initial={theme} /></span>
            <Link href="/" className="round" title={open.length ? `${open.length} things need you` : "Nothing needs you"} style={{ position: "relative" }}>
              <Icon name="bell" />
              {!!open.length && <span style={{ position: "absolute", top: 11, right: 12, width: 7, height: 7, borderRadius: 999, background: "var(--red)", border: "1.5px solid var(--soft)" }} />}
            </Link>
            <span className="date-pill"><Icon name="calendar" size={16} />{longDay(floor.now).replace(/^(\w{3})\w*/, "$1")}</span>
            <span className="me" title="Zak">Z</span>
            <MobileMenu alert={!!floor.approvalsPending}>
              {nav.map((g) => (
                <div key={g.label} className="sheet-group">
                  <span className="side-label">{g.label}</span>
                  {g.items.map((it) => <SideLink key={it.label} {...it} />)}
                </div>
              ))}
              <div className="sheet-group">
                <SideLink href="/settings" match="/settings" icon="settings" label="Settings" />
                <div style={{ padding: "8px 12px 0" }}><ThemeToggle initial={theme} wide /></div>
              </div>
            </MobileMenu>
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
          <LiveRefresher runs={recent} />
        </div>
      </div>
    </div>
  );
}
