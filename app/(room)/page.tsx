import { cookies } from "next/headers";
import Link from "next/link";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { getFloor } from "@/dashboard/data";
import { goalsByDept } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { GoalTile } from "@/dashboard/components/goals";
import { hm, longDay } from "@/dashboard/format";
import { PRI_COLOR, needs } from "@/dashboard/needs";
import { deskGreeting, deskLine, firstSentence } from "@/dashboard/desk";
import { deptOf, groupByDepartment, headOf, latestOutputs, loadOrg } from "@/core/org";
import { listProposals } from "@/core/proposals";
import { KIND_WORDS } from "@/core/proposal-rules";
import { agentNames } from "@/core/org";
import { Icon } from "@/dashboard/components/Icon";
import { ActionButton } from "@/dashboard/components/client";
import { crewPacks } from "@/core/install";
import { installTemplate } from "@/dashboard/orgActions";

// The Desk (docs/company-mode.md, slice 5): home. Goals with where each stands and its head's latest
// word, then what needs the owner, proposals first. Avery's chat sits beside it (the layout draws it).
// Every count and status here comes from code.

const KIND_LOOK: Record<string, { bg: string; fg: string }> = {
  hire: { bg: "var(--acc-soft)", fg: "var(--acc-ink)" },
  grant_tool: { bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  new_tool: { bg: "var(--yel-soft)", fg: "var(--yel-ink)" },
  retire: { bg: "var(--red-soft)", fg: "var(--red-ink)" },
};

export default async function Desk() {
  const f = await getFloor();
  const now = f.now;
  const open = needs(f, now, parseSeen((await cookies()).get(SEEN_COOKIE)?.value));
  const org = await loadOrg().catch(() => null);
  const [goals, pending] = await Promise.all([goalsByDept(org), listProposals(["pending"], 12).catch(() => null)]);
  const allGoals = org && goals ? org.departments.flatMap((d) => goals[d.id] ?? []) : [];
  // each goal tile carries its head's latest word (the head's own report, so its words, not code's)
  const heads = org ? org.departments.map((d) => headOf(org, d.id)).filter((s) => s?.holder === "agent" && s.agentId).map((s) => s!.agentId as string) : [];
  const [outs, names] = await Promise.all([
    latestOutputs(heads).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>)),
    agentNames([...new Set([...heads, ...(pending ?? []).map((p) => p.from_agent).filter((x): x is string => !!x)])]).catch(() => ({} as Record<string, string>)),
  ]);
  const quoteOf = (deptId: string) => {
    const h = org ? headOf(org, deptId) : null;
    const o = h?.agentId ? outs[h.agentId] : undefined;
    return o && h?.agentId ? { who: names[h.agentId] ?? h.agentId, text: firstSentence(o.summary) } : null;
  };
  // proposals show here as cards, so their summary line in Needs you goes
  const rest = open.filter((x) => x.href !== "/proposals");
  const groups = groupByDepartment(rest, (id) => (org ? deptOf(org, id) : null));
  const props = pending ?? [];
  // a fresh org (no departments, no agents): start from a template pack's crew, or build from nothing
  const fresh = f.ok && !!org && org.departments.length === 0 && f.built.length === 0;

  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <span style={{ fontSize: 13 }} className="muted">{longDay(now)} · {hm(now)} CT</span>
        <h1 style={{ fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-.025em" }}>{deskGreeting(now)}.</h1>
        <p style={{ fontSize: 14.5, textWrap: "pretty" }} className="ink2">{deskLine(allGoals.map((g) => g.status), props.length, rest.length)}</p>
      </div>

      {!f.ok && <div className="card" style={{ background: "var(--red-soft)", color: "var(--red-ink)", borderColor: "transparent" }}>{f.problem}</div>}

      {fresh && (
        <section className="card" style={{ gap: 12 }} aria-labelledby="start-h">
          <h2 id="start-h" className="card-t">Start your crew</h2>
          <span className="sub">Begin from a template: its departments, org chart, agents, routines and goals, every agent off duty until you approve its playbook. Or start empty and build each agent yourself. First, name the business on Settings: every agent is told who it works for.</span>
          {crewPacks().map((p) => (
            <div key={p.id} className="row wrap rule" style={{ gap: 12, justifyContent: "space-between", paddingTop: 12 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}><b style={{ fontSize: 14 }}>{p.name}</b><span className="sub">{p.about}</span></span>
              <ActionButton className="btn dark sm" action={installTemplate.bind(null, p.id)} confirm={{ title: `Start from ${p.name}?`, body: "Installs its departments, org chart, agents, routines and goals into this business. Nothing runs: every agent is off duty, every routine off, and each playbook waits for your approval.", confirmLabel: "Install", kind: "dark" }}>Use this template</ActionButton>
            </div>
          ))}
          <div className="row wrap rule" style={{ gap: 12, justifyContent: "space-between", paddingTop: 12 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>Start empty</b><span className="sub">Add departments on Crew &gt; Org chart and build each agent in the builder.</span></span>
            <Link href="/build" className="btn outline sm">Build an agent</Link>
          </div>
        </section>
      )}

      <section className="card" style={{ gap: 12 }} aria-labelledby="goals-h">
        <div className="row wrap" style={{ gap: 12 }}>
          <h2 id="goals-h" className="card-t">Goals</h2>
          <Link href="/goals/new" className="btn outline sm"><Icon name="plus" size={14} />Set a goal</Link>
        </div>
        {goals == null ? <span className="sub">{GOALS_MISSING}</span>
          : allGoals.length ? <div className="goal-tiles">{allGoals.map((g) => <GoalTile key={g.id} g={g} showDept quote={quoteOf(g.deptId)} />)}</div>
          : <span className="sub">No goals yet. Give each department one, with a measure code can count, and its head plans around it.</span>}
      </section>

      <section className="stack" style={{ gap: 12 }} aria-labelledby="needs-h">
        <h2 id="needs-h" className="card-t">Needs you</h2>
        {props.map((p) => (
          <div key={p.id} className="card row wrap" style={{ flexDirection: "row", gap: 14 }}>
            <span className="pill sm" style={{ background: KIND_LOOK[p.kind]?.bg, color: KIND_LOOK[p.kind]?.fg, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{KIND_WORDS[p.kind]}</span>
            <span style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 15.5, fontWeight: 600 }}>{p.title}</b>
              <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>From {p.from_agent ? names[p.from_agent] ?? p.from_agent : p.source === "claude" ? "Claude" : "you"}: {firstSentence(p.why, 220)}</span>
            </span>
            <Link href={`/proposals/${p.id}`} className="btn dark">Review</Link>
          </div>
        ))}
        {groups.map((g) => (
          <div key={g.name ?? "all"} className="stack" style={{ gap: 6 }}>
            {g.name && <span className="ted-k" style={{ padding: "4px 2px 0" }}>{g.name}</span>}
            {g.items.map((x, i) => (
              <Link key={i} href={x.href} className="card row" style={{ flexDirection: "row", padding: 14, gap: 12, color: "var(--ink)", textDecoration: "none" }}>
                <span className="dot" style={{ width: 8, height: 8, background: PRI_COLOR[x.pri] }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{x.title}</span><span className="clip muted" style={{ fontSize: 12.5 }}>{x.sub}</span></span>
                <Icon name="chevron-right" size={15} style={{ opacity: 0.5 }} />
              </Link>
            ))}
          </div>
        ))}
        {!props.length && !rest.length && <span className="sub">Nothing needs you. Ask Avery how things are going, or set a goal.</span>}
      </section>
    </>
  );
}
