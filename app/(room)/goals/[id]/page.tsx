import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/dashboard/data";
import { goalView } from "@/dashboard/goals";
import { goalEdit, goalSetState, planJobDone } from "@/dashboard/goalActions";
import { GOAL_LOOK } from "@/dashboard/components/goals";
import { GoalForm } from "@/dashboard/components/GoalForm";
import { ActionButton } from "@/dashboard/components/client";
import { Pill } from "@/dashboard/components/ui";
import { getGoal, goalsNow, ownerOf } from "@/core/goals";
import { agentNames, agentsIn, deptSpent, loadOrg, monthSpendByAgent } from "@/core/org";
import { FUNNEL } from "@/core/measures";
import { recentPlans, type Plan } from "@/core/plans";
import { addDays, shortDay, weekOf } from "@/core/plan-rules";
import { listProposals, proposalsBySeat } from "@/core/proposals";
import { listSpecVersions } from "@/core/agent-spec";
import { modelDef } from "@/integrations/models";
import { TOOLS } from "@/core/tools/catalog";
import { chicagoDate } from "@/core/time";

// A goal's page (docs/company-mode.md, slices 2 and 4): where it stands, counted in code, its pace,
// the detail behind the number, the head's plan for the week and its latest review, how the head
// works, what the department spends on AI, and Change / Pause / Done / Remove.

// a measure reads Shopify or Mercury when the page opens
export const maxDuration = 120;

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
  const [[now], names, spend, plans, pending, headSpec] = await Promise.all([
    goalsNow([g]),
    agentNames([...members, ...(owner.agentId ? [owner.agentId] : [])]).catch(() => ({} as Record<string, string>)),
    monthSpendByAgent(members).catch(() => ({} as Record<string, number>)),
    recentPlans(g.department_id, 2).catch(() => null),
    listProposals(["pending"]).catch(() => null),
    owner.agentId ? listSpecVersions(owner.agentId).then((v) => v.find((x) => x.active)?.spec ?? null).catch(() => null) : Promise.resolve(null),
  ]);
  const week = weekOf(chicagoDate(0));
  const plan = plans?.find((p) => p.week_of === week) ?? null;
  const reviewed = plans?.find((p) => p.review) ?? null;
  const bySeat = pending ? proposalsBySeat(org, pending) : {};
  const headName = owner.agentId ? names[owner.agentId] ?? "The head" : null;
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

      <div className="home-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", alignItems: "start" }}>
        <PlanCard plan={plan} plans={plans} week={week} headName={headName} bySeat={bySeat} />
        <div className="stack" style={{ gap: 16 }}>
          <div className="card" style={{ gap: 10 }}>
            <span className="card-t">{headName ? `${headName}’s review` : "The head’s review"}{reviewed && reviewed.week_of !== week ? ` of the week of ${shortDay(reviewed.week_of)}` : ""}</span>
            {reviewed?.review
              ? <><span style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{reviewed.review}</span>{reviewed.review_run_id && <Link href={`/runs/${reviewed.review_run_id}#react`} className="sub">See the run, and say Good or Not this ›</Link>}</>
              : <span className="sub">No review yet. After its team runs, the head reviews how they did against the plan.</span>}
          </div>
          {headSpec && <HowHeadWorks name={headName ?? "The head"} spec={headSpec} />}
        </div>
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

type Spec = NonNullable<Awaited<ReturnType<typeof listSpecVersions>>[number]["spec"]>;

/** The head's plan for this week: its words and lines (a teammate's focus, a seat nobody holds yet, a job for the owner). */
function PlanCard({ plan, plans, week, headName, bySeat }: { plan: Plan | null; plans: Plan[] | null; week: string; headName: string | null; bySeat: Record<string, { id: string; text: string }[]> }) {
  if (plans == null) return <div className="card"><span className="sub">The plans table isn’t in Supabase yet: apply the migration 20261123090000_plans.sql.</span></div>;
  const who = headName ?? "The head";
  if (!plan) return (
    <div className="card" style={{ gap: 8 }}>
      <span className="card-t">This week’s plan</span>
      <span className="sub">{headName ? `${who} hasn’t planned the week of ${shortDay(week)} yet. A head plans on its first run of the week (with This week and Plan and review), and reviews on the runs after.` : "Nobody holds the head seat, so nobody plans this department’s week."}</span>
    </div>
  );
  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 2 }}>
        <span className="card-t">{who}’s plan, week of {shortDay(plan.week_of)}</span>
        <span className="muted" style={{ fontSize: 12 }}>Written {day(plan.updated_at)}{plan.run_id ? <> · <Link href={`/runs/${plan.run_id}#react`}>see the run</Link></> : null} · focus notes last until {shortDay(addDays(plan.updated_at.slice(0, 10), 7))}</span>
      </div>
      {plan.summary && <span style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{plan.summary}</span>}
      {plan.items.map((it) => (
        <div key={it.n} className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, ...(it.kind === "seat" ? { border: "1.5px dashed var(--mut2)", background: "transparent" } : {}) }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <b style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{it.n}. {it.title}</b>
            {it.kind === "owner" && <ActionButton className="btn outline xs" action={planJobDone.bind(null, plan.id, it.n, !it.doneAt)}>{it.doneAt ? "Done · undo" : "Mark done"}</ActionButton>}
            {it.kind === "seat" && it.seatId && bySeat[it.seatId]?.[0] && <Link className="btn outline xs" href={`/proposals/${bySeat[it.seatId][0].id}`}>Hire proposal waiting</Link>}
          </div>
          <span className="sub">{it.kind === "agent" ? <>Focus for <b>{it.who}</b> for 7 days · a note, never authority</> : it.kind === "owner" ? <>A job for <b>you</b> · {who} only suggests</> : <>Nobody holds the <b>{it.who}</b> seat yet</>}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.5 }} className="ink2">“{it.words}”</span>
        </div>
      ))}
    </div>
  );
}

/** How the head works, from its live version: brain, cap, what it reads and hands the owner. */
function HowHeadWorks({ name, spec }: { name: string; spec: Spec }) {
  const tools = spec.tools.map((t) => TOOLS[t]).filter(Boolean);
  const reads = tools.filter((t) => t.kind === "read" || t.kind === "calculate").map((t) => t.label);
  const hands = tools.filter((t) => t.kind === "report").map((t) => t.label);
  const acts = tools.some((t) => t.kind === "action");
  return (
    <div className="card" style={{ gap: 8, background: "var(--soft)" }}>
      <span className="card-t">How {name} works</span>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }} className="ink2">
        <li>{modelDef(spec.model)?.label ?? spec.model}, {spec.effort} effort, {usd(spec.limits.maxCostUsd)} cap a run</li>
        {reads.length > 0 && <li>Reads: {reads.join(", ")}</li>}
        {hands.length > 0 && <li>Hands you: {hands.join(", ")}</li>}
        <li>{acts ? "Has an action tool, so its drafts wait for your approval" : "Can’t send, pay or post"}</li>
      </ul>
    </div>
  );
}
