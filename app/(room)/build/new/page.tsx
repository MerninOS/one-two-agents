import { createBuilt } from "@/dashboard/actions";
import { builderMenu, listBuilt, listOthers, listTemplates } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { Flow } from "@/dashboard/components/Flow";
import { seatChoices } from "@/dashboard/org";
import { loadOrg } from "@/core/org";

// New agent: the builder flow with nothing saved yet (docs/builder-flow.md, slice 2). Its last step
// creates the agent, off duty, as v1, in the seat picked in step 1 (docs/org-chart.md).

export default async function NewAgent({ searchParams }: { searchParams: Promise<{ step?: string; seat?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [templates, others, built, org] = await Promise.all([listTemplates(), listOthers(), listBuilt(), loadOrg()]);
  // opened from an open seat on the org chart: that seat is picked, and its name fills in the job line
  const seats = org ? seatChoices(org, null).filter((x) => x.free) : undefined;
  const seat = org?.seats.find((x) => x.id === sp.seat && x.holder === "open") ?? null;
  if (built == null) return <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>;
  return (
    <Flow
      agentId={null}
      saved={null}
      nextVersion={1}
      menu={builderMenu()}
      step={sp.step}
      controls={controlsOn()}
      templates={templates}
      others={others}
      create={createBuilt}
      seats={seats}
      seatId={seat?.id ?? null}
      seed={seat ? { mandate: [seat.title, seat.sub].filter(Boolean).join(": ").slice(0, 200) } : undefined}
    />
  );
}
