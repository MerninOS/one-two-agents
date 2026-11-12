import { previewChain, rollBackFlow, runChainNow, saveCrewFlow } from "@/dashboard/actions";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";

// Preview dry-runs up to three agents in a row.
export const maxDuration = 300;

export default async function Crew() {
  const f = await getFloor();
  const d = await getCrewCanvas(f);
  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        <h1 className="h1" style={{ flex: 1 }}>Crew canvas</h1>
      </div>
      <div className="card" style={{ gap: 6, borderLeft: "4px solid var(--acc)" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Which agents run when, and who goes next.</span>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          A chain never turns an agent on. Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
      </div>
      <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
    </>
  );
}
