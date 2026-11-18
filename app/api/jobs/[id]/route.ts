import { NextResponse, after } from "next/server";
import { runChainStep } from "@/core/chain";
import { isUuid, readChainPayload } from "@/core/job-rules";
import { claimJob, finishJob, type Job } from "@/core/jobs";
import { cronAuthorized } from "@/core/runs";
import { withOrg } from "@/core/tenancy";
import { traced } from "@/core/trace";

export const maxDuration = 300;

// The worker (docs/tenancy.md, slice 3): runs one job as its org. Called by a kick (core/jobs.ts)
// with the CRON_SECRET bearer and ?org=<org>. Everything here runs as that org, so the job is read
// through db() scoped to it, and with the database lock on, with that org's token: a job of another
// org can't be claimed whatever the request says. It claims the job, answers, then does the work
// after the answer, in this request's own time limit.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = (await params).id, org = url.searchParams.get("org");
  if (!isUuid(id) || !isUuid(org)) return NextResponse.json({ error: "Bad job" }, { status: 400 });
  const origin = url.origin;
  return withOrg(org, async () => {
    let job: Job | null;
    try { job = await claimJob(id); }
    catch (e) { console.error(`[jobs] ${id} claim`, e); return NextResponse.json({ error: "Job can't be read" }, { status: 500 }); }
    if (!job) return NextResponse.json({ status: "skipped", summary: "That job isn't waiting, or isn't due yet." });
    const claimed = job;
    after(() => withOrg(org, () => runJob(origin, claimed)));
    return NextResponse.json({ status: "started" }, { status: 202 });
  });
}

async function runJob(origin: string, job: Job): Promise<void> {
  return traced("job", { "operator.job": job.id, "operator.job_kind": job.kind }, () => doJob(origin, job));
}

async function doJob(origin: string, job: Job): Promise<void> {
  try {
    if (job.kind !== "chain_step") return await finishJob(job.id, { failed: true, outcome: `Unknown kind ${job.kind}.` });
    const ctx = readChainPayload(job.payload);
    if (!ctx) return await finishJob(job.id, { failed: true, outcome: "Bad chain step payload." });
    await finishJob(job.id, await runChainStep(origin, ctx));
  } catch (e) {
    console.error(`[jobs] ${job.id}`, e);
    await finishJob(job.id, { failed: true, outcome: e instanceof Error ? e.message : String(e) }).catch((x) => console.error(`[jobs] ${job.id} finish`, x));
  }
}
