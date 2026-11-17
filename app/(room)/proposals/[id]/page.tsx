import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/dashboard/data";
import { proposalAccept, proposalDecline } from "@/dashboard/proposalActions";
import { ActionButton } from "@/dashboard/components/client";
import { NotNowButton } from "@/dashboard/components/proposals";
import { when } from "@/dashboard/format";
import { getProposal, proposalChecks, toolLabel, type Proposal } from "@/core/proposals";
import { BRAINS, HIRE_STEPS, KIND_WORDS } from "@/core/proposal-rules";
import { agentNames, agentsIn, deptSpent, loadOrg, monthSpendByAgent } from "@/core/org";

// One proposal (docs/company-mode.md, slice 3, the Hire artboard): who asked and why, what it
// holds, what a yes does, what code checks again at the tap, and Yes / Change it first / Not now.

const usd = (n: number) => `$${n.toFixed(2)}`;

function Lines({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => (
        <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "9px 0", fontSize: 13 }}>
          <span className="muted" style={{ flexShrink: 0 }}>{k}</span>
          <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function yesDoes(p: Proposal["payload"]): { label: string; does: string } {
  switch (p.kind) {
    case "hire": return { label: `Hire ${p.name}, off duty`, does: `Creates ${p.name} as v1, off duty, with only the read tools above, ${p.seatId ? `in the open ${p.seat} seat` : `in a new ${p.seat} seat`}. Nothing runs until you Try it and Go live.` };
    case "grant_tool": return { label: `Give ${p.agent} ${toolLabel(p.tool)}`, does: `Saves a draft version of ${p.agent} with ${toolLabel(p.tool)} added. What runs today doesn’t change until you Try it and Go live.` };
    case "new_tool": return { label: "Find a tool for it", does: "Opens Find a tool, where you pick how: a connection you already have, a server you add by its address, or an ask for a built-in connector. Nothing is granted to anyone until you do it on the builder’s Tools step." };
    case "retire": return p.agentId
      ? { label: `Retire ${p.agent}`, does: `Takes ${p.agent} off duty and opens its seat. Its versions, runs and memory stay, and you can turn it back on.` }
      : { label: `Close the ${p.seat} seat`, does: `Removes the empty ${p.seat} seat from the chart.` };
  }
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const [pr, org] = await Promise.all([getProposal(id), loadOrg().catch(() => null)]);
  if (!pr || !org) notFound();
  const p = pr.payload;
  const members = pr.department_id ? agentsIn(org, pr.department_id) : [];
  const [names, spend, checks] = await Promise.all([
    agentNames([...(pr.from_agent ? [pr.from_agent] : []), ...members]).catch(() => ({} as Record<string, string>)),
    monthSpendByAgent(members).catch(() => ({} as Record<string, number>)),
    pr.state === "pending" ? proposalChecks(pr, org).catch((e) => [{ ok: false, text: e instanceof Error ? e.message : String(e) }]) : Promise.resolve([]),
  ]);
  const dept = org.departments.find((d) => d.id === pr.department_id) ?? null;
  const fromName = pr.from_agent ? names[pr.from_agent] ?? pr.from_agent : pr.source === "claude" ? "Claude" : "You";
  const yes = yesDoes(p);
  const blocked = checks.some((c) => !c.ok);

  const detail: [string, React.ReactNode][] =
    p.kind === "hire" ? [
      ["Seat", p.seatId ? `${p.seat} (open)` : `${p.seat} (new)`],
      ["Job", p.job],
      ["Each run", p.eachRun],
      ["Good result", p.goodResult],
      ["Brain", BRAINS[p.brain].label],
      ["Reads", p.tools.map(toolLabel).join(", ")],
      ["Hands you", `A ${p.seat} result each run, up to ${HIRE_STEPS} steps`],
    ]
    : p.kind === "grant_tool" ? [["Teammate", p.agent], ["Tool", toolLabel(p.tool)]]
    : p.kind === "new_tool" ? [["What it reads", p.what]]
    : [[p.agentId ? "Agent" : "Seat", p.agent ?? p.seat ?? ""]];

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="sub"><Link href="/approvals">Approvals</Link> › <Link href="/proposals">Proposals</Link> › {KIND_WORDS[pr.kind]}</span>
        <span className="sub">From {fromName}{dept ? ` · ${dept.name}` : ""} · {when(pr.created_at)}{pr.state !== "pending" && pr.decided_at ? ` · decided ${when(pr.decided_at)}` : ""}</span>
        <h1 className="h1">{pr.title}</h1>
      </div>

      <div className="card" style={{ gap: 10, borderLeft: "4px solid var(--acc)" }}>
        <span className="ted-k">Why · {fromName}’s words</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{pr.why}</span>
      </div>

      <div className="home-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">{p.kind === "hire" ? "The job" : "What it asks"}</span>
          <Lines rows={detail} />
        </div>
        <div className="card" style={{ gap: 12 }}>
          {pr.state === "pending" ? (
            <>
              <span className="card-t">What your yes does</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{yes.does}</span>
              {p.kind === "hire" && (
                <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  A run costs at most {usd(BRAINS[p.brain].maxCostUsd)}.{dept ? ` ${dept.name} has spent ${usd(deptSpent(org, dept.id, spend))} on AI this month${dept.monthlyBudgetUsd != null ? ` of ${usd(dept.monthlyBudgetUsd)}` : ""}.` : ""}
                </span>
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <ActionButton className="btn primary" disabled={blocked} title={blocked ? "A check below failed. Change it first, or say not now." : undefined} action={proposalAccept.bind(null, pr.id)} follow={p.kind === "new_tool"}
                  confirm={{ title: `${yes.label}?`, body: yes.does, confirmLabel: yes.label, kind: "primary" }}>{yes.label}</ActionButton>
                {p.kind === "hire" && <Link className="btn outline" href={`/build/new?proposal=${pr.id}`}>Change it first</Link>}
                <NotNowButton decline={proposalDecline.bind(null, pr.id)} headName={pr.from_agent ? fromName : null} />
              </div>
              <span className="card-t" style={{ marginTop: 6 }}>Checked in code</span>
              <div className="stack" style={{ gap: 6 }}>
                {checks.map((c) => <span key={c.text} className="row" style={{ gap: 8, fontSize: 13, alignItems: "flex-start" }}><span aria-hidden style={{ color: c.ok ? "var(--mint)" : "var(--red)", fontWeight: 700 }}>{c.ok ? "✓" : "✕"}</span><span>{c.text}</span></span>)}
              </div>
              <span className="muted" style={{ fontSize: 11.5 }}>Checked again when you tap, against the chart and the tool list as they are then.</span>
            </>
          ) : (
            <>
              <span className="card-t">Decided</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{pr.outcome ?? pr.state}</span>
              {pr.kind === "new_tool" && pr.state === "accepted" && <Link href={`/connections/find?for=${pr.id}`}>Find a tool for it ›</Link>}
              {pr.result_ref && pr.kind !== "new_tool" && <Link href={pr.kind === "retire" ? `/agents/${pr.result_ref}` : `/build/${pr.result_ref}`}>Open {names[pr.result_ref] ?? "the agent"} ›</Link>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
