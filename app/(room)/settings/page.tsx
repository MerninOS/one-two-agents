import { cookies } from "next/headers";
import Link from "next/link";
import { addVendor, setCap, suppressEmail } from "@/dashboard/actions";
import { signOut } from "@/dashboard/authActions";
import { peopleAdd, peopleRemove, peopleSetRole } from "@/dashboard/peopleActions";
import { getFloor, getVendorsAndSuppressions, requireSession } from "@/dashboard/data";
import { listMembers } from "@/core/members";
import { listAudit } from "@/core/audit";
import { dbLock } from "@/core/db";
import { ROLE_LABELS, ROLE_WORDS } from "@/core/roles";
import { People } from "@/dashboard/components/people";
import { capLines } from "@/dashboard/guardrails";
import { controlsOn } from "@/dashboard/session";
import { ThemeToggle } from "@/dashboard/components/client";
import { BusinessForm, CapForm, SuppressForm, VendorForm, WhereForm } from "@/dashboard/components/settingsForms";
import { saveBusinessProfile, saveWhereThingsGo } from "@/dashboard/orgActions";
import { ownSettings, settings } from "@/core/settings";
import { NO_SETTINGS, type BusinessSettings } from "@/core/settings-rules";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS } from "@/core/business-rules";
import { extensions } from "@/core/extensions";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const [f, caps, lists, me, members, biz] = await Promise.all([getFloor(), capLines(), getVendorsAndSuppressions(), requireSession(), listMembers().catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS)]);
  const [own, eff] = await Promise.all([ownSettings().catch(() => NO_SETTINGS), settings().catch(() => NO_SETTINGS)]);
  const asText = (b: BusinessSettings) => ({ ownerEmail: b.ownerEmail ?? "", siteUrl: b.siteUrl ?? "", shopifyDomain: b.shopifyDomain ?? "", shopifyClientId: b.shopifyClientId ?? "", mercuryAccountIds: b.mercuryAccountIds.join(", "), notionBriefParent: b.notionBriefParent ?? "", notionBriefsDb: b.notionBriefsDb ?? "", notionLeadsParent: b.notionLeadsParent ?? "", notionBooksParent: b.notionBooksParent ?? "" });
  const ownText = asText(own), effText = asText(eff);
  // what the home org still takes from the app-wide settings in Vercel, shown as hints
  const starting = Object.fromEntries(Object.entries(effText).filter(([k, v]) => v && !ownText[k as keyof typeof ownText]));
  const audit = await listAudit(100).then((rows) => ({ rows, problem: null as string | null }), (e: unknown) => ({ rows: [], problem: e instanceof Error ? e.message : String(e) }));
  const when = (at: string) => new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const facts = (d: Record<string, unknown> | null) => (d ? Object.entries(d).map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ") : "");
  const theme = (await cookies()).get("cr_theme")?.value === "dark" ? "dark" : "light";
  // the paid layer's cards (billing, seats) in the cloud edition; none in the open edition
  const Extra = extensions.SettingsCards;
  const line = (k: React.ReactNode, v: React.ReactNode, first?: boolean) => <div className={"row" + (first ? "" : " rule")} style={{ justifyContent: "space-between", padding: "14px 0", fontSize: 14, gap: 16 }}><span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{k}</span>{v}</div>;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 className="h1">Settings</h1>
      <div className="card" style={{ padding: "8px 22px", gap: 0 }}>
        {line("Time zone", <span className="ink2">Central Time</span>, true)}
        {line("Theme", <ThemeToggle initial={theme} wide />)}
        {line(<>Controls<span className="muted" style={{ fontSize: 12 }}>Real runs, putting agents back on the crew and raising budgets. Set DASHBOARD_CONTROLS=on in Vercel to allow them.</span></>, <span className="pill sm" style={controlsOn() ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{controlsOn() ? "On" : "Off"}</span>)}
        {line(<>The org<span className="muted" style={{ fontSize: 12 }}>Turn every agent on or off at once on Crew &gt; Schedule.</span></>, <Link href="/crew?view=schedule" className="btn ghost sm">{f.org.on ? "On" : "Off"} · Open</Link>)}
        {(() => { const lock = dbLock(); return line(<>Database lock<span className="muted" style={{ fontSize: 12 }}>{lock.on ? "The database itself only lets this business’s rows through, on top of the app’s own checks." : lock.problem ?? "Off: the app’s own checks keep each business to its rows. Turn on with SUPABASE_SIGNING_KEY and SUPABASE_PUBLISHABLE_KEY in Vercel (docs/tenancy.md, slice 2b)."}</span></>, <span className="pill sm" style={lock.on ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{lock.on ? "On" : "Off"}</span>); })()}
        {line(<>Signed in as {me.email}<span className="muted" style={{ fontSize: 12 }}>{ROLE_LABELS[me.role]}: {ROLE_WORDS[me.role]}</span></>, <form action={signOut}><button className="btn ghost sm">Sign out</button></form>)}
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 10 }}>
        <span className="card-t">The business</span>
        <span className="sub">What every agent is told about who it works for, at the top of each run. Keep it to facts you’d put on your website.</span>
        <BusinessForm initial={{ name: biz.name, about: biz.about ?? "", ownerName: biz.ownerName ?? "" }} canEdit={me.role === "owner"} save={saveBusinessProfile} />
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 10 }}>
        <span className="card-t">Where things go</span>
        <span className="sub">This business’s own addresses: where the brief and alerts are emailed, its website, its Shopify store and Mercury accounts, and the Notion pages reports go under. Sign-ins and keys stay on Connections.</span>
        <WhereForm initial={ownText} starting={starting} owners={(members ?? []).filter((m) => m.role === "owner").map((m) => m.email)} canEdit={me.role === "owner"} save={saveWhereThingsGo} />
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 6 }}>
        <span className="card-t">People</span>
        <span className="sub">Everyone who can sign in, and what they can do. Each person signs in with a link emailed to them. Viewers see every page; approvers also decide cards, teach agents and stop things; owners can do everything. At least one owner always remains.</span>
        {members == null ? <span className="sub">The people migration (20261203090000_members.sql) isn’t applied yet.</span> : (
          <People
            people={members.map((m) => ({ id: m.id, email: m.email, role: m.role, you: m.id === me.id, lastSignIn: m.last_sign_in_at }))}
            canEdit={me.role === "owner"} add={peopleAdd} setRole={peopleSetRole} remove={peopleRemove}
          />
        )}
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 0 }}>
        <span className="card-t">Money and email caps</span>
        <span className="sub" style={{ paddingBottom: 6 }}>Every agent, enforced in code by the gateway. Lowering a cap applies right away. Raising needs a confirm{controlsOn() ? "" : " and DASHBOARD_CONTROLS=on"}, and stops at the limit in code. Trust levels aren’t editable here.</span>
        {caps.problem && <span className="sub">{/policy_log|relation/.test(caps.problem) ? "The caps migration (20261112230000_caps_and_vendors.sql) isn’t applied yet." : caps.problem}</span>}
        {caps.caps?.map((c) => <CapForm key={`${c.key}:${c.value}`} c={c} controls={controlsOn()} save={setCap} />)}
        {caps.log.length > 0 && (
          <details style={{ paddingTop: 10 }}>
            <summary className="sub">Recent changes</summary>
            {caps.log.map((l, i) => <div key={i} className="sub" style={{ padding: "4px 0" }}>{l.key}: {l.from ?? "default"} to {l.to} · {l.by} · {new Date(l.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>)}
          </details>
        )}
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 10 }}>
        <span className="card-t">Vendors</span>
        <span className="sub">The only payees an agent may ever pay. Only you add them, here. A first payment to a vendor always waits for your approval and is never promoted. No payment action exists yet.</span>
        {lists == null ? <span className="sub">The caps migration (20261112230000_caps_and_vendors.sql) isn’t applied yet.</span> : (
          <>
            {lists.vendors.length ? <div>{lists.vendors.map((v, i) => <div key={v.id}>{line(<>{v.name}<span className="muted" style={{ fontSize: 12 }}>{v.kind}{v.contact_email ? ` · ${v.contact_email}` : ""}</span></>, <span className="sub">{v.mercury_recipient_id ? "Mercury recipient linked" : "No Mercury recipient yet"}</span>, i === 0)}</div>)}</div> : <span className="sub">No vendors yet.</span>}
            <VendorForm add={addVendor} controls={controlsOn()} />
          </>
        )}
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 10 }}>
        <span className="card-t">Addresses that get no email</span>
        <span className="sub">An unsubscribe or a “stop” reply lands here, and no agent emails that address again. You can add one too.</span>
        {lists && (
          <>
            {lists.suppressed.length ? <div>{lists.suppressed.map((x, i) => <div key={x.email}>{line(<>{x.email}<span className="muted" style={{ fontSize: 12 }}>{x.reason ?? ""}</span></>, <span className="sub">{x.source}</span>, i === 0)}</div>)}</div> : <span className="sub">None yet.</span>}
            <SuppressForm suppress={suppressEmail} />
          </>
        )}
      </div>
      <div className="card" style={{ padding: "16px 22px", gap: 6 }}>
        <span className="card-t">Audit log</span>
        <span className="sub">Who did what: approvals, the org switch and duty, real runs, caps and vendors, Connections, people and roles, agents, routines and chains. Nobody can change or delete a line, not even an owner. The latest 100.</span>
        {audit.problem ? <span className="sub">{/audit_log|relation|schema cache/.test(audit.problem) ? "The audit log migration (20261208090000_audit_log.sql) isn’t applied yet." : audit.problem}</span>
          : audit.rows.length === 0 ? <span className="sub">Nothing yet. Each change from now on lands here.</span>
          : <div>{audit.rows.map((r, i) => <div key={i}>{line(<>{r.action.replace(/_/g, " ")}{r.target ? <span className="ink2"> · {r.target}</span> : null}<span className="muted" style={{ fontSize: 12 }}>{r.actor}{r.detail ? ` · ${facts(r.detail)}` : ""}</span></>, <span className="sub" style={{ whiteSpace: "nowrap" }}>{when(r.at)}</span>, i === 0)}</div>)}</div>}
      </div>

      {Extra && <Extra query={query} />}
    </div>
  );
}
