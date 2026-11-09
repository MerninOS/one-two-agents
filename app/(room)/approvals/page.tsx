import { requireSession } from "@/dashboard/data";
import { Icon } from "@/dashboard/components/Icon";
import { Later } from "@/dashboard/components/ui";

export default async function Approvals() {
  await requireSession();
  return (
    <>
      <div className="row"><h1 className="h1" style={{ flex: 1 }}>Approvals</h1><Later /></div>
      <div className="card dashed" style={{ padding: 40, textAlign: "center", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>No approvals yet.</span>
        <span style={{ fontSize: 13.5 }} className="ink2">Draft-tier agents will queue actions here. Items older than 72 hours expire as stale. Until then, Rowan’s drafts are in the Notion page each run creates, and Quinn’s proposed receipts and categories are on Quinn’s profile and the Books page in Notion.</span>
      </div>
      <span className="sub">Example, so the layout is ready</span>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, opacity: 0.9, padding: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row"><span style={{ width: 32, height: 32, borderRadius: 999, background: "#F5D35C", color: "#111114", display: "grid", placeItems: "center" }}><Icon name="compass" size={14} /></span><span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Rowan · Email draft</span><span className="muted" style={{ fontSize: 12 }}>example</span></div>
          <span style={{ fontSize: 17, fontWeight: 600 }}>First hello to [Lead]</span>
          <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">Independent café in [neighborhood]. Pours espresso, no house roast. Fit 4 of 5.</span>
          <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn primary" disabled>Approve</button><button className="btn ghost" disabled>Edit</button><button className="btn" disabled style={{ background: "transparent" }}>Reject</button></div>
        </div>
        <div style={{ borderRadius: 16, background: "var(--soft)", padding: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.55 }}>
          <span className="muted" style={{ fontSize: 12 }}>To [address] · From zak@onetwocoffeelab.com</span>
          <span>Hi [name], I roast coffee in Austin at One Two Coffee Lab. [Two sentences about the coffee, from Shopify facts.] Could I drop off a bag for your team to try? Zak</span>
        </div>
      </div>
    </>
  );
}
