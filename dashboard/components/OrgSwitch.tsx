// The org switch at the top of Crew > Schedule (docs/org-schedule.md). Off: what turning it on
// wakes, worked out in code (dashboard/orgPlan.ts), behind Controls and a confirm. On: one button
// that stops everything, always allowed.
import type { ActionResult } from "@/dashboard/actions";
import type { OrgPlan } from "@/dashboard/orgPlan";
import type { OrgState } from "@/core/org-switch";
import { m2, when } from "@/dashboard/format";
import { schedWords } from "@/dashboard/schedule";
import { ActionButton } from "./client";
import { Icon } from "./Icon";

type Act = () => Promise<ActionResult>;

const perMonth = (v: number) => (v > 0 && v < 0.01 ? "under $0.01" : m2(v));

export function OrgSwitch({ org, plan, controls, turnOn, turnOff }: { org: OrgState; plan: OrgPlan; controls: boolean; turnOn: Act; turnOff: Act }) {
  const scheduled = plan.wake.filter((w) => w.firstRun);
  const first = scheduled[0];
  const total = `about ${perMonth(plan.totalMonth)} a month${plan.unknownCost.length ? ` plus ${plan.unknownCost.join(", ")} (no runs yet)` : ""}`;
  const n = plan.wake.length;
  return (
    <section className="card" aria-label="The org" style={{ background: "var(--dark)", color: "#fff", border: 0, borderRadius: 24, padding: "24px 26px", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
      <div className="row" style={{ gap: 16, flex: "1 1 380px", minWidth: 0, alignItems: "center" }}>
        <span aria-hidden style={{ width: 52, height: 52, borderRadius: 999, background: "var(--dark2)", display: "grid", placeItems: "center", flex: "none", color: org.on ? "var(--mint)" : "#8A8A93" }}><Icon name="power" size={24} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.01em" }}>{org.on ? "The org is on" : "The org is off"}</span>
          <span style={{ fontSize: 13.5, color: "#C3C3CB", lineHeight: 1.5 }}>
            {org.on
              ? `${n} agent${n === 1 ? "" : "s"} in the org, ${scheduled.length} on a schedule${first ? `. Next: ${first.name}, ${when(first.firstRun!)} CT` : ""}. ${total[0].toUpperCase()}${total.slice(1)}.`
              : n
                ? `Nothing runs on its own. Turn it on and ${n} agent${n === 1 ? "" : "s"} go on duty${scheduled.length ? `, ${scheduled.length} of them on the schedule below` : ""}; ${total}.`
                : "Nothing runs on its own, and no agent is in the org yet."}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {org.on ? (
          <ActionButton className="btn danger on-dark" action={turnOff}
            confirm={{ title: "Turn off the org?", body: "Every agent goes off duty and nothing runs on its own. Anything you start is skipped and logged at $0. Turning it back on brings back the same schedule.", confirmLabel: "Turn off the org", kind: "danger" }}>
            Turn off the org
          </ActionButton>
        ) : (
          <ActionButton className="btn primary" action={turnOn} disabled={!controls || !n}
            title={!controls ? "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this." : undefined}
            confirm={{
              title: "Turn on the org?",
              body: `This is launch. ${n} agent${n === 1 ? " goes" : "s go"} on duty${plan.chainsOn.length ? ` and ${plan.chainsOn.length === 1 ? "a chain turns" : `${plan.chainsOn.length} chains turn`} on` : ""}. Each run still checks its daily and department budget. Turning it off stops everything at once.`,
              lines: [
                ...plan.wake.map((w) => ({ k: w.name, v: w.firstRun ? `${schedWords(w.schedule)} · first ${when(w.firstRun)} · ${w.perRun == null ? "cost unknown" : `${perMonth(w.perMonth)} a month`}` : "By hand only · $0 unless you press Run" })),
                ...(plan.left.length ? [{ k: "Stays off", v: `${plan.left.map((x) => x.name).join(", ")} (test)` }] : []),
                { k: "A month", v: total },
              ],
              confirmLabel: "Turn on the org",
            }}>
            Turn on the org
          </ActionButton>
        )}
        {!org.on && !controls && <span style={{ fontSize: 12, color: "#C3C3CB" }}>Needs DASHBOARD_CONTROLS=on</span>}
        {org.on && org.at && <span style={{ fontSize: 12, color: "#C3C3CB" }}>On since {when(org.at)} CT</span>}
      </div>
    </section>
  );
}
