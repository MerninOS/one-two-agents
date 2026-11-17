import { NextResponse } from "next/server";
import { resolveAgent } from "@/agents/registry";
import { cronAuthorized, withRun } from "@/core/runs";

export const maxDuration = 300;

// One entry point for every agent. Vercel Schedules (vercel.json) call it with the CRON_SECRET bearer;
// a manual run adds ?trigger=manual. ?dryRun=1 reads real data but writes nothing
// (no agent_runs row, no Supabase, Notion or Gmail writes) and calls no model.
// Chain steps don't come here: each is a job run by /api/jobs (core/chain.ts, docs/tenancy.md slice 3).
export async function GET(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let found;
  try { found = await resolveAgent((await params).agent); }
  catch (e) { return NextResponse.json({ error: `Agents can't be read: ${e instanceof Error ? e.message : e}` }, { status: 500 }); }
  if (!found) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const { id, job, manualOnly } = found;
  const url = new URL(req.url);
  const asked = url.searchParams.get("trigger");
  if (asked === "chain") return NextResponse.json({ error: "Chain steps run as jobs (/api/jobs)." }, { status: 400 });
  const trigger = asked === "manual" ? "manual" : "cron";
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");

  // Manual-only agents have no schedule; refuse anything that isn't an explicit manual run.
  if (manualOnly && !dryRun && trigger !== "manual") {
    return NextResponse.json({ status: "skipped", summary: "This agent runs only by hand: add ?trigger=manual." });
  }
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await job({ dryRun })) });
    return NextResponse.json(await withRun(id, trigger, (runId, memory) => job({ runId, memory })));
  } catch (e) {
    console.error(`[agents/${id}]`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
