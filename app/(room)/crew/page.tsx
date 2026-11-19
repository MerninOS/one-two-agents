import Link from "next/link";
import { previewChain, rollBackFlow, runChainNow, saveCrewFlow, setAgentTime, setEnabled, turnOffOrg, turnOnOrg } from "@/dashboard/actions";
import { orgDay } from "@/dashboard/orgDay";
import { OrgDay } from "@/dashboard/components/OrgDay";
import { planOrgOn } from "@/dashboard/orgPlan";
import { OrgSwitch } from "@/dashboard/components/OrgSwitch";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { deptExtras, orgView } from "@/dashboard/org";
import { goalsByDept } from "@/dashboard/goals";
import { listProposals, proposalsBySeat } from "@/core/proposals";
import { GOALS_MISSING } from "@/core/goals";
import { orgAddDepartment, orgAddDeptRule, orgAddSeat, orgEditDeptRule, orgEditSeat, orgForgetDeptRule, orgRemoveDepartment, orgRemoveSeat, orgRenameDepartment, orgSetDeptBudget, orgSetDeptEmails, orgSetHolder, orgSetLeadChecks } from "@/dashboard/orgActions";
import { controlsOn } from "@/dashboard/session";
import { loadOrg } from "@/core/org";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";
import { Icon } from "@/dashboard/components/Icon";
import { OrgChart } from "@/dashboard/components/OrgChart";

// Crew: the Org chart (docs/org-chart.md, slice 1: departments, seats and who sits in them, with the
// agents not on the chart yet below it) and New agent, which opens the builder flow; and a Schedule
// view: the org switch (docs/org-schedule.md) and the chains that were the Crew canvas, the one
// place a schedule is turned on.

// Preview dry-runs up to three agents in a row. (Goals read Shopify or Mercury when the chart opens.)
export const maxDuration = 300;

export default async function Crew({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "schedule" ? "schedule" : "org";
  const f = await getFloor();
  return (
    <>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <h1 className="h1">Crew</h1>
          <span className="sub">{view === "org" ? "Your agents by department, each led by its goals. Open one to see how it’s doing, edit it, teach it or replay its runs." : "When your org works, what it costs, and when you hear from it."}</span>
        </div>
        <Link href="/build/new" className="btn dark"><Icon name="user-plus" size={15} />New agent</Link>
      </div>
      <nav className="seg" aria-label="Crew view">
        <Link href="/crew" className={view === "org" ? "on" : ""} aria-current={view === "org" ? "page" : undefined}>Org chart</Link>
        <Link href="/crew?view=schedule" className={view === "schedule" ? "on" : ""} aria-current={view === "schedule" ? "page" : undefined}>Schedule</Link>
      </nav>
      {view === "org" ? <Chart f={f} /> : <Schedule f={f} />}
    </>
  );
}

async function Chart({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const org = await loadOrg();
  if (!org) return <div className="card"><span className="sub">The org chart tables aren’t up to date: apply the org chart migrations (20261115090000_org_chart.sql, 20261116090000_department_budgets.sql).</span></div>;
  const [extras, goals, pending] = await Promise.all([deptExtras(org), goalsByDept(org), listProposals(["pending"]).catch(() => null)]);
  return (
    <>
    {goals == null && <div className="card"><span className="sub">{GOALS_MISSING}</span></div>}
    <OrgChart
      v={orgView(f, org, extras, goals, pending ? proposalsBySeat(org, pending) : {})}
      controls={controlsOn()}
      actions={{
        addDept: orgAddDepartment, renameDept: orgRenameDepartment, removeDept: orgRemoveDepartment, addSeat: orgAddSeat, editSeat: orgEditSeat, removeSeat: orgRemoveSeat, setHolder: orgSetHolder,
        setBudget: orgSetDeptBudget, setEmails: orgSetDeptEmails, addRule: orgAddDeptRule, editRule: orgEditDeptRule, forgetRule: orgForgetDeptRule, setLeadChecks: orgSetLeadChecks,
      }}
    />
    </>
  );
}

async function Schedule({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const [d, org] = await Promise.all([getCrewCanvas(f), loadOrg().catch(() => null)]);
  const members = f.crew.map((a) => ({ id: a.id, name: a.name, inOrg: a.inOrg !== false, avgCost: a.avgCost ?? null, capPerRun: a.capPerRun }));
  const plan = planOrgOn(members, d.flow.chains, f.now);
  const day = orgDay({
    members: f.crew,
    enabled: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.enabled])),
    budget: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.daily_budget_usd])),
    grants: f.grants, org, now: f.now,
  });
  return (
    <>
      <OrgSwitch org={f.org} plan={plan} controls={controlsOn()} turnOn={turnOnOrg.bind(null, true)} turnOff={turnOffOrg} />
      <OrgDay day={day} controls={controlsOn()} orgOn={f.org.on} setTime={setAgentTime} setOn={setEnabled} />
      <details className="card" style={{ gap: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 14.5, fontWeight: 600 }}>Edit chains: hand-offs between agents</summary>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          For more than a time: one agent after another, checks on numbers, waits and hand-offs. Chains run only while the org is on, and a chain never turns an agent on.
          Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
        <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
      </details>
    </>
  );
}
