import { cookies } from "next/headers";
import { addVendor, logout, pauseAll, setCap, suppressEmail } from "@/dashboard/actions";
import { BUILT } from "@/dashboard/crew";
import { getFloor, getVendorsAndSuppressions } from "@/dashboard/data";
import { capLines } from "@/dashboard/guardrails";
import { controlsOn } from "@/dashboard/session";
import { ActionButton, ThemeToggle } from "@/dashboard/components/client";
import { CapForm, SuppressForm, VendorForm } from "@/dashboard/components/settingsForms";

export default async function Settings() {
  const [f, caps, lists] = await Promise.all([getFloor(), capLines(), getVendorsAndSuppressions()]);
  const theme = (await cookies()).get("cr_theme")?.value === "dark" ? "dark" : "light";
  const on = BUILT.filter((a) => f.agents[a.id]?.enabled);
  const line = (k: React.ReactNode, v: React.ReactNode, first?: boolean) => <div className={"row" + (first ? "" : " rule")} style={{ justifyContent: "space-between", padding: "14px 0", fontSize: 14, gap: 16 }}><span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{k}</span>{v}</div>;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 className="h1">Settings</h1>
      <div className="card" style={{ padding: "8px 22px", gap: 0 }}>
        {line("Time zone", <span className="ink2">Central Time</span>, true)}
        {line("Theme", <ThemeToggle initial={theme} wide />)}
        {line(<>Controls<span className="muted" style={{ fontSize: 12 }}>Real runs, putting agents back on the crew and raising budgets. Set DASHBOARD_CONTROLS=on in Vercel to allow them.</span></>, <span className="pill sm" style={controlsOn() ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{controlsOn() ? "On" : "Off"}</span>)}
        {line(<>Take every agent off duty<span className="muted" style={{ fontSize: 12 }}>Every run after this is skipped and logged at $0. Always allowed.</span></>,
          <ActionButton className="btn danger sm" disabled={!f.ok} action={pauseAll}
            confirm={{ title: "Take every agent off duty?", body: on.length ? `${on.map((a) => a.name).join(", ")} will stop. Every run after this is skipped and logged at $0.` : "Every agent is already off duty.", confirmLabel: "Take all off duty", kind: "danger" }}>
            Pause all agents
          </ActionButton>)}
        {line("Sign out", <form action={logout}><button className="btn ghost sm">Sign out</button></form>)}
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
    </div>
  );
}
