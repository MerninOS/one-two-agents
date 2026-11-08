import { NextResponse } from "next/server";
import { resolveAgent } from "@/agents/registry";
import { cronAuthorized, withRun } from "@/core/runs";

export const maxDuration = 300;

// One entry point for every agent. Vercel Schedules (vercel.json) call it with the CRON_SECRET bearer;
// a manual run adds ?trigger=manual. ?dryRun=1 reads real data but writes nothing
// (no agent_runs row, no Supabase, Notion or Gmail writes) and calls no model.
export async function GET(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const found = resolveAgent((await params).agent);
  if (!found) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const { id, def } = found;
  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");

  // Manual-only agents have no schedule; refuse anything that isn't an explicit manual run.
  if (def.manualOnly && !dryRun && trigger !== "manual") {
    return NextResponse.json({ status: "skipped", summary: "This agent runs only by hand: add ?trigger=manual." });
  }
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await def.job({ dryRun })) });
    return NextResponse.json(await withRun(id, trigger, (runId) => def.job({ runId })));
  } catch (e) {
    console.error(`[agents/${id}]`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
