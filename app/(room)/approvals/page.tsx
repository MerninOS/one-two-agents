import Link from "next/link";
import { applyWaiting, approve, approveAll, queueQuinn, reject, retryAction } from "@/dashboard/actions";
import { BY_ID } from "@/dashboard/crew";
import { getApprovals, getFloor, type ApprovalItem } from "@/dashboard/data";
import { m2, md, when } from "@/dashboard/format";
import { controlsOn } from "@/dashboard/session";
import { ActionButton } from "@/dashboard/components/client";
import { Avatar, Empty } from "@/dashboard/components/ui";
import { writeBlocker } from "@/core/gateway";

// Applying a batch calls Mercury once or twice per change.
export const maxDuration = 300;

const ACTION_LOOK: Record<string, [string, string]> = {
  proposed: ["Waiting on you", "var(--yel)"], approved: ["Approved, not applied", "var(--acc)"], executing: ["Applying", "var(--acc)"],
  applied: ["Applied to Mercury", "var(--mint)"], partial: ["Partly applied", "var(--mint)"], failed: ["Failed", "var(--red)"],
  rejected: ["Rejected", "var(--mut2)"], expired: ["Expired (stale)", "var(--mut2)"], refused: ["Refused by the gateway", "var(--red)"],
};
const Tag = ({ s }: { s: string }) => {
  const [l, c] = ACTION_LOOK[s] ?? [s, "var(--mut2)"];
  return <span className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{l}</span>;
};

function Change({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const lines: [string, React.ReactNode][] = [
    ["Charge", `${p.merchant ?? "?"} · ${p.amount_usd != null ? m2(p.amount_usd) : "?"} · ${p.date ? md(`${p.date}T12:00:00Z`) : "?"}`],
    ...(p.receipt_path ? [["Attach receipt", i.receipt_url ? <a key="r" href={i.receipt_url} target="_blank" rel="noopener noreferrer">{p.receipt_path.split("/").pop()} (open)</a> : p.receipt_path.split("/").pop()] as [string, React.ReactNode]] : []),
    ...(p.category ? [["Set category", p.category] as [string, React.ReactNode]] : []),
    ...(p.note ? [["Set memo", p.note] as [string, React.ReactNode]] : []),
  ];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {lines.map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
    </div>
  );
}

export default async function Approvals() {
  const [f, view] = await Promise.all([getFloor(), getApprovals()]);
  const controls = controlsOn();
  const blocker = !controls ? "DASHBOARD_CONTROLS is off" : writeBlocker();
  const quinnOn = !!f.agents.bookkeeper?.enabled;
  const live = !blocker && quinnOn;

  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        <h1 className="h1" style={{ flex: 1 }}>Approvals</h1>
        <ActionButton className="btn ghost sm" action={queueQuinn} title="Turns Quinn’s saved proposals into approvals. Writes nothing to Mercury.">Check for Quinn’s proposals</ActionButton>
      </div>

      <div className="card" style={{ gap: 8, borderLeft: `4px solid ${live ? "var(--mint)" : "var(--yel)"}` }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{live ? "Approving writes to Mercury right away." : "Approving records your decision. Nothing is written to Mercury yet."}</span>
        <span style={{ fontSize: 13, lineHeight: 1.55 }} className="ink2">
          The gateway only ever writes a receipt, a category and a memo on a charge that already exists. Before each write it re-checks the charge in Mercury, and it never replaces a category, memo or attachment that’s already there.
          {!live && <> Waiting on: {[blocker, !quinnOn && "Quinn is off duty (turn on at launch)"].filter(Boolean).join(", ")}. Approved items stay approved and go out once these are in place.</>}
          {" "}Items older than {view?.staleHours ?? 72} hours expire unreviewed.
        </span>
      </div>

      {!view ? (
        <Empty title="The approvals tables aren’t there yet">Apply the gateway migration (supabase/migrations/20261110120000_gateway.sql) to the one-two-agents Supabase project.</Empty>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="card-t">Waiting on you ({view.pending.length})</span>
            {view.pending.length > 1 && (
              <ActionButton className="btn primary sm" action={approveAll.bind(null, view.pending.map((i) => i.id))}
                confirm={{ title: `Approve all ${view.pending.length}?`, body: live ? "Each change is re-checked against Mercury, then written: receipt, category and memo only." : "Your approvals are recorded. Nothing goes to Mercury until the write token, controls and Quinn are on.", lines: [{ k: "Changes", v: String(view.pending.length) }], confirmLabel: "Approve all" }}>
                Approve all {view.pending.length}
              </ActionButton>
            )}
          </div>
          {!view.pending.length && <Empty title="Nothing waiting on you.">Quinn’s matched receipts and category suggestions land here, one card per charge, after each real run.</Empty>}
          {view.pending.map((i) => {
            const a = BY_ID[i.agent_id];
            return (
              <div key={i.id} className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, padding: 22 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="row">{a && <Avatar a={a} size={32} />}<span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{a?.name ?? i.agent_id} · Mercury change</span><span className="muted" style={{ fontSize: 12 }}>{when(i.created_at)}</span></div>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{i.title}</span>
                  {i.reasoning && <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">{i.reasoning}</span>}
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    <ActionButton className="btn primary" action={approve.bind(null, i.id)}>Approve</ActionButton>
                    <ActionButton className="btn ghost" action={reject.bind(null, i.id)}>Reject</ActionButton>
                  </div>
                </div>
                <Change i={i} />
              </div>
            );
          })}

          {view.waiting.length > 0 && (
            <div className="card" style={{ gap: 10 }}>
              <div className="card-h">
                <span className="card-t">Approved, not in Mercury yet ({view.waiting.length})</span>
                <ActionButton className="btn dark sm" disabled={!!blocker} title={blocker ?? undefined} action={applyWaiting}
                  confirm={{ title: "Apply approved changes?", body: "Each one is re-checked against Mercury first. Runs as Quinn, so it’s skipped while Quinn is off duty.", confirmLabel: "Apply now" }}>Apply now</ActionButton>
              </div>
              {view.waiting.map((i) => (
                <div key={i.id} className="row rule wrap" style={{ gap: 12, padding: "10px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{i.title}{i.action_reason && <span className="muted"> · {i.action_reason}</span>}</span>
                  <Tag s={i.action_status} />
                  {i.action_status === "failed" && <ActionButton className="btn ghost xs" disabled={!!blocker} action={retryAction.bind(null, i.action_id)}>Retry</ActionButton>}
                </div>
              ))}
            </div>
          )}

          {view.decided.length > 0 && (
            <div className="card" style={{ gap: 4 }}>
              <span className="card-t" style={{ marginBottom: 6 }}>Decided</span>
              {view.decided.map((i) => (
                <div key={i.id} className="row rule wrap" style={{ gap: 12, padding: "10px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{i.title}{i.action_reason && <span className="muted"> · {i.action_reason}</span>}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{i.decided_at ? when(i.decided_at) : ""}</span>
                  <Tag s={i.status === "expired" ? "expired" : i.action_status} />
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ gap: 4 }}>
            <div className="card-h" style={{ marginBottom: 6 }}><span className="card-t">Gateway log</span><span className="sub">Every write an agent asked for, allowed or refused</span></div>
            {!view.log.length && <span className="muted" style={{ fontSize: 13 }}>No actions yet.</span>}
            {view.log.map((g) => (
              <div key={g.id} className="row rule wrap" style={{ gap: 12, padding: "9px 0", fontSize: 12.5 }}>
                <span style={{ width: 110 }} className="muted">{when(g.created_at)}</span>
                <span style={{ width: 70 }}>{BY_ID[g.agent_id]?.name ?? g.agent_id}</span>
                <span style={{ flex: 1, minWidth: 180 }}><code>{g.tool}</code> · {g.action_type}{g.reason && <span className="muted"> · {g.reason}</span>}</span>
                <Tag s={g.status} />
                {g.exec_run_id && <Link href={`/runs/${g.exec_run_id}`} style={{ fontSize: 12 }}>run</Link>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
