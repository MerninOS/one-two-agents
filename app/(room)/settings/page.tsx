import { cookies } from "next/headers";
import { logout, pauseAll } from "@/dashboard/actions";
import { BUILT } from "@/dashboard/crew";
import { getFloor } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { ActionButton, ThemeToggle } from "@/dashboard/components/client";

export default async function Settings() {
  const f = await getFloor();
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
    </div>
  );
}
