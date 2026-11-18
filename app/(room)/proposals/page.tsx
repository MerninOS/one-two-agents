import Link from "next/link";
import { requireSession } from "@/dashboard/data";
import { Empty } from "@/dashboard/components/ui";
import { when } from "@/dashboard/format";
import { PROPOSALS_MISSING, listProposals, type Proposal } from "@/core/proposals";
import { KIND_WORDS } from "@/core/proposal-rules";
import { agentNames, loadOrg } from "@/core/org";

// Proposals (docs/company-mode.md, slice 3): what heads handed the owner to decide and what was decided
// lately. Each opens its own page to decide. A yes on a new tool opens Find a tool, where asks for
// connectors are counted (docs/custom-servers.md, slice 3).

export default async function Proposals() {
  await requireSession();
  const [list, org] = await Promise.all([listProposals(["pending", "accepted", "declined", "built", "failed"], 80), loadOrg().catch(() => null)]);
  if (!list) return <Empty title="Proposals aren’t set up yet">{PROPOSALS_MISSING}</Empty>;
  const names = await agentNames([...new Set(list.map((p) => p.from_agent).filter((x): x is string => !!x))]).catch(() => ({} as Record<string, string>));
  const dept = (id: string | null) => org?.departments.find((d) => d.id === id)?.name ?? null;
  const from = (p: Proposal) => (p.from_agent ? names[p.from_agent] ?? p.from_agent : p.source === "claude" ? "Claude" : "You");
  const pending = list.filter((p) => p.state === "pending");
  const decided = list.filter((p) => p.state !== "pending").slice(0, 20);

  const row = (p: Proposal) => (
    <Link key={p.id} href={`/proposals/${p.id}`} className="card" style={{ gap: 6, textDecoration: "none", color: "inherit" }}>
      <span className="row wrap" style={{ gap: 8 }}>
        <span className="ted-k" style={{ flex: 1 }}>{KIND_WORDS[p.kind]} · from {from(p)}{dept(p.department_id) ? ` · ${dept(p.department_id)}` : ""}</span>
        <span className="muted" style={{ fontSize: 12 }}>{when(p.created_at)}</span>
      </span>
      <b style={{ fontSize: 16, fontWeight: 600 }}>{p.title}</b>
      <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>{p.state === "pending" ? p.why : p.outcome ?? p.why}</span>
    </Link>
  );

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="sub"><Link href="/approvals">Approvals</Link> › Proposals</span>
        <h1 className="h1">Proposals</h1>
        <span className="sub">Your heads hand you these at the end of a run. Nothing in one happens until you say yes, and a yes never hands out an action: a hire starts off duty, a tool waits for Try it and Go live, and a new tool opens Find a tool.</span>
      </div>

      <span className="card-t">Waiting on you</span>
      {pending.length ? pending.map(row) : <Empty title="Nothing waiting">When a head sees a gap, its proposal shows here and in Needs you.</Empty>}

      <Link href="/connections/find#requests" className="card row" style={{ gap: 10, textDecoration: "none", color: "inherit" }}>
        <span style={{ flex: 1, fontSize: 13.5 }}>Tools asked for, and how many times, are on Find a tool.</span>
        <span className="muted">›</span>
      </Link>

      {decided.length > 0 && (
        <>
          <span className="card-t">Decided lately</span>
          {decided.map(row)}
        </>
      )}
    </>
  );
}
