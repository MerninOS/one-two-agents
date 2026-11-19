import { createBuilt } from "@/dashboard/actions";
import { builderMenu, customMenuFor, listBuilt, listOthers, listTemplates } from "@/dashboard/builder";
import { getFloor, requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { Flow } from "@/dashboard/components/Flow";
import { seatChoices, seatToolChoices } from "@/dashboard/org";
import { loadOrg } from "@/core/org";
import { getProposal, hireDraft } from "@/core/proposals";
import { proposalCreate } from "@/dashboard/proposalActions";

// New agent: the builder flow with nothing saved yet (docs/builder-flow.md, slice 2). Its last step
// creates the agent, off duty, as v1, in the seat picked in step 1 (docs/org-chart.md). Opened from a
// hire proposal (Change it first, docs/company-mode.md slice 3), everything is filled in from it and
// creating the agent says yes to the proposal.

export default async function NewAgent({ searchParams }: { searchParams: Promise<{ step?: string; seat?: string; proposal?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [templates, others, built, org, pr] = await Promise.all([listTemplates(), listOthers(), listBuilt(), loadOrg(), sp.proposal ? getProposal(sp.proposal) : null]);
  const hire = pr?.state === "pending" && pr.payload.kind === "hire" ? pr.payload : null;
  // opened from an open seat on the org chart: that seat is picked, and its name fills in the job line
  const seats = org ? seatChoices(org, null).filter((x) => x.free) : undefined;
  const seat = org?.seats.find((x) => x.id === (hire ? hire.seatId : sp.seat) && x.holder === "open") ?? null;
  const seatBlocks = await seatToolChoices(org);
  const floor = await getFloor();
  if (built == null) return <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>;
  return (
    <Flow
      agentId={null}
      saved={null}
      nextVersion={1}
      menu={builderMenu(floor.crew, floor.health, await customMenuFor())}
      step={sp.step}
      controls={controlsOn()}
      templates={templates}
      others={others}
      create={hire && pr ? proposalCreate.bind(null, pr.id) : createBuilt}
      seats={seats}
      seatBlocks={seatBlocks}
      seatId={seat?.id ?? null}
      seed={hire ? hireDraft(hire).spec : seat ? { mandate: [seat.title, seat.sub].filter(Boolean).join(": ").slice(0, 200) } : undefined}
    />
  );
}
