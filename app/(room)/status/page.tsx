import Link from "next/link";
import { requireSession } from "@/dashboard/data";
import { readStatus } from "@/core/status";
import { OVERDUE_MIN, REALERT_HOURS } from "@/core/status-rules";
import { hasEmail } from "@/integrations/email";

// Status (docs/usage.md, slice 4): everything that needs a look, on one page. Alerts (red) also
// email the owner from the scheduler; warnings only show here.
export default async function Status() {
  await requireSession();
  const { facts: f, problems } = await readStatus();
  const alerts = problems.filter((p) => p.level === "alert").length;
  const emails = await hasEmail();
  const tile = (label: string, value: React.ReactNode, sub: string) => (
    <div className="card" style={{ padding: "14px 18px", gap: 4, flex: "1 1 150px" }}>
      <span className="sub">{label}</span>
      <span style={{ fontSize: 24, fontWeight: 600 }}>{value}</span>
      <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
    </div>
  );
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="h1">Status</h1>
        <span className="pill sm" style={problems.length === 0 ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : alerts ? { background: "var(--red-soft)", color: "var(--red-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>
          {problems.length === 0 ? "All clear" : alerts ? `${alerts} need${alerts === 1 ? "s" : ""} a look` : `${problems.length} to know`}
        </span>
      </div>

      <div className="card" style={{ padding: "16px 22px", gap: 0 }}>
        {problems.length === 0 ? <span className="sub">Nothing is stuck, paused or refused. Jobs run on time and every connection is signed in.</span>
          : problems.map((p, i) => (
            <div key={p.key} className={"row" + (i ? " rule" : "")} style={{ justifyContent: "space-between", padding: "14px 0", gap: 16, fontSize: 14 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, marginRight: 8, background: p.level === "alert" ? "var(--red)" : "var(--ink2)" }} />{p.title}</span>
                <span className="muted" style={{ fontSize: 12 }}>{p.detail}</span>
              </span>
              <Link href={p.href} className="btn ghost sm">Open</Link>
            </div>
          ))}
      </div>

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {tile("Jobs waiting", f.waitingJobs, `${f.overdueJobs.count} more than ${OVERDUE_MIN} min late`)}
        {tile("Jobs failed", f.deadJobs.count, "in the last day")}
        {tile("Runs failed", f.failedRuns.count, "in the last day")}
        {tile("Refused", f.refused.count, "gateway proposals, last day")}
        {tile("Paused", f.paused.length, "connections")}
      </div>

      <span className="sub">
        {emails ? `Red items also email you from the scheduler (every 15 minutes): once when they start, then at most every ${REALERT_HOURS} hours while they last.`
          : "Red items show here. Alert emails go out once RESEND_API_KEY, BRIEF_FROM and BRIEF_TO are set (home business only, for now)."}
      </span>
    </div>
  );
}
