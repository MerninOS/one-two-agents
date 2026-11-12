import Link from "next/link";
import { BY_ID } from "../crew";
import type { Run } from "../data";
import { dur, m4, utcStr, when } from "../format";
import { RUN_LOOK } from "../status";
import { Avatar, Pill, Summary } from "./ui";

export function RunTable({ runs, showAgent = true, foot }: { runs: Run[]; showAgent?: boolean; foot?: React.ReactNode }) {
  const cols = showAgent ? undefined : { gridTemplateColumns: "110px 90px 120px 70px 80px minmax(0,1fr) 80px" };
  return (
    <div className="tbl">
      <div className="tbl-row head c-head" style={cols}>
        <span>Status</span>{showAgent && <span>Agent</span>}<span>Trigger</span><span>Started (CT)</span><span>Duration</span><span>Cost</span><span>Summary</span><span />
      </div>
      {runs.map((r) => {
        const a = BY_ID[r.agent_id];
        const trig = r.trigger === "cron" ? "Schedule" : r.trigger === "manual" ? "Manual" : r.trigger === "approval" ? "Approval" : r.trigger;
        return (
          <div key={r.id} className={"tbl-row" + (r.status === "failed" ? " fail" : "") + (showAgent ? "" : " no-agent")} style={cols}>
            <span className="c-status" style={{ justifySelf: "start" }}><Pill look={RUN_LOOK[r.status]} sm /></span>
            {showAgent && <span className="row c-agent" style={{ gap: 8, minWidth: 0 }}>{a && <Avatar a={a} size={24} />}<span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{a?.name ?? r.agent_id}</span></span>}
            <span className="ink2 c-wide">{trig}</span>
            <span className="ink2 c-wide" title={utcStr(r.started_at)} style={{ whiteSpace: "nowrap" }}>{when(r.started_at)}</span>
            <span className="c-wide">{dur(r.started_at, r.ended_at)}</span>
            <span className="c-wide" style={{ fontWeight: 600 }}>{m4(r.cost_usd)}</span>
            <span className="clip ink2 c-sum" title={r.error ?? r.summary ?? ""}><Summary text={r.error ? `Error: ${r.error}` : r.summary} /></span>
            {/* phones: time, trigger, duration and cost on one line instead of four columns */}
            <span className="c-meta ink2"><span title={utcStr(r.started_at)}>{when(r.started_at)}</span> · {trig} · {dur(r.started_at, r.ended_at)} · <b>{m4(r.cost_usd)}</b></span>
            <Link href={`/runs/${r.id}`} className="btn outline xs c-go">{r.status === "skipped" ? "Details" : "Replay"}</Link>
          </div>
        );
      })}
      {!runs.length && <div style={{ padding: 40, textAlign: "center", fontSize: 14 }} className="muted">No runs match.</div>}
      {foot && <div className="tbl-foot">{foot}</div>}
    </div>
  );
}
