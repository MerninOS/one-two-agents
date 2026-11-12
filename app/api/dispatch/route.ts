import { NextResponse, after } from "next/server";
import { AGENTS } from "@/agents/registry";
import { claimDueWaits, claimFiring, startStep } from "@/core/chain";
import { firingsBetween, loadFlow } from "@/core/flow";
import { cronAuthorized } from "@/core/runs";

export const maxDuration = 300;

// The one Vercel Schedule (vercel.json "dispatch", every 15 minutes). It starts the chains
// whose schedule came due in the last hour (each firing once: chain_fires) and the waiting
// steps whose "not before" time has come (chain_waits). Each step is its own request to
// /api/agents/<id>, so it runs through withRun like any other run: an agent that is off duty
// is skipped and its chain stops. With every chain off, this does nothing at all.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = new URL(req.url).origin;
  const now = Date.now();
  const started: string[] = [];
  let flow;
  try { flow = await loadFlow(Object.keys(AGENTS)); }
  catch (e) { return NextResponse.json({ error: `Crew flow can't be read: ${e instanceof Error ? e.message : e}` }, { status: 500 }); }

  for (const c of flow.flow.chains) {
    if (!c.on) continue;
    // an hour back, so a late or missed call still catches the firing
    for (const at of firingsBetween(c, now - 60 * 6e4, now)) {
      const chainId = crypto.randomUUID();
      if (!(await claimFiring(c.key, at, chainId))) continue;
      started.push(`${c.name} (${new Date(at).toISOString()})`);
      after(() => startStep(origin, c, { chainId, key: c.key, step: 0 }));
    }
  }
  for (const w of await claimDueWaits(now)) {
    const c = flow.flow.chains.find((x) => x.key === w.key);
    // the waiting step goes ahead only if the chain is still on and still has that step
    if (!c || !c.steps[w.step] || (!c.on && !w.manual)) continue;
    started.push(`${c.name} step ${w.step + 1}`);
    after(() => startStep(origin, c, { chainId: w.chainId, key: w.key, step: w.step, parent: w.parent ?? undefined, manual: w.manual }));
  }
  return NextResponse.json({ started, problems: flow.problems });
}
