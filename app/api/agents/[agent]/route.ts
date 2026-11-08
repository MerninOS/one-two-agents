import { NextResponse } from "next/server";
import { resolveAgent } from "@/agents/registry";
import { cronAuthorized, withRun } from "@/core/runs";

export const maxDuration = 300;

// One entry point for every agent. Vercel Cron calls it with the CRON_SECRET bearer;
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

  // Manual-only agents are scheduled for Feb 29 14:00 UTC in vercel.json so Vercel keeps a Run
  // button for them; that one firing is skipped. (Run-button presses look like cron calls too,
  // so the time is the only way to tell them apart.)
  const now = new Date();
  const leapFiring = now.getUTCMonth() === 1 && now.getUTCDate() === 29 && now.getUTCHours() === 14 && now.getUTCMinutes() < 10;
  if (def.manualOnly && !dryRun && leapFiring) {
    return NextResponse.json({ status: "skipped", summary: "Scheduled firing skipped: this agent runs only by hand." });
  }
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await def.job({ dryRun })) });
    return NextResponse.json(await withRun(id, trigger, (runId) => def.job({ runId })));
  } catch (e) {
    console.error(`[agents/${id}]`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
