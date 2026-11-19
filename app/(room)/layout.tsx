import Link from "next/link";
import { cookies } from "next/headers";
import { CONNECTIONS, isSetUp } from "@/dashboard/connections";
import { getFloor, requireSession } from "@/dashboard/data";
import { longDay } from "@/dashboard/format";
import { needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { isLive, stateLook, stateOf } from "@/dashboard/status";
import { LiveRefresher, MobileMenu, RailLink, SideLink, ThemeToggle, type RecentRun } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { AveryChat } from "@/dashboard/components/avery";
import { sendToAvery } from "@/dashboard/chatActions";
import { CHAT_MISSING, chatHistory } from "@/core/avery-chat";
import { agentNames, companySeat, loadOrg } from "@/core/org";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";

// a message to Avery is a run on the page the owner is on (docs/company-mode.md, slice 5)
export const maxDuration = 120;

export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  const floor = await getFloor();
  const jar = await cookies();
  const theme = jar.get("cr_theme")?.value === "dark" ? "dark" : "light";
  const open = needs(floor, floor.now, parseSeen(jar.get(SEEN_COOKIE)?.value));
  const notSetUp = CONNECTIONS.filter((c) => !c.builtIn && !isSetUp(c, floor.health)).length;
  const rail = floor.crew.map((a) => {
    const st = stateOf(a, floor.agents[a.id], floor.runs, floor.spentToday[a.id] ?? 0);
    return { a, st, badge: open.filter((n) => n.agentId === a.id).length };
  });
  // runs from the last 10 minutes, so the refresher can poll while one is live and say when it ends
  const recent: RecentRun[] = floor.runs
    .filter((r) => floor.now - Date.parse(r.started_at) < 10 * 6e4)
    .map((r) => ({ id: r.id, name: floor.byId[r.agent_id]?.name ?? r.agent_id, status: r.status, live: isLive(r, floor.now) }));
  // approval cards and proposals both wait on the owner (company mode slice 3)
  const waiting = (floor.approvalsPending ?? 0) + (floor.proposalsPending ?? 0);
  // Avery's chat: whoever holds the company seat, with the conversation so far
  const [history, org, biz, me] = await Promise.all([chatHistory(30).catch(() => null), loadOrg().catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS), requireSession()]);
  const frontId = org ? companySeat(org)?.agentId ?? null : null;
  const frontName = frontId ? (await agentNames([frontId]))[frontId] ?? "Avery" : "Avery";
  // six places (docs/builder-flow.md, slice 5): Settings sits apart at the bottom of the sidebar
  const nav = [
    { href: "/", match: "/", icon: "layout-dashboard", label: "Desk" },
    { href: "/approvals", match: ["/approvals", "/proposals*"], icon: "inbox", label: "Approvals", count: waiting ? String(waiting) : undefined },
    { href: "/crew", match: ["/crew", "/agents/*", "/build*"], icon: "users", label: "Crew", count: `${floor.crew.length}` },
    { href: "/runs", match: "/runs*", icon: "history", label: "Runs" },
    { href: "/connections", match: "/connections", icon: "plug", label: "Connections", note: notSetUp ? `${notSetUp} to fix` : undefined, noteColor: "var(--red-ink)" },
  ];

  return (
    <div className="page">
      <div className="ws">
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark">{initials(biz.name)}</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>{biz.name}</span><span style={{ fontSize: 12 }} className="muted">Mission control</span></span>
          </Link>
          <nav className="rail" aria-label="Crew">
            {rail.map(({ a, st, badge }) => <RailLink key={a.id} id={a.id} name={a.name} icon={a.icon} title={`${a.name} · ${a.role} · ${stateLook(st, floor.org.on).label}`} running={st === "running"} badge={badge} />)}
          </nav>
          <div className="top-right">
            <span className="wide-only"><ThemeToggle initial={theme} /></span>
            <Link href="/" className="round" title={open.length ? `${open.length} things need you` : "Nothing needs you"} style={{ position: "relative" }}>
              <Icon name="bell" />
              {!!open.length && <span style={{ position: "absolute", top: 11, right: 12, width: 7, height: 7, borderRadius: 999, background: "var(--red)", border: "1.5px solid var(--soft)" }} />}
            </Link>
            <span className="date-pill"><Icon name="calendar" size={16} />{longDay(floor.now).replace(/^(\w{3})\w*/, "$1")}</span>
            <span className="me" title={me.email}>{me.email.slice(0, 1).toUpperCase()}</span>
            <MobileMenu alert={!!waiting}>
              <div className="sheet-group">
                {nav.map((it) => <SideLink key={it.label} {...it} />)}
              </div>
              <div className="sheet-group">
                <SideLink href="/status" match="/status" icon="circle-alert" label="Status" />
                <SideLink href="/settings" match="/settings" icon="settings" label="Settings" />
                <div style={{ padding: "8px 12px 0" }}><ThemeToggle initial={theme} wide /></div>
              </div>
            </MobileMenu>
          </div>
        </header>
        <div className="body">
          <aside className="side">
            <div className="side-group">
              {nav.map((it) => <SideLink key={it.label} {...it} />)}
            </div>
            <div className="side-spacer" style={{ flex: 1 }} />
            <SideLink href="/status" match="/status" icon="circle-alert" label="Status" />
            <SideLink href="/settings" match="/settings" icon="settings" label="Settings" />
          </aside>
          <main className="main">{children}</main>
          <AveryChat name={frontName} send={sendToAvery} missing={history ? null : CHAT_MISSING}
            initial={(history ?? []).map((h) => ({ id: h.id, role: h.role, text: h.text, runId: h.run_id, notes: h.notes }))} />
          <LiveRefresher runs={recent} />
        </div>
      </div>
    </div>
  );
}
