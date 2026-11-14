import Link from "next/link";
import { applyWaiting, approve, approveAll, queueQuinn, reject, retryAction } from "@/dashboard/actions";
import { BY_ID } from "@/dashboard/crew";
import { getApprovals, getFloor, type ApprovalItem, type ApprovalsView } from "@/dashboard/data";
import { m2, md, when } from "@/dashboard/format";
import { controlsOn } from "@/dashboard/session";
import { ActionButton, RejectButton } from "@/dashboard/components/client";
import { Avatar, Empty } from "@/dashboard/components/ui";
import { DRAFT_EMAIL, writeBlocker } from "@/core/gateway";

// Applying a batch calls Mercury once or twice per change.
export const maxDuration = 300;

const ACTION_LOOK: Record<string, [string, string]> = {
  proposed: ["Waiting on you", "var(--yel)"], approved: ["Approved, not applied", "var(--acc)"], executing: ["Applying", "var(--acc)"],
  applied: ["Applied", "var(--mint)"], partial: ["Partly applied", "var(--mint)"], failed: ["Failed", "var(--red)"],
  rejected: ["Rejected", "var(--mut2)"], expired: ["Expired (stale)", "var(--mut2)"], refused: ["Refused by the gateway", "var(--red)"],
  sent_back: ["Sent back by its lead", "var(--mut2)"],
};
const Tag = ({ s }: { s: string }) => {
  const [l, c] = ACTION_LOOK[s] ?? [s, "var(--mut2)"];
  return <span className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{l}</span>;
};

/** A Gmail draft (Rowan): who it goes to, from the leads list, and the exact words. Approving puts it in Gmail; Zak still sends it there. */
function Draft({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["To", p.to ?? "?"], ["Subject", p.subject ?? "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body ?? ""}</div>
    </div>
  );
}

function Change({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  if (i.tool === DRAFT_EMAIL) return <Draft i={i} />;
  const lines: [string, React.ReactNode][] = [
    p.charge && !p.merchant ? ["Charge", p.charge] : ["Charge", `${p.merchant ?? "?"} · ${p.amount_usd != null ? m2(p.amount_usd) : "?"} · ${p.date ? md(`${p.date}T12:00:00Z`) : "?"}`],
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

/** The department a card's agent sat in, and the lead's check (slice 4): a note, or that it wasn't checked in time. */
function LeadBits({ i, view }: { i: ApprovalItem; view: ApprovalsView }) {
  const lead = i.reviewer_agent_id ? BY_ID[i.reviewer_agent_id]?.name ?? view.names[i.reviewer_agent_id] ?? i.reviewer_agent_id : null;
  if (!lead || !i.review_status) return null;
  if (i.review_status === "waiting") return <span className="sub">{lead} checks this first. It comes to you by {i.review_due ? when(i.review_due) : "tomorrow"}; you can decide it now anyway.</span>;
  if (i.review_status === "skipped") return <span className="sub">{lead} didn’t check this in time, so it came straight to you.</span>;
  if (i.review_status === "noted") return (
    <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, borderLeft: "3px solid var(--acc)" }}>
      <span className="ted-k">{lead}’s note · their words, not an approval</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{i.review_note}</span>
    </div>
  );
  return null;
}

function DeptTag({ i, view }: { i: ApprovalItem; view: ApprovalsView }) {
  const d = view.departments.find((x) => x.id === i.department_id);
  return d ? <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{d.name}</span> : null;
}

export default async function Approvals({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const sp = await searchParams;
  const [f, all] = await Promise.all([getFloor(), getApprovals()]);
  // the department filter: one department, the ones off the chart ("none"), or everything
  const dept = all?.departments.some((d) => d.id === sp.dept) || sp.dept === "none" ? sp.dept : undefined;
  const inDept = (i: ApprovalItem) => !dept || (dept === "none" ? !i.department_id : i.department_id === dept);
  const view = all && { ...all, pending: all.pending.filter(inDept), withLead: all.withLead.filter(inDept), waiting: all.waiting.filter(inDept), decided: all.decided.filter(inDept) };
  const controls = controlsOn();
  const blocker = !controls ? "DASHBOARD_CONTROLS is off" : writeBlocker();
  const quinnOn = !!f.agents.bookkeeper?.enabled;
  const live = !blocker && quinnOn;
  const card = (i: ApprovalItem) => {
    const a = BY_ID[i.agent_id];
    const name = a?.name ?? view?.names[i.agent_id] ?? i.agent_id;
    return (
      <div key={i.id} className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, padding: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row wrap">{a && <Avatar a={a} size={32} />}<span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{name} · {i.tool === DRAFT_EMAIL ? "Gmail draft" : "Mercury change"}</span>{view && <DeptTag i={i} view={view} />}<span className="muted" style={{ fontSize: 12 }}>{when(i.created_at)}</span></div>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{i.title}</span>
          {i.reasoning && <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">{i.reasoning}</span>}
          {view && <LeadBits i={i} view={view} />}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <ActionButton className="btn primary" action={approve.bind(null, i.id)}>Approve</ActionButton>
            <RejectButton reject={reject.bind(null, i.id)} agentName={name} />
          </div>
        </div>
        <Change i={i} />
      </div>
    );
  };

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
          {view.departments.length > 0 && (
            <nav className="seg" aria-label="Department" style={{ flexWrap: "wrap" }}>
              <Link href="/approvals" className={!dept ? "on" : ""} aria-current={!dept ? "page" : undefined}>All</Link>
              {view.departments.map((d) => <Link key={d.id} href={`/approvals?dept=${d.id}`} className={dept === d.id ? "on" : ""} aria-current={dept === d.id ? "page" : undefined}>{d.name}</Link>)}
              <Link href="/approvals?dept=none" className={dept === "none" ? "on" : ""} aria-current={dept === "none" ? "page" : undefined}>Not in a department</Link>
            </nav>
          )}
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="card-t">Waiting on you ({view.pending.length})</span>
            {view.pending.length > 1 && (
              <ActionButton className="btn primary sm" action={approveAll.bind(null, view.pending.map((i) => i.id))}
                confirm={{ title: `Approve all ${view.pending.length}?`, body: live ? "Each change is re-checked against Mercury, then written: receipt, category and memo only." : "Your approvals are recorded. Nothing goes to Mercury until the write token, controls and Quinn are on.", lines: [{ k: "Changes", v: String(view.pending.length) }], confirmLabel: "Approve all" }}>
                Approve all {view.pending.length}
              </ActionButton>
            )}
          </div>
          {!view.pending.length && <Empty title="Nothing waiting on you.">{dept ? "Nothing from this department right now." : "Quinn’s matched receipts and category suggestions land here, one card per charge, after each real run."}</Empty>}
          {view.pending.map(card)}

          {view.withLead.length > 0 && (
            <>
              <div className="stack" style={{ gap: 2 }}>
                <span className="card-t">With the lead first ({view.withLead.length})</span>
                <span className="sub">Departments with “Lead checks drafts first” on. The lead adds a note or sends a draft back once; only your tap approves.</span>
              </div>
              {view.withLead.map(card)}
            </>
          )}

          {view.waiting.length > 0 && (
            <div className="card" style={{ gap: 10 }}>
              <div className="card-h">
                <span className="card-t">Approved, not applied yet ({view.waiting.length})</span>
                <ActionButton className="btn dark sm" disabled={!controls} title={!controls ? "DASHBOARD_CONTROLS is off" : undefined} action={applyWaiting}
                  confirm={{ title: "Apply approved changes?", body: "Each one is checked again first: a Mercury change against Mercury, a Gmail draft against the leads list. Each runs as its agent, so it’s skipped while that agent is off duty.", confirmLabel: "Apply now" }}>Apply now</ActionButton>
              </div>
              {view.waiting.map((i) => (
                <div key={i.id} className="row rule wrap" style={{ gap: 12, padding: "10px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{i.title}{i.action_reason && <span className="muted"> · {i.action_reason}</span>}</span>
                  <Tag s={i.action_status} />
                  {i.action_status === "failed" && <ActionButton className="btn ghost xs" disabled={!controls} action={retryAction.bind(null, i.action_id)}>Retry</ActionButton>}
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
