import { ACCESS, CREW, INTEGRATIONS } from "@/dashboard/crew";
import { getFloor } from "@/dashboard/data";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar } from "@/dashboard/components/ui";

const EXTRA: Partial<Record<string, string>> = {
  email: "Set RESEND_API_KEY, BRIEF_FROM (a sender on a domain verified in Resend) and BRIEF_TO to get Avery’s brief by email. Until then it goes to Notion only.",
  gmail: "Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN (gmail.compose only) to get Rowan’s drafts in Gmail.",
  gmail_read: "Set GMAIL_RECEIPTS_REFRESH_TOKEN: a refresh token for zak@onetwocoffeelab.com from the same OAuth client, granted only gmail.readonly.",
  mercury: "Needs MERCURY_API_TOKEN and MERCURY_ACCOUNT_IDS (all, or a comma list). Quinn only needs the token.",
  notion: "Needs NOTION_TOKEN and NOTION_BRIEF_PARENT_ID, and the page shared with the integration.",
  github: "Planned for Ellis (Conversion Optimizer). Nothing uses it yet.",
};

export default async function Integrations() {
  const f = await getFloor();
  const okCount = INTEGRATIONS.filter((i) => f.health[i.id]).length;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><h1 className="h1">Integrations</h1><span style={{ fontSize: 13.5 }} className="muted">{okCount} of {INTEGRATIONS.length} set up. This only checks whether a setting is present. Secrets are never shown.</span></div>
      <div className="grid3">
        {INTEGRATIONS.map((i) => {
          const ok = f.health[i.id];
          const users = CREW.filter((a) => ACCESS[a.id]?.[i.id]);
          const look = ok ? { bg: "var(--mint-soft)", fg: "var(--mint-ink)", dot: "var(--mint)", label: "Set up" } : i.id === "github" ? { bg: "var(--soft)", fg: "var(--ink2)", dot: "var(--mut2)", label: "Not needed yet" } : { bg: "var(--red-soft)", fg: "var(--red-ink)", dot: "var(--red)", label: "Not set up" };
          return (
            <div key={i.id} className="card" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center" }}><Icon name={i.icon} /></span>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 15, fontWeight: 600 }}>{i.name}</span><span className="muted" style={{ fontSize: 12 }}>{i.sub}</span></div>
                <span className="pill sm" style={{ background: look.bg, color: look.fg }}><span className="dot" style={{ width: 6, height: 6, background: look.dot }} />{look.label}</span>
              </div>
              <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">{i.scope}</span>
              {!ok && EXTRA[i.id] && <span style={{ fontSize: 12.5, padding: "10px 12px", borderRadius: 12, background: "var(--soft)", lineHeight: 1.45 }}>{EXTRA[i.id]}</span>}
              <div className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 12, marginRight: 4 }}>Used by</span>{users.map((u) => <span key={u.id} title={u.name}><Avatar a={u} size={26} /></span>)}{!users.length && <span className="muted" style={{ fontSize: 12 }}>nobody yet</span>}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
