import Link from "next/link";
import { requireSession } from "@/dashboard/data";
import { deptChoices } from "@/dashboard/goals";
import { goalCreate } from "@/dashboard/goalActions";
import { GoalForm } from "@/dashboard/components/GoalForm";
import { ownMeasureDefs } from "@/core/goals";

// Set a goal (docs/company-mode.md, slice 2): a department, the goal in the owner's words, a measure from
// the list in code, a target and a date.

export default async function NewGoal({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  await requireSession();
  const [depts, own] = await Promise.all([deptChoices(), ownMeasureDefs()]);
  const want = (await searchParams).dept;
  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <span className="sub"><Link href="/crew">Crew</Link> › New goal</span>
        <h1 className="h1">Set a goal</h1>
        <span className="sub">Pick how code counts it, so progress is a number and not a guess. The department’s head plans around it.</span>
      </div>
      <div className="card" style={{ maxWidth: 640 }}>
        {depts.length
          ? <GoalForm depts={depts} dept={depts.some((d) => d.id === want) ? want : undefined} own={own} save={goalCreate} cancelHref="/crew" />
          : <span className="sub">There are no departments on the org chart yet. Add one on Crew first.</span>}
      </div>
    </>
  );
}
