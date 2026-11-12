import { cookies } from "next/headers";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import Link from "next/link";
import { chicagoDate } from "@/core/time";
import { BUILT, BY_ID, INTEGRATIONS, PLANNED } from "@/dashboard/crew";
import { getFloor, getMemoryMeters, getPipeline, leadsForRun } from "@/dashboard/data";
import { dow, hm, longDay, m2, m4, num, shortHm, when } from "@/dashboard/format";
import { PRI_COLOR, needs } from "@/dashboard/needs";
import { firingOn, schedWords, weekFrom } from "@/dashboard/schedule";
import { RUN_LOOK, STATE_LOOK, stateOf } from "@/dashboard/status";
import { Icon } from "@/dashboard/components/Icon";
import { RunCanvas } from "@/dashboard/components/RunCanvas";
import { Avatar, Pill } from "@/dashboard/components/ui";

export default async function MissionControl() {
  const f = await getFloor();
  const now = f.now;
  const open = needs(f, now, parseSeen((await cookies()).get(SEEN_COOKIE)?.value));
  const today = chicagoDate(0, new Date(now));
  const todayRuns = f.runs.filter((r) => chicagoDate(0, new Date(r.started_at)) === today);
  const ok = todayRuns.filter((r) => r.status === "ok").length, sk = todayRuns.filter((r) => r.status === "skipped").length, fl = todayRuns.filter((r) => r.status === "failed").length;
  const spend = Object.values(f.spentToday).reduce((s, v) => s + v, 0);
  const budgetSum = BUILT.reduce((s, a) => s + (f.agents[a.id]?.daily_budget_usd ?? 0), 0);
  const systems = INTEGRATIONS.filter((i) => f.health[i.id]).length;
  const [pipeline, meters] = await Promise.all([getPipeline(), getMemoryMeters()]);

  const latest = f.runs.find((r) => r.status !== "skipped" && BY_ID[r.agent_id]?.built) ?? null;
  const floorAgent = latest ? BY_ID[latest.agent_id] : BY_ID.wholesale_hunter;
  const leads = latest?.agent_id === "wholesale_hunter" ? await leadsForRun(latest.id) : null;

  const states = BUILT.map((a) => ({ a, st: stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0) }));
  const off = states.filter((s) => s.st === "paused").map((s) => s.a.name);
  const others = states.filter((s) => s.st !== "paused").map((s) => `${s.a.name} is ${STATE_LOOK[s.st].label.toLowerCase()}`);
  const n = open.length;
  const greeting = n ? `${n === 1 ? "One thing needs" : `${n} things need`} you.` : "Quiet floor. Nothing needs you.";
  const greetingSub = [off.length ? `${off.join(" and ")} ${off.length > 1 ? "are" : "is"} off duty${STATE_LOOK.paused.label.endsWith("launch") ? " until launch" : ""}.` : "", others.length ? others.join(", ") + "." : "", `${PLANNED.length} more join after launch.`].filter(Boolean).join(" ");

  const segs = (["High", "Medium", "Low"] as const).map((p) => ({ p, count: open.filter((x) => x.pri === p).length }));
  const days = weekFrom(now);

  return (
    <>
      <div className="row wrap" style={{ alignItems: "flex-end", gap: 24 }}>
        <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13 }} className="muted">{longDay(now)} · {hm(now)} CT</span>
          <h1 style={{ fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-.025em", textWrap: "pretty" }}>{greeting}</h1>
          <p style={{ fontSize: 14.5, textWrap: "pretty" }} className="ink2">{greetingSub}</p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {[
            ["Spend today", m4(spend), `of ${m2(budgetSum)}`],
            ["Runs today", String(todayRuns.length), `${ok} OK · ${sk} skipped${fl ? ` · ${fl} failed` : ""}`],
            ["Pipeline", pipeline ? String(pipeline.total) : "—", "leads"],
            ["Systems", `${systems}/${INTEGRATIONS.length}`, "connected"],
          ].map(([l, v, s]) => (
            <div key={l} className="chip"><span className="chip-l">{l}</span><span className="chip-v">{v}<span style={{ fontWeight: 400, fontSize: 12.5 }} className="muted"> {s}</span></span></div>
          ))}
        </div>
      </div>

      {!f.ok && <div className="card" style={{ background: "var(--red-soft)", color: "var(--red-ink)", borderColor: "transparent" }}>{f.problem}</div>}

      <div className="card" style={{ padding: 16, borderRadius: 24 }}>
        <div className="row" style={{ gap: 12, padding: "6px 8px 0", flexWrap: "wrap" }}>
          <Icon name="clock" />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 200 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Live floor</span>
            <span className="sub">{latest ? `${floorAgent.name} · latest real run · ${when(latest.started_at)} CT` : "No real runs yet. Skipped runs while off duty don’t count."}</span>
          </div>
          {latest && <Pill look={RUN_LOOK[latest.status]} />}
          {latest && <Link href={`/runs/${latest.id}`} className="btn outline" style={{ height: 38, fontSize: 13.5 }}>Replay run<Icon name="history" size={15} /></Link>}
        </div>
        <RunCanvas a={floorAgent} run={latest} leads={leads} />
      </div>

      <div className="home-grid">
        <div className="card">
          <span className="card-t">Needs you</span>
          <div className="row" style={{ alignItems: "baseline" }}><span className="big">{n}</span><span style={{ fontSize: 13 }} className="ink2">{n ? "open" : "all clear"}</span></div>
          {n > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 14, fontSize: 12.5 }}>
                {segs.map((s) => <span key={s.p} className="row" style={{ gap: 6 }}><span style={{ width: 3, height: 12, borderRadius: 2, background: PRI_COLOR[s.p] }} /><b style={{ fontWeight: 600 }}>{s.count}</b> {s.p}</span>)}
              </div>
              <div className="bar" style={{ height: 40 }}>{segs.filter((s) => s.count).map((s) => <span key={s.p} style={{ flex: s.count, background: PRI_COLOR[s.p] }} />)}</div>
            </div>
          )}
          <div className="stack" style={{ gap: 4 }}>
            {open.map((x, i) => (
              <Link key={i} href={x.href} className="row" style={{ padding: 10, borderRadius: 14, background: "var(--soft)", color: "var(--ink)", textDecoration: "none" }}>
                <span className="dot" style={{ width: 8, height: 8, background: PRI_COLOR[x.pri] }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{x.title}</span><span className="clip muted" style={{ fontSize: 12 }}>{x.sub}</span></span>
                <Icon name="chevron-right" size={15} style={{ opacity: 0.5 }} />
              </Link>
            ))}
            {!n && <span style={{ fontSize: 14, padding: "8px 0" }} className="muted">Nothing needs you.</span>}
          </div>
        </div>

        <div className="card">
          <div className="row wrap" style={{ gap: 12 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 15, fontWeight: 600 }}>Shift board</span><span className="sub">This week · Central Time</span></div>
            <span className="row" style={{ gap: 6, fontSize: 12 }}><span style={{ width: 18, height: 8, borderRadius: 999, background: "var(--acc)" }} />Runs</span>
            <span className="row" style={{ gap: 6, fontSize: 12 }}><span style={{ width: 18, height: 8, borderRadius: 999, border: "1.5px solid var(--mut2)" }} />Will skip, off duty</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 400 }}>
              <div className="shift-grid">
                <span />
                {days.map((d, i) => <span key={d} style={{ fontSize: 12, textAlign: "center", color: i === 0 ? "var(--acc-ink)" : "var(--mut)", fontWeight: i === 0 ? 700 : 500 }}>{dow(`${d}T18:00:00Z`)} {Number(d.slice(8))}</span>)}
              </div>
              {BUILT.map((a) => {
                const row = f.agents[a.id];
                return (
                  <div key={a.id} className="shift-grid rule" style={{ padding: "6px 0", marginTop: 6 }}>
                    <Link href={`/agents/${a.id}?tab=shift`} className="row" style={{ gap: 9, color: "var(--ink)", minWidth: 0 }}>
                      <Avatar a={a} working={states.find((x) => x.a.id === a.id)?.st === "running"} />
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span><span className="clip muted" style={{ fontSize: 11 }}>{schedWords(a.schedule)}{row?.enabled ? "" : " · will skip"}</span></span>
                    </Link>
                    {days.map((d) => {
                      const ran = f.runs.find((r) => r.agent_id === a.id && r.status !== "skipped" && chicagoDate(0, new Date(r.started_at)) === d);
                      if (ran) return <span key={d} className="cell" style={{ background: a.hue, borderColor: a.hue, color: "#111114" }}>{shortHm(ran.started_at)}</span>;
                      const t = firingOn(a.schedule, d);
                      if (!t) return <span key={d} className="cell" />;
                      if (t < now) return <span key={d} className="cell" style={{ background: "var(--soft)", color: "var(--mut)" }}>{f.runs.some((r) => r.agent_id === a.id && r.status === "skipped" && chicagoDate(0, new Date(r.started_at)) === d) ? "Skipped" : "—"}</span>;
                      return row?.enabled
                        ? <span key={d} className="cell" style={{ background: a.hue, borderColor: a.hue, color: "#111114" }}>{shortHm(t)}</span>
                        : <span key={d} className="cell" style={{ borderColor: "var(--mut2)", color: "var(--mut)" }}>{shortHm(t)}</span>;
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <span className="sub">Times mirror vercel.json. Whether each Vercel schedule is switched on lives in Vercel.</span>
        </div>

        <div className="stack">
          <div className="card" style={{ gap: 12 }}>
            <span className="card-t">Spend by agent</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>{m4(spend)}</span><span className="muted" style={{ fontSize: 12 }}>of {m2(budgetSum)} in daily budgets</span></div>
            <div className="bar" style={{ height: 10, borderRadius: 999, gap: 3 }}>{BUILT.map((a) => <span key={a.id} style={{ width: `${budgetSum ? ((f.spentToday[a.id] ?? 0) / budgetSum) * 100 : 0}%`, background: a.hue }} />)}</div>
            {BUILT.map((a) => (
              <div key={a.id} className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="dot" style={{ background: a.hue }} /><span style={{ flex: 1 }}>{a.name}</span><b style={{ fontWeight: 600 }}>{m4(f.spentToday[a.id] ?? 0)}</b><span className="muted">/ {m2(f.agents[a.id]?.daily_budget_usd ?? 0)}</span></div>
            ))}
            <span className="muted" style={{ fontSize: 11.5 }}>Budget day resets at midnight UTC, the same rule the agents use.</span>
          </div>
          <div className="card" style={{ gap: 12 }}>
            <span className="card-t">Memory per agent</span>
            {meters ? BUILT.filter((a) => meters[a.id]).map((a) => {
              const m = meters[a.id];
              return (
                <Link key={a.id} href={`/agents/${a.id}?tab=memory`} style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--ink)", textDecoration: "none" }}>
                  <span className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="dot" style={{ background: a.hue }} /><span style={{ flex: 1 }}>{a.name}</span><b style={{ fontWeight: 600 }}>{num(m.tokens)}</b><span className="muted">/ {num(m.budget)} tok</span></span>
                  <div className="bar" style={{ height: 6, borderRadius: 999 }}><span style={{ width: `${Math.min(100, (m.tokens / m.budget) * 100)}%`, background: a.hue }} /></div>
                  <span className="muted" style={{ fontSize: 11.5 }}>{m.lines} line{m.lines === 1 ? "" : "s"}{m.linked ? `, plus ${m.linked} linked Notion page${m.linked === 1 ? "" : "s"} read at run time` : ""}{f.lessonsWaiting?.[a.id] ? ` · ${f.lessonsWaiting[a.id]} lesson${f.lessonsWaiting[a.id] === 1 ? "" : "s"} to review` : ""}</span>
                </Link>
              );
            }) : <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">Couldn’t read the memory store.</span>}
            <span className="muted" style={{ fontSize: 11.5 }}>What each agent’s next run loads, counted in code. The CFO snapshot uses no model, so it carries none.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}><span style={{ fontSize: 15, fontWeight: 600 }}>Joining the crew</span><span className="sub">{PLANNED.length} planned · after launch</span></div>
        <div className="row wrap" style={{ gap: 8 }}>
          {PLANNED.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="row" style={{ padding: "8px 16px 8px 8px", borderRadius: 999, background: "var(--soft)", color: "var(--ink)", whiteSpace: "nowrap", textDecoration: "none" }}>
              <Avatar a={a} size={34} />
              <span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span><span className="muted" style={{ fontSize: 11.5 }}>{a.role} · Phase {a.phase}</span></span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
