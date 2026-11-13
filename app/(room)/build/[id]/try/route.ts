// How a try is going, for the agent map to play it (docs/builder-flow.md, slice 4). The page polls
// this while Try it runs: the newest try of this agent started since `since`, with the steps saved
// so far. Read-only; the Control Room login guards it like every page.
import { cookies } from "next/headers";
import { db } from "@/core/db";
import { SESSION_COOKIE, validSessionToken } from "@/dashboard/session";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!validSessionToken((await cookies()).get(SESSION_COOKIE)?.value)) return Response.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  const since = new Date(new URL(req.url).searchParams.get("since") ?? "");
  if (!/^[a-z0-9_]{1,60}$/.test(id) || Number.isNaN(since.getTime())) return Response.json({ error: "Bad request." }, { status: 400 });
  const { data: run, error } = await db().from("agent_runs").select("id, status, cost_usd, tokens_in, tokens_out").eq("agent_id", id).eq("trigger", "preview").gte("started_at", since.toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!run) return Response.json({ run: null }, { headers: { "cache-control": "no-store" } });
  const { data: steps } = await db().from("run_steps").select("kind, tool, ok, ms").eq("run_id", run.id).order("idx");
  return Response.json({
    run: { id: run.id, status: run.status, costUsd: Number(run.cost_usd ?? 0), tokensIn: Number(run.tokens_in ?? 0), tokensOut: Number(run.tokens_out ?? 0), steps: (steps ?? []).map((s) => ({ kind: s.kind, tool: s.tool, ok: !!s.ok, ms: Number(s.ms ?? 0) })) },
  }, { headers: { "cache-control": "no-store" } });
}
