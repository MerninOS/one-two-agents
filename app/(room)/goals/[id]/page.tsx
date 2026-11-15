import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/dashboard/data";
import { goalView } from "@/dashboard/goals";
import { goalEdit, goalSetState } from "@/dashboard/goalActions";
import { GOAL_LOOK } from "@/dashboard/components/goals";
import { GoalForm } from "@/dashboard/components/GoalForm";
import { ActionButton } from "@/dashboard/components/client";
import { Pill } from "@/dashboard/components/ui";
import { getGoal, goalsNow, ownerOf } from "@/core/goals";
import { agentNames, agentsIn, deptSpent, loadOrg, monthSpendByAgent } from "@/core/org";
import { FUNNEL } from "@/core/measures";

// A goal's page (docs/company-mode.md, slice 2): where it stands, counted in code, its pace, the
// detail behind the number, what the department spends on AI, and Change / Pause / Done / Remove.
// The head's plan and review land here with slice 4.

// a measure reads Shopify or Mercury when the page opens
export const maxDuration = 60;

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: iso.length === 10 ? "UTC" : "America/Chicago" });
const usd = (n: number) => `$${n.toFixed(2)}`;
const STAGE: Record<string, string> = { new: "New", drafted: "Drafted", contacted: "Contacted", replied: "Replied", tasting: "Tasting", won: "Won" };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const [g, org] = await Promise.all([getGoal(id), loadOrg()]);
  if (!g || g.state === "dropped" || !org) notFound();
  const owner = ownerOf(org, g.department_id);
  const members = agentsIn(org, g.department_id);
  const [[now], names, spend] = await Promise.all([
    goalsNow([g]),
    agentNames([...members, ...(owner.agentId ? [owner.agentId] : [])]).catch(() => ({} as Record<string, string>)),
    monthSpendByAgent(members).catch(() => ({} as Record<string, number>)),
  ]);
  const v = goalView(now, org, names);
  const dept = org.departments.find((d) => d.id === g.department_id);
  const spent = deptSpent(org, g.department_id, spend);
  const form = { title: g.title, measure: g.measure ?? "", target: g.target == null ? "" : String(g.target), dueOn: g.due_on ?? "" };
  const d = v.detail;

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="sub"><Link href="/crew">Crew</Link> › {v.deptName} › Goal</span>
        <div className="row wrap" style={{ gap: 10 }}>
          <Pill look={GOAL_LOOK[v.status]} />
          <span className="sub">Set by you {day(g.created_at)} · owned by {v.owner}{g.due_on ? ` · due ${day(g.due_on)}` : ""}{g.state === "done" ? " · marked done" : ""}</span>
        </div>
        <h1 className="h1">{v.title}</h1>
        <span className="ink2" style={{ fontSize: 14, lineHeight: 1.5 }}>{v.measure ? (v.needs ? `${v.measure}: code can’t count it until ${v.needs} exists.` : `Measured in code: ${v.how}`) : "No measure picked yet."}</span>
      </div>

      <div className="card" style={{ gap: 12 }}>
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.2 }}>{v.line}</span>
        {v.pct != null && <div className="bar" style={{ height: 10, borderRadius: 999 }}><span style={{ width: `${Math.max(2, v.pct)}%`, background: v.status === "behind" ? "var(--yel)" : v.status === "missed" || v.status === "unreadable" ? "var(--red)" : "var(--mint)" }} /></div>}
        {v.pace && <span className="ink2" style={{ fontSize: 14, lineHeight: 1.5 }}>{v.pace}</span>}
        {d && "funnel" in d && (
          <div className="funnel" aria-label="The leads list by stage">
            {FUNNEL.map((s) => <span key={s}><b>{d.funnel[s]}</b>{STAGE[s]}</span>)}
          </div>
        )}
        {d && "lots" in d && (
          <div className="stack" style={{ gap: 4 }}>
            {d.lots.map((l) => <div key={l.lot} className="row" style={{ gap: 8, fontSize: 13 }}><span style={{ flex: 1 }}>{l.lot}</span><b style={{ fontWeight: 600 }}>{l.days == null ? "not used in 30 days" : `${l.days} days`}</b></div>)}
          </div>
        )}
        <span className="muted" style={{ fontSize: 11.5 }}>Counted when this page opened. {owner.agentId ? `${names[owner.agentId] ?? "The head"} reads the same numbers with the Goal progress tool.` : "A head reads the same numbers with the Goal progress tool."}</span>
      </div>

      <div className="home-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">Change the goal</span>
          <GoalForm initial={form} save={goalEdit.bind(null, g.id)} />
          <div className="row wrap rule" style={{ gap: 8, paddingTop: 12 }}>
            {g.state === "active" && <ActionButton className="btn outline sm" action={goalSetState.bind(null, g.id, "paused")}>Pause it</ActionButton>}
            {g.state === "paused" && <ActionButton className="btn outline sm" action={goalSetState.bind(null, g.id, "active")}>Turn it back on</ActionButton>}
            {g.state !== "done" && <ActionButton className="btn outline sm" action={goalSetState.bind(null, g.id, "done")}>Mark done</ActionButton>}
            {g.state === "done" && <ActionButton className="btn outline sm" action={goalSetState.bind(null, g.id, "active")}>Reopen</ActionButton>}
            <ActionButton className="btn ghost sm" action={goalSetState.bind(null, g.id, "dropped")} confirm={{ title: "Remove this goal?", body: "It leaves Crew and the heads stop reading it. Nothing else changes.", lines: [{ k: "Goal", v: g.title }], confirmLabel: "Remove it", kind: "dark" }}>Remove</ActionButton>
          </div>
        </div>
        <div className="card" style={{ gap: 10 }}>
          <span className="card-t">What {v.deptName} costs AI this month</span>
          <span style={{ fontSize: 22, fontWeight: 600 }}>{usd(spent)}{dept?.monthlyBudgetUsd != null ? <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> of {usd(dept.monthlyBudgetUsd)}</span> : null}</span>
          {members.map((a) => <div key={a} className="row" style={{ gap: 8, fontSize: 12.5 }}><Link href={`/agents/${a}`} style={{ flex: 1 }}>{names[a] ?? a}</Link><b style={{ fontWeight: 600 }}>{usd(spend[a] ?? 0)}</b></div>)}
          <span className="muted" style={{ fontSize: 11.5 }}>Added up in code from this Chicago month’s runs.</span>
        </div>
      </div>
    </>
  );
}
