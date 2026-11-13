import { createBuilt } from "@/dashboard/actions";
import { builderMenu, listBuilt, listOthers, listTemplates } from "@/dashboard/builder";
import { requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { Flow } from "@/dashboard/components/Flow";

// New agent: the builder flow with nothing saved yet (docs/builder-flow.md, slice 2). Its last step
// creates the agent, off duty, as v1.

export default async function NewAgent({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  await requireSession();
  const [templates, others, built] = await Promise.all([listTemplates(), listOthers(), listBuilt()]);
  if (built == null) return <div className="card"><span className="sub">The runner migration (20261113120000_agent_builder_runner.sql) isn’t applied yet.</span></div>;
  return (
    <Flow
      agentId={null}
      saved={null}
      nextVersion={1}
      menu={builderMenu()}
      step={(await searchParams).step}
      controls={controlsOn()}
      templates={templates}
      others={others}
      create={createBuilt}
    />
  );
}
