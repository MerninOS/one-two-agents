import { cookies } from "next/headers";
import { needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import Link from "next/link";
import { notFound } from "next/navigation";
import { discardLessonLine, dryRun, editMemoryLine, forgetMemoryLine, keepLessonLine, realRun, setBudget, setEnabled, teach } from "@/dashboard/actions";
import { ACCESS, BY_ID, HARD_RULES, INTEGRATIONS, TIERS, type CrewMember } from "@/dashboard/crew";
import { getBooks, getFloor, getMemory, getPipeline, type Books, type Floor } from "@/dashboard/data";
import type { MemoryRow, PageLoad } from "@/core/memory";
import { MemoryLine, TeachForm, type LineView } from "@/dashboard/components/memory";
import { budget, dur, hm, m2, m4, md, num, when } from "@/dashboard/format";
import { nextRuns, schedSentence, schedWords } from "@/dashboard/schedule";
import { controlsOn } from "@/dashboard/session";
import { STATE_LOOK, combined, stateOf } from "@/dashboard/status";
import { ActionButton, BudgetForm, DryRun, MarkSeen, SwitchButton } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { RunTable } from "@/dashboard/components/RunTable";
import { Avatar, LockList, Pill, Summary } from "@/dashboard/components/ui";

// A real Wholesale Hunter run takes a few minutes. realRun returns at once and finishes the run in after(),
// which lives as long as this page's function allows.
export const maxDuration = 300;

const TABS = [["profile", "Profile"], ["memory", "Memory"], ["runs", "Runs and replays"], ["access", "Access"], ["shift", "Shift"], ["settings", "Settings"]] as const;
type Tab = (typeof TABS)[number][0];

const LEVEL_CLASS = { read: "lv-read", draft: "lv-draft", write: "lv-write", uses: "lv-uses" } as const;
const LEVEL_LABEL = { read: "Read", draft: "Draft", write: "Write", uses: "Uses" } as const;
const STAGE_COLORS: Record<string, string> = { new: "var(--mut2)", drafted: "var(--yel)", contacted: "var(--acc)", replied: "var(--pink)", tasting: "var(--peach)", won: "var(--mint)", lost: "var(--ink2)", skip: "var(--track)" };

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const a = BY_ID[id];
  if (!a) notFound();
  const tabParam = (await searchParams).tab;
  const tab: Tab = (TABS.find(([k]) => k === tabParam)?.[0] ?? "profile") as Tab;
  const f = await getFloor();
  const row = f.agents[id];
  const st = stateOf(a, row, f.runs, f.spentToday[id] ?? 0);
  const controls = controlsOn();
  const pipeline = id === "wholesale_hunter" ? await getPipeline() : null;
  const books = id === "bookkeeper" ? await getBooks() : null;
  const mem = a.built && (tab === "memory" || tab === "profile") ? await getMemory(id) : null;
  const runs = f.runs.filter((r) => r.agent_id === id);
  const unseen = needs(f, f.now, parseSeen((await cookies()).get(SEEN_COOKIE)?.value)).some((n) => n.run && n.agentId === id);

  return (
    <>
      {unseen && <MarkSeen agentId={id} at={f.now} />}
      {tab === "profile" ? <HeroFull a={a} f={f} controls={controls} /> : (
        <div className="row wrap" style={{ gap: 14 }}>
          <Avatar a={a} size={48} working={st === "running"} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 200 }}><span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>{a.name}</span><span className="muted" style={{ fontSize: 13 }}>{a.role} · {a.built ? `on the crew since ${a.since}` : `joining after launch · phase ${a.phase}`}</span></div>
          <Pill look={STATE_LOOK[st]} />
          {a.built && <DryRun action={dryRun.bind(null, id)} compact />}
        </div>
      )}

      {a.built && tab === "profile" && <Stats a={a} f={f} pipelineTotal={pipeline?.total} books={books} />}

      <div className="row wrap" style={{ gap: 6 }}>
        {TABS.map(([k, l]) => <Link key={k} href={`/agents/${id}${k === "profile" ? "" : `?tab=${k}`}`} className="btn sm" style={{ height: 38, fontSize: 13.5, background: tab === k ? "var(--ink)" : "var(--soft)", color: tab === k ? "var(--ws)" : "var(--ink)" }}>{l}</Link>)}
      </div>

      {tab === "profile" && (
        <div className="grid2">
          <div className="stack">
            <div className="card" style={{ gap: 0 }}>
              <span className="card-t" style={{ marginBottom: 10 }}>How {a.name} works</span>
              {(a.how ?? [["What it will do", a.job], ["Phase", `${a.phase} · build after launch`], ["Tier", TIERS[a.tier]], ["Intended trigger", a.trigger ?? "Set when built"]]).map(([k, v]) => <div key={k} className="kv"><span>{k}</span><span style={{ lineHeight: 1.45 }}>{v}</span></div>)}
            </div>
            <Toolbelt a={a} f={f} />
          </div>
          <div className="stack">
            <Journal a={a} f={f} mem={mem} />
            {id === "bookkeeper" && <BooksCard books={books} />}
            {pipeline && (
              <div className="card" style={{ gap: 12 }}>
                <div className="card-h"><span className="card-t">Pipeline</span><span className="sub">{pipeline.total} businesses</span></div>
                <div className="row wrap" style={{ gap: 14, fontSize: 12.5 }}>
                  {Object.entries(pipeline.stages).map(([k, n]) => <span key={k} className="row" style={{ gap: 6 }}><span style={{ width: 3, height: 12, borderRadius: 2, background: STAGE_COLORS[k] ?? "var(--mut2)" }} /><b style={{ fontWeight: 600 }}>{n}</b> {k}</span>)}
                  {!pipeline.total && <span className="muted">No leads yet.</span>}
                </div>
                {pipeline.total > 0 && <div className="bar" style={{ height: 36 }}>{Object.entries(pipeline.stages).map(([k, n]) => <span key={k} style={{ flex: n, background: STAGE_COLORS[k] ?? "var(--mut2)" }} />)}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "memory" && <Memory a={a} domains={pipeline?.domains} mem={mem} />}

      {tab === "runs" && (a.built ? <RunTable runs={runs.slice(0, 200)} showAgent={false} foot={`${runs.length} runs in the last 60 days · ${m4(runs.reduce((s, r) => s + r.cost_usd, 0))} spent`} /> : <div className="card dashed" style={{ padding: 40, textAlign: "center" }}><span className="muted">{a.name} hasn’t joined yet. No runs.</span></div>)}

      {tab === "access" && (
        <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
          <Toolbelt a={a} f={f} title={`What ${a.name} can touch`} noRules />
          <div className="card" style={{ gap: 4 }}>
            <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 8 }}><Icon name="lock" size={15} />Hard rules</span>
            <span className="sub" style={{ marginBottom: 6 }}>Locked. Can’t be switched off in this app.</span>
            <LockList rules={HARD_RULES} />
          </div>
        </div>
      )}

      {tab === "shift" && <Shift a={a} f={f} controls={controls} />}

      {tab === "settings" && (
        <div className="grid2">
          <div className="card" style={{ gap: 12 }}>
            <span className="card-t">Daily budget</span>
            {a.built && row ? (
              <>
                <BudgetForm current={row.daily_budget_usd} save={setBudget.bind(null, id)} controls={controls} />
                <span className="sub">Spent today {m4(f.spentToday[id] ?? 0)}. Model spend is capped per agent per UTC day by withRun.</span>
              </>
            ) : <span className="muted" style={{ fontSize: 13.5 }}>{a.built ? "Not in the agents table yet." : "Set when built."}</span>}
          </div>
          <div className="card" style={{ gap: 0 }}>
            <span className="card-t" style={{ marginBottom: 10 }}>Read only</span>
            {[["Agent id", id], ["Model", row?.model ?? a.model ?? "Set when built"], ["Schedule", row?.schedule ?? schedWords(a.schedule)], ["Tier", TIERS[a.tier]], ["On the crew since", a.since ?? "Not yet"]].map(([k, v]) => (
              <div key={k} className="row rule" style={{ justifyContent: "space-between", padding: "10px 0", fontSize: 13.5, gap: 16 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{v}</span></div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function crewSwitch(a: CrewMember, f: Floor, controls: boolean) {
  const on = !!f.agents[a.id]?.enabled;
  const next = nextRuns(a.schedule, f.now, 1)[0];
  return (
    <SwitchButton on={on} title="On the crew" disabled={!f.agents[a.id] || (!on && !controls)}
      action={setEnabled.bind(null, a.id, !on)}
      confirm={on
        ? { title: `Take ${a.name} off duty?`, body: "Every run after this, scheduled or manual, is skipped and logged at $0.", confirmLabel: "Take off duty", kind: "danger" }
        : { title: `Put ${a.name} back on the crew?`, body: "Scheduled and manual runs will go through again.", lines: [{ k: "Next scheduled run", v: next ? `${when(next)} CT, if the Vercel schedule is on` : "None. Runs when you press Run." }, { k: "Expected cost", v: `${a.estCostLabel ?? "?"} a run` }], confirmLabel: "Put on the crew" }} />
  );
}

function HeroFull({ a, f, controls }: { a: CrewMember; f: Floor; controls: boolean }) {
  const row = f.agents[a.id];
  const st = stateOf(a, row, f.runs, f.spentToday[a.id] ?? 0);
  const realLabel = `Real run · ${a.estCostLabel === "About $1" ? "~$1" : a.estCostLabel === "$0" ? "$0" : a.estCostLabel === "A few cents" ? "~$0.05" : "~$0.003"}`;
  return (
    <div className="card" style={{ padding: 28, borderRadius: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 28 }}>
      <div className="row" style={{ gap: 22, alignItems: "flex-start", minWidth: 0 }}>
        <span style={{ boxShadow: "0 12px 30px rgba(17,17,26,.10)", borderRadius: 999 }}><Avatar a={a} size={96} working={st === "running"} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="row wrap">
            <h1 style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1 }}>{a.name}</h1>
            <Pill look={STATE_LOOK[st]} />
            <span title={TIERS[a.tier]} className="pill" style={{ border: "1px solid var(--bd)" }}>{a.tier} tier</span>
          </div>
          <span className="muted" style={{ fontSize: 14 }}>{a.role} · {a.built ? `on the crew since ${a.since}` : `joining after launch · phase ${a.phase}`}</span>
          <p style={{ fontSize: 16, lineHeight: 1.55, maxWidth: 600, textWrap: "pretty" }} className="ink2">“{a.mandate}”</p>
          <div className="row wrap" style={{ gap: 6, fontSize: 12.5 }}>
            <span className="pill" style={{ background: "var(--soft)", fontWeight: 500 }}><span className="muted">Model</span>{a.model ?? "Set when built"}</span>
            <span className="pill" style={{ background: "var(--soft)", fontWeight: 500 }}><span className="muted">Budget</span>{row ? `${budget(row.daily_budget_usd)} a day` : "Set when built"}</span>
            {a.works && <span className="pill" style={{ background: "var(--soft)", fontWeight: 500, whiteSpace: "normal", borderRadius: 14 }}><span className="muted">Works with</span>{a.works}</span>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
        {a.built ? (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              <DryRun action={dryRun.bind(null, a.id)} />
              <ActionButton className="btn dark" action={realRun.bind(null, a.id)} disabled={!controls || !row || st === "running"} busyLabel="Starting…"
                title={!controls ? "Real runs need DASHBOARD_CONTROLS=on" : st === "running" ? `${a.name} is working. One run at a time.` : undefined}
                confirm={{ title: `Run ${a.name} for real?`, body: row?.enabled ? `${a.name} reads real data and writes: ${a.writes}. Logged in the run log.` : `${a.name} is off duty, so this run is logged as skipped at $0.`, lines: [{ k: "Expected cost", v: row?.enabled ? a.estCostLabel ?? "?" : "$0" }, { k: "Spent today", v: `${m4(f.spentToday[a.id] ?? 0)} of ${m2(row?.daily_budget_usd ?? 0)}` }, ...(a.id === "wholesale_hunter" && !f.health.gmail ? [{ k: "Note", v: "Gmail isn’t connected, so drafts land in Notion only." }] : [])], confirmLabel: "Run for real", kind: "dark" }}>
                {st === "running" ? <><span className="dot pulse" style={{ background: "var(--acc)" }} />Working…</> : realLabel}
              </ActionButton>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="soft-box">
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>On the crew</span><span className="muted" style={{ fontSize: 11.5 }}>{row?.enabled ? "Every run goes through" : "Every run is skipped at $0"}</span></div>
                {crewSwitch(a, f, controls)}
              </div>
              <Link href={`/agents/${a.id}?tab=shift`} className="soft-box" style={{ color: "var(--ink)", textDecoration: "none" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>Shift</span><span className="muted" style={{ fontSize: 11.5 }}>{schedWords(a.schedule)}</span></div>
                <Icon name="chevron-right" size={15} style={{ opacity: 0.5 }} />
              </Link>
            </div>
            <span style={{ fontSize: 12.5 }} className="ink2">{combined(a, row)}</span>
            {!controls && <span className="sub">Real runs and putting an agent back on the crew are off here until DASHBOARD_CONTROLS=on. Dry runs and taking agents off duty always work.</span>}
          </>
        ) : (
          <>
            <div style={{ padding: 16, borderRadius: 18, background: "var(--soft)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Phase {a.phase} · build after launch</span>
              <span style={{ fontSize: 13 }} className="ink2">{a.job}</span>
              <span className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="pill sm" style={{ background: "var(--card)", border: "1px solid var(--bd)", fontSize: 11 }}>Intended trigger</span>{a.trigger}</span>
            </div>
            <div><button className="btn ghost" disabled>Dry run · after launch</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function Stats({ a, f, pipelineTotal, books }: { a: CrewMember; f: Floor; pipelineTotal?: number; books?: Books | null }) {
  const runs = f.runs.filter((r) => r.agent_id === a.id);
  const ok = runs.filter((r) => r.status === "ok").length, fl = runs.filter((r) => r.status === "failed").length, sk = runs.filter((r) => r.status === "skipped").length;
  const spend30 = runs.filter((r) => f.now - Date.parse(r.started_at) < 30 * 864e5).reduce((s, r) => s + r.cost_usd, 0);
  const last = runs.find((r) => r.status !== "skipped");
  const b = f.agents[a.id]?.daily_budget_usd ?? 0;
  const stats: [string, string, string][] = [
    ["Runs", String(runs.length), `${ok} OK · ${fl} failed · ${sk} skipped`],
    a.id === "wholesale_hunter" ? ["Leads in pipeline", pipelineTotal == null ? "—" : String(pipelineTotal), "in wholesale_leads"]
      : a.id === "bookkeeper" ? ["Receipt coverage", books?.coverage == null ? "—" : `${books.coverage}%`, books ? `${books.total} charges in expense_docs · target 95%` : "expense_docs not there yet"]
      : [a.id === "cfo" ? "Snapshots written" : "Briefs posted", String(ok), "last 60 days"],
    ["Skipped while off duty", String(sk), "logged at $0"],
    ["30-day spend", m4(spend30), `of ${m2(b * 30)} budget`],
    ["Last real run", last ? md(last.started_at) : "—", last ? `${hm(last.started_at)} CT · ${dur(last.started_at, last.ended_at)} · ${m4(last.cost_usd)}` : "none yet"],
  ];
  return (
    <div className="card" style={{ padding: "20px 8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", rowGap: 16 }}>
      {stats.map(([l, v, s]) => (
        <div key={l} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 20px", borderLeft: "1px solid var(--bd)" }}>
          <span className="sub">{l}</span><span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>{v}</span><span style={{ fontSize: 12 }} className="ink2">{s}</span>
        </div>
      ))}
    </div>
  );
}

const BOOK_STATUS: [string, string, string][] = [
  ["matched", "receipt on file", "var(--mint)"], ["bank_record_only", "bank record only", "var(--yel)"], ["needs_photo", "need a photo", "var(--acc)"],
  ["open", "not checked yet", "var(--mut2)"], ["personal", "personal", "var(--pink)"], ["not_needed", "own-account moves", "var(--track)"],
];

function BooksCard({ books }: { books: Books | null }) {
  if (!books) return <div className="card" style={{ gap: 8 }}><span className="card-t">Receipts</span><span className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>The expense_docs table isn’t there yet. Apply the bookkeeper migration to the one-two-agents Supabase project.</span></div>;
  const shown = BOOK_STATUS.filter(([k]) => books.statuses[k]);
  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="card-h"><span className="card-t">Receipts</span><span className="sub">{books.total} charges · {books.proposals} proposed Mercury changes</span></div>
      <div className="row wrap" style={{ gap: 14, fontSize: 12.5 }}>
        {shown.map(([k, l, c]) => <span key={k} className="row" style={{ gap: 6 }}><span style={{ width: 3, height: 12, borderRadius: 2, background: c }} /><b style={{ fontWeight: 600 }}>{books.statuses[k]}</b> {l}</span>)}
        {!books.total && <span className="muted">No charges yet. Quinn hasn’t run.</span>}
      </div>
      {books.total > 0 && <div className="bar" style={{ height: 36 }}>{shown.map(([k, , c]) => <span key={k} style={{ flex: books.statuses[k], background: c }} />)}</div>}
      {books.waiting.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="sub" style={{ marginBottom: 4 }}>Waiting on a photo</span>
          {books.waiting.map((w) => <div key={`${w.date}-${w.merchant}-${w.amount_usd}`} className="row rule" style={{ justifyContent: "space-between", padding: "8px 0", fontSize: 13 }}><span>{md(`${w.date}T12:00:00Z`)} · {w.merchant}</span><b style={{ fontWeight: 600 }}>{m2(w.amount_usd)}</b></div>)}
        </div>
      )}
      <span className="sub">{books.proposals ? <><Link href="/approvals">Review proposals in Approvals</Link>. </> : null}Nothing goes to Mercury until you approve it. Record keeping, not tax advice.</span>
    </div>
  );
}

function Toolbelt({ a, f, title = "Toolbelt", noRules }: { a: CrewMember; f: Floor; title?: string; noRules?: boolean }) {
  const acc = ACCESS[a.id] ?? {};
  const tools = INTEGRATIONS.filter((i) => acc[i.id]);
  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="card-h"><span className="card-t">{title}</span><span className="muted" style={{ fontSize: 12 }}>Read · Draft · Write</span></div>
      {tools.map((i) => {
        const [lv, scope] = acc[i.id]!;
        return (
          <div key={i.id} className="row" style={{ gap: 12, padding: "10px 12px", borderRadius: 16, background: "var(--soft)" }}>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: "var(--card)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={i.icon} size={15} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name}</span><span style={{ fontSize: 12 }} className="ink2">{scope}</span></span>
            {a.built && !f.health[i.id] && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--red-ink)" }}>Not set up</span>}
            <span className={`pill sm ${LEVEL_CLASS[lv]}`} style={{ fontWeight: 700, fontSize: 11.5 }}>{LEVEL_LABEL[lv]}</span>
          </div>
        );
      })}
      {!tools.length && <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">Access is set when {a.name} is built, following the tech spec.</span>}
      {!noRules && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--bd)" }}>
          <span className="row" style={{ gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 6 }}><Icon name="lock" size={14} />Never · locked for every agent</span>
          {HARD_RULES.map((r) => <span key={r} className="row ink2" style={{ gap: 8, fontSize: 12.5, padding: "3px 0", lineHeight: 1.45, alignItems: "flex-start" }}><Icon name="lock" size={12} style={{ marginTop: 3, flex: "none", opacity: 0.5 }} />{r}</span>)}
        </div>
      )}
    </div>
  );
}

function Journal({ a, f, mem }: { a: CrewMember; f: Floor; mem: Awaited<ReturnType<typeof getMemory>> | null }) {
  const runs = f.runs.filter((r) => r.agent_id === a.id);
  const taught = (mem?.tab?.rows ?? []).filter((r) => r.agent_id === a.id && r.state === "kept" && (r.grp === "note" || r.grp === "standing_order" || r.grp === "lesson")).slice(0, 8);
  const real = runs.filter((r) => r.status !== "skipped").slice(0, 12);
  const skipped = runs.filter((r) => r.status === "skipped");
  const items = [
    ...real.map((r) => ({ key: r.id, t: Date.parse(r.started_at), icon: r.status === "failed" ? "circle-alert" : "play", color: r.status === "failed" ? "var(--red)" : r.status === "running" ? "var(--acc)" : "var(--mint)", title: r.status === "failed" ? "Run failed" : r.status === "running" ? "Working now" : `Real run · ${r.trigger === "cron" ? "on schedule" : "manual"}`, text: r.error ?? r.summary, meta: `${dur(r.started_at, r.ended_at)} · ${m4(r.cost_usd)}`, href: `/runs/${r.id}` })),
    ...taught.map((r) => ({ key: r.id, t: Date.parse(r.created_at), icon: r.grp === "lesson" ? "brain" : "pencil", color: GROUP_COLOR[r.grp], title: r.grp === "lesson" ? "Lesson kept" : r.grp === "standing_order" ? "Standing order from you" : "Note from you", text: r.text, meta: keepWords(r), href: `/agents/${a.id}?tab=memory` })),
    ...(skipped.length ? [{ key: "skipped", t: Date.parse(skipped[0].started_at), icon: "clock", color: "var(--mut2)", title: `${skipped.length} runs skipped while off duty`, text: "Every skipped run is logged at $0.", meta: `Latest ${when(skipped[0].started_at)}`, href: `/runs?agent=${a.id}&status=skipped` }] : []),
  ].sort((x, y) => y.t - x.t);
  return (
    <div className="card">
      <div className="card-h"><span className="card-t">Journal</span><span className="muted" style={{ fontSize: 12 }}>Newest first</span></div>
      {a.built && <TeachForm name={a.name} compact enabled={!!mem?.tab} why={`Tell ${a.name} something for next time (needs the memory tables)`} teach={teach.bind(null, a.id)} />}
      <div>
        {items.map((j) => (
          <div key={j.key} className="rule" style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 12, padding: "12px 0" }}>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center", position: "relative" }}><Icon name={j.icon} size={14} /><span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 999, background: j.color, border: "2px solid var(--card)" }} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{j.title}</span><span style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }} className="ink2"><Summary text={j.text} /></span><span className="muted" style={{ fontSize: 11.5 }}>{j.meta}</span></span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}><span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{when(j.t)}</span><Link href={j.href} className="btn outline xs">{j.key === "skipped" ? "See all" : j.href.includes("tab=memory") ? "Memory" : "Replay"}</Link></span>
          </div>
        ))}
        {a.built && (
          <div className="rule" style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 12, padding: "12px 0" }}>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center" }}><Icon name="user-plus" size={14} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>Joined the crew · {a.since}</span><span style={{ fontSize: 13 }} className="ink2">{a.name} joined as {a.role}. Tier: {a.tier}.</span></span>
          </div>
        )}
        {!a.built && <span style={{ fontSize: 13 }} className="muted">{a.name} hasn’t joined yet. The journal starts on day one.</span>}
      </div>
    </div>
  );
}

const GROUP_COLOR: Record<string, string> = { crew: "var(--mut2)", standing_order: "var(--acc)", pages: "var(--acc-soft)", lesson: "var(--yel)", note: "var(--pink)", working: "var(--peach)" };
const GROUP_NAME: Record<string, string> = { crew: "Crew", standing_order: "Standing orders", lesson: "Lessons", note: "Your notes", working: "Working memory", pages: "Notion pages" };

function keepWords(r: MemoryRow) {
  if (r.grp === "working") return `Left by the agent · ${when(r.created_at)}`;
  const by = r.source === "approval" ? "From an approval" : r.source === "agent" ? "Agent" : "You";
  const life = r.keep === "next_run" ? "forgets after the next run" : r.keep === "days_30" && r.expires_at ? `forgets ${md(r.expires_at)}` : "kept until you forget it";
  return `${by} · ${when(r.created_at)} · ${life}`;
}
const toLine = (r: MemoryRow, pages: PageLoad[] = []): LineView => {
  const p = r.notion_page_id ? pages.find((x) => x.memoryId === r.id) : undefined;
  const page = r.notion_page_id ? {
    title: p?.title ?? "Notion page",
    href: `https://www.notion.so/${r.notion_page_id}`,
    note: !p ? "read on each run" : p.problem ? p.problem : `read each run, ${num(p.tokens)} tokens${p.cut ? ", cut to fit" : ""}`,
    bad: !!p?.problem,
  } : undefined;
  return { id: r.id, text: r.text, meta: keepWords(r), data: r.trust === "data", page };
};

const EVENT_WORDS: Record<string, string> = { added: "Taught", edited: "Edited", forgotten: "Forgot", expired: "Expired", rewritten: "Working memory rewritten", proposed: "Lesson proposed", kept: "Kept", discarded: "Discarded" };

function Memory({ a, domains, mem }: { a: CrewMember; domains?: string[]; mem: Awaited<ReturnType<typeof getMemory>> | null }) {
  if (!a.built) return <div className="card" style={{ padding: 56, textAlign: "center", fontSize: 16 }}><span className="ink2">{a.name} hasn’t joined yet. Memory starts on day one.</span></div>;
  const tab = mem?.tab ?? null;
  const reads = INTEGRATIONS.filter((i) => ACCESS[a.id]?.[i.id]?.[0] === "read");
  const mine = (g: string) => (tab?.rows ?? []).filter((r) => r.grp === g && r.state === "kept" && (g === "crew" ? r.agent_id === null : r.agent_id === a.id));
  const editable = !!tab;
  const proposed = (tab?.rows ?? []).filter((r) => r.grp === "lesson" && r.state === "proposed" && r.agent_id === a.id);
  const lines = (g: string, opts: { edit?: boolean } = { edit: true }) => mine(g).map((r) => (
    <MemoryLine key={r.id} line={toLine(r, tab?.pages)} color={GROUP_COLOR[g]} edit={editable && opts.edit ? editMemoryLine.bind(null, r.id) : undefined} forget={editable ? forgetMemoryLine.bind(null, r.id) : undefined} />
  ));
  const load = tab?.load ?? null;
  const groups: { n: number; title: string; color: string; meta: string; body: React.ReactNode }[] = [
    { n: 1, title: "Standing orders", color: "var(--acc)", meta: "Yours, kept until you forget them. An order can link a Notion page, read fresh each run. Its base instructions stay in code (see Profile).", body: (
      <>
        {lines("standing_order")}
        {!mine("standing_order").length && <span className="muted" style={{ fontSize: 13 }}>None yet. Use Teach and pick “A standing order”, with a Notion page if it should read one.</span>}
      </>
    ) },
    { n: 2, title: "Facts it may claim", color: "var(--mint)", meta: "Read fresh every run, never from the model", body: (
      <>{reads.map((i) => <div key={i.id} className="row rule" style={{ alignItems: "flex-start", padding: "10px 0", fontSize: 13.5, lineHeight: 1.45 }}><span className="dot" style={{ width: 6, height: 6, marginTop: 7, background: "var(--mint)" }} />{i.name}: {ACCESS[a.id]![i.id]![1]}</div>)}{!reads.length && <span className="muted" style={{ fontSize: 13 }}>Reads nothing.</span>}</>
    ) },
    { n: 3, title: "Lessons", color: "var(--yel)", meta: "Proposed when you reject an approval and say why. Nothing sticks until you tap Keep.", body: (
      <>
        {proposed.map((r) => (
          <MemoryLine key={r.id} line={{ ...toLine(r), meta: `Proposed · ${when(r.created_at)} · waiting for your Keep` }} color="var(--yel)"
            edit={editMemoryLine.bind(null, r.id)} keep={keepLessonLine.bind(null, r.id, false)} keepCrew={keepLessonLine.bind(null, r.id, true)} discard={discardLessonLine.bind(null, r.id)} />
        ))}
        {lines("lesson")}
        {!mine("lesson").length && !proposed.length && <span className="muted" style={{ fontSize: 13 }}>No lessons yet. When you reject an approval and say why, the reason lands here as a proposed lesson.</span>}
      </>
    ) },
    { n: 4, title: "Your notes", color: "var(--pink)", meta: "Things you told the agent directly", body: (
      <>{lines("note")}{!mine("note").length && <span className="muted" style={{ fontSize: 13 }}>Nothing yet. Notes can be for the next run, 30 days or for good.</span>}</>
    ) },
    { n: 5, title: "Working memory", color: "var(--peach)", meta: "Where it left off, rewritten at the end of each run. At most 5 short lines, no addresses or links.", body: (
      <>{lines("working")}{!mine("working").length && <span className="muted" style={{ fontSize: 13 }}>{tab?.loads ? "Empty until the next real run." : `${a.name} starts keeping working memory in a later update.`}</span>}</>
    ) },
    a.id === "wholesale_hunter"
      ? { n: 6, title: "Don’t repeat", color: "var(--ink2)", meta: "Businesses already in the pipeline, by domain. Real, from wholesale_leads.", body: <div className="row wrap" style={{ gap: 6 }}>{(domains ?? []).slice(0, 60).map((c) => <span key={c} className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>{c}</span>)}{!domains?.length && <span className="muted" style={{ fontSize: 13 }}>No leads yet.</span>}</div> }
      : { n: 6, title: "Don’t repeat", color: "var(--ink2)", meta: "Worked out from its own tables each run", body: <span className="muted" style={{ fontSize: 13 }}>Nothing to avoid yet.</span> },
  ];
  const pageLoad = (load?.pages ?? []).filter((p) => p.tokens > 0);
  const seg = load ? [
    ...(Object.entries(load.groups) as [string, { lines: number; tokens: number }][]),
    ...(pageLoad.length ? [["pages", { lines: pageLoad.length, tokens: pageLoad.reduce((s, p) => s + p.tokens, 0) }] as [string, { lines: number; tokens: number }]] : []),
  ] : [];
  return (
    <div className="stack">
      {!tab && <div className="card dashed" style={{ padding: 20, gap: 6 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Memory isn’t switched on yet</span><span className="ink2" style={{ fontSize: 13 }}>{mem?.problem ?? "Couldn’t read the memory store."}</span></div>}
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)" }}>
        <div className="card glow" style={{ gap: 12 }}>
          <div className="card-h"><span className="card-t">Context meter</span>{load && <span className="sub">{num(load.tokens)} of {num(load.budget)} tokens</span>}</div>
          {load ? (
            <>
              <div className="bar" style={{ height: 14, borderRadius: 999, gap: 2 }}>{seg.map(([g, v]) => <span key={g} title={`${GROUP_NAME[g]}: ${v.tokens} tokens`} style={{ width: `${Math.min(100, (v.tokens / load.budget) * 100)}%`, background: GROUP_COLOR[g] }} />)}</div>
              <div className="row wrap" style={{ gap: 12, fontSize: 12 }}>
                {seg.map(([g, v]) => <span key={g} className="row" style={{ gap: 6 }}><span className="dot" style={{ background: GROUP_COLOR[g] }} />{GROUP_NAME[g]} <b style={{ fontWeight: 600 }}>{v.lines}</b><span className="muted">· {num(v.tokens)} tok</span></span>)}
                {!seg.length && <span className="muted">Nothing to load yet. The next run starts with an empty memory.</span>}
              </div>
              <span className="muted" style={{ fontSize: 11.5 }}>What {a.name}’s next run loads, counted in code. {load.dropped ? `${load.dropped} line(s) left out to stay in budget. ` : ""}{load.overBudget ? "Crew memory and standing orders alone pass the budget. " : ""}The budget is memory_budget_tokens in policies.</span>
            </>
          ) : (
            <span style={{ fontSize: 13.5, lineHeight: 1.5 }} className="ink2">{tab ? `${a.name} doesn’t load memory yet. It starts in a later update; what you teach now is kept for then.` : "Shows once the memory tables exist."}</span>
          )}
        </div>
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">Teach {a.name} something</span>
          <TeachForm name={a.name} enabled={!!tab} why="Needs the memory tables (see the PR)" teach={teach.bind(null, a.id)} />
          <span className="row ink2" style={{ gap: 8, fontSize: 12, lineHeight: 1.45, alignItems: "flex-start" }}><Icon name="lock" size={13} style={{ marginTop: 2, flex: "none" }} />Memory can’t widen access, switch off a hard rule or add a recipient. Only Zak writes rules.</span>
        </div>
      </div>
      <div className="grid2">
        {groups.map((g) => (
          <div key={g.n} className="card" style={{ gap: 10 }}>
            <div className="card-h">
              <span style={{ width: 28, height: 28, borderRadius: 999, background: g.color, color: "#111114", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{g.n}</span>
              <span className="card-t">{g.title}</span>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{g.meta}</span>
            <div>{g.body}</div>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card" style={{ gap: 6 }}>
          <div className="card-h"><span className="card-t">Shared crew memory</span><span className="tag">LOADED BY EVERY AGENT</span></div>
          <span className="muted" style={{ fontSize: 12 }}>Voice and brand facts you teach the whole crew, then the hard rules, which live in code.</span>
          <div>{lines("crew")}</div>
          {!mine("crew").length && <span className="muted" style={{ fontSize: 13, padding: "4px 0 8px" }}>No crew notes yet. Use Teach and pick “Shared crew memory”.</span>}
          <LockList rules={HARD_RULES} />
        </div>
        <div className="stack">
          <div className="card" style={{ gap: 4 }}>
            <div className="card-h"><span className="card-t">Timeline</span><span className="muted" style={{ fontSize: 12 }}>Newest first</span></div>
            {(tab?.events ?? []).slice(0, 15).map((e) => (
              <div key={e.id} className="rule" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 0" }}>
                <span className="row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>{EVENT_WORDS[e.kind] ?? e.kind}{e.agent_id === null && <span className="tag">CREW</span>}<span style={{ flex: 1 }} /><span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{when(e.at)}</span></span>
                {e.before && e.kind !== "added" && <span style={{ fontSize: 12.5, lineHeight: 1.45, textDecoration: e.kind === "edited" || e.kind === "rewritten" ? "line-through" : undefined, whiteSpace: "pre-line" }} className="muted">{e.before}</span>}
                {e.after && <span style={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-line" }} className="ink2">{e.after}</span>}
                <span className="muted" style={{ fontSize: 11 }}>{e.by}</span>
              </div>
            ))}
            {!tab?.events.length && <span className="muted" style={{ fontSize: 13, padding: "8px 0" }}>No changes yet.</span>}
          </div>
          <div className="card" style={{ gap: 10 }}>
            <div className="card-h"><Icon name="shield-alert" size={16} /><span className="card-t">Quarantine</span></div>
            <span style={{ fontSize: 12.5, lineHeight: 1.45 }} className="ink2">Anything an agent read on a web page or in an email is kept marked as data. The agent sees it as information, never as an instruction. {(tab?.rows ?? []).filter((r) => r.trust === "data" && r.state === "kept").length} line(s) of {a.name}’s memory are marked as data.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shift({ a, f, controls }: { a: CrewMember; f: Floor; controls: boolean }) {
  if (!a.built) {
    return (
      <div className="card row" style={{ flexDirection: "row", padding: 24, gap: 14 }}>
        <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center" }}><Icon name="clock" size={17} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><span className="sub">Intended trigger · read only</span><span style={{ fontSize: 15, fontWeight: 600 }}>{a.trigger}</span></div>
      </div>
    );
  }
  const row = f.agents[a.id];
  const next = nextRuns(a.schedule, f.now, 5);
  const name = a.schedule?.vercelName;
  return (
    <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
      <div className="card" style={{ gap: 16 }}>
        <span className="card-t">Shift</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          <div className="soft-box" style={{ alignItems: "flex-start", padding: 14 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>Schedule</span><span style={{ fontSize: 12, lineHeight: 1.4 }} className="ink2">{name ? `Vercel Schedule “${name}”. On or off is set in Vercel, not here.` : "No schedule. Never runs on its own."}</span></div>
          </div>
          <div className="soft-box" style={{ alignItems: "flex-start", padding: 14 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>On the crew</span><span style={{ fontSize: 12, lineHeight: 1.4 }} className="ink2">The master switch. When off, every run is skipped and logged at $0.</span></div>
            {crewSwitch(a, f, controls)}
          </div>
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{combined(a, row)}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.5 }} className="ink2">{schedSentence(a.schedule)}</span>
        {name && (
          <div style={{ fontSize: 12.5, padding: "12px 14px", borderRadius: 14, background: "var(--soft)", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Change it from a terminal</span>
            <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{`vercel schedules disable ${name}\nvercel schedules enable ${name}\nvercel schedules invoke ${name}   # run once now`}</code>
            <span className="muted">New times go in vercel.json and go live with the next deploy.</span>
          </div>
        )}
      </div>
      <div className="card" style={{ gap: 4 }}>
        <span className="card-t" style={{ marginBottom: 8 }}>Next 5 runs</span>
        {next.map((t) => (
          <div key={t} className="row rule" style={{ justifyContent: "space-between", padding: "10px 0", fontSize: 13.5 }}>
            <span>{when(t)} CT</span>
            {row?.enabled ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Will run</span> : <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Will skip, off duty</span>}
          </div>
        ))}
        {!next.length && <span style={{ fontSize: 13.5, padding: "10px 0" }} className="muted">On call. No automatic runs.</span>}
      </div>
    </div>
  );
}
