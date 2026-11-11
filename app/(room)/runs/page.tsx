import Link from "next/link";
import { BUILT } from "@/dashboard/crew";
import { getFloor, type Run } from "@/dashboard/data";
import { m4 } from "@/dashboard/format";
import { RunTable } from "@/dashboard/components/RunTable";

type Q = { agent?: string; status?: string; trigger?: string; q?: string };

export default async function RunLog({ searchParams }: { searchParams: Promise<Q> }) {
  const sp = await searchParams;
  const f = await getFloor();
  const agent = BUILT.some((a) => a.id === sp.agent) ? sp.agent! : "all";
  const status = ["ok", "failed", "skipped", "running"].includes(sp.status ?? "") ? sp.status! : "all";
  const trigger = ["cron", "manual", "approval"].includes(sp.trigger ?? "") ? sp.trigger! : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const match = (r: Run) => (agent === "all" || r.agent_id === agent) && (status === "all" || r.status === status) && (trigger === "all" || r.trigger === trigger)
    && (!q || `${r.summary ?? ""} ${r.error ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const rows = f.runs.filter(match);
  const href = (patch: Partial<Q>) => {
    const p = new URLSearchParams();
    const next = { agent, status, trigger, q, ...patch };
    for (const [k, v] of Object.entries(next)) if (v && v !== "all") p.set(k, v);
    const s = p.toString();
    return s ? `/runs?${s}` : "/runs";
  };
  const seg = (key: keyof Q, cur: string, opts: [string, string][]) => (
    <div className="seg">{opts.map(([v, l]) => <Link key={v} href={href({ [key]: v })} className={cur === v ? "on" : ""}>{l}</Link>)}</div>
  );
  const ok = rows.filter((r) => r.status === "ok").length, fl = rows.filter((r) => r.status === "failed").length, sk = rows.filter((r) => r.status === "skipped").length;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><h1 className="h1">Run log</h1><span style={{ fontSize: 13.5 }} className="muted">Every real run, every agent, last 60 days. Dry runs aren’t logged.</span></div>
      <div className="row wrap" style={{ gap: 14 }}>
        {seg("agent", agent, [["all", "All agents"], ...BUILT.map((a) => [a.id, a.name] as [string, string])])}
        {seg("status", status, [["all", "Any status"], ["ok", "OK"], ["failed", "Failed"], ["skipped", "Skipped"]])}
        {seg("trigger", trigger, [["all", "Any trigger"], ["cron", "Schedule"], ["manual", "Manual"], ["approval", "Approval"]])}
        <form action="/runs" style={{ flex: 1, minWidth: 200, display: "flex" }}>
          {agent !== "all" && <input type="hidden" name="agent" value={agent} />}
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {trigger !== "all" && <input type="hidden" name="trigger" value={trigger} />}
          <input className="input" name="q" defaultValue={q} placeholder="Search summaries and errors" style={{ flex: 1, height: 38, fontSize: 13 }} />
        </form>
      </div>
      {!f.ok && <div className="card" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>{f.problem}</div>}
      <RunTable runs={rows.slice(0, 300)} foot={
        <span className="row wrap" style={{ justifyContent: "space-between" }}>
          <span>{rows.length} runs · {ok} OK · {fl} failed · {sk} skipped · {m4(rows.reduce((s, r) => s + r.cost_usd, 0))} spent</span>
          {(agent !== "all" || status !== "all" || trigger !== "all" || q) && <Link href="/runs">Clear filters</Link>}
        </span>
      } />
    </>
  );
}
