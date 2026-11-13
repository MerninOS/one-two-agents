import Link from "next/link";
import { previewChain, rollBackFlow, runChainNow, saveCrewFlow } from "@/dashboard/actions";
import { listBuilt } from "@/dashboard/builder";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { orgView } from "@/dashboard/org";
import { orgAddDepartment, orgAddSeat, orgEditSeat, orgRemoveDepartment, orgRemoveSeat, orgRenameDepartment, orgSetHolder } from "@/dashboard/orgActions";
import { loadOrg } from "@/core/org";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";
import { Icon } from "@/dashboard/components/Icon";
import { OrgChart } from "@/dashboard/components/OrgChart";

// Crew: the Org chart (docs/org-chart.md, slice 1: departments, seats and who sits in them, with the
// agents not on the chart yet below it) and New agent, which opens the builder flow; and a Schedule
// view (the chains that were the Crew canvas), the one place a schedule is turned on.

// Preview dry-runs up to three agents in a row.
export const maxDuration = 300;

export default async function Crew({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "schedule" ? "schedule" : "org";
  const f = await getFloor();
  return (
    <>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <h1 className="h1">Crew</h1>
          <span className="sub">{view === "org" ? "Your agents by department. Open one to see how it’s doing, edit it, teach it or replay its runs." : "When each agent runs, and who goes next."}</span>
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
  const [org, built] = await Promise.all([loadOrg(), listBuilt()]);
  if (!org) return <div className="card"><span className="sub">The org chart migration (20261115090000_org_chart.sql) isn’t applied yet.</span></div>;
  return (
    <OrgChart
      v={orgView(f, org, built ?? [])}
      actions={{ addDept: orgAddDepartment, renameDept: orgRenameDepartment, removeDept: orgRemoveDepartment, addSeat: orgAddSeat, editSeat: orgEditSeat, removeSeat: orgRemoveSeat, setHolder: orgSetHolder }}
    />
  );
}

async function Schedule({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const d = await getCrewCanvas(f);
  return (
    <>
      <div className="card" style={{ gap: 6, borderLeft: "4px solid var(--acc)" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Which agents run when, and who goes next.</span>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          A chain never turns an agent on. Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
      </div>
      <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
    </>
  );
}
