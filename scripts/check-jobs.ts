// The job queue's rules (core/job-rules.ts, docs/tenancy.md slice 3). Run: npm run check:jobs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migration } from "./lib/schema";
import { join } from "node:path";
import { JOB_KINDS, STALE_MS, chainDedupe, chainPayload, isUuid, outcomeText, readChainPayload } from "../core/job-rules";

const C = "0e1a7c4e-0001-4000-8000-0000000000aa", R = "0e1a7c4e-0001-4000-8000-0000000000bb";

// a payload round-trips, and only the chain's own fields survive
assert.deepEqual(readChainPayload(chainPayload({ chainId: C, key: "morning", step: 1, parent: R, manual: true })), { chainId: C, key: "morning", step: 1, parent: R, manual: true });
assert.deepEqual(readChainPayload({ chainId: C, key: "morning", step: 0, agent: "cfo", to: "x@example.com" }), { chainId: C, key: "morning", step: 0 });
assert.deepEqual(chainPayload({ chainId: C, key: "k", step: 0, manual: false }), { chainId: C, key: "k", step: 0 });
// malformed payloads are refused
for (const bad of [null, [], "x", { chainId: "nope", key: "k", step: 0 }, { chainId: C, key: "K Y", step: 0 }, { chainId: C, key: "k", step: 10 },
  { chainId: C, key: "k", step: 1.5 }, { chainId: C, key: "k", step: "1" }, { chainId: C, key: "k", step: 0, parent: "x" }, { chainId: C, key: "k", step: 0, manual: "1" }])
  assert.equal(readChainPayload(bad), null, JSON.stringify(bad));
// one job per step of a chain
assert.equal(chainDedupe({ chainId: C, step: 2 }), `chain:${C}:2`);
assert.ok(chainDedupe({ chainId: C, step: 2 }).length <= 200);
assert.ok(isUuid(C) && !isUuid("x") && !isUuid(undefined));
assert.equal(outcomeText("x".repeat(2000)).length, 1000);
// a claimed job is only called stale after a worker's limit (300 s) has surely passed
const worker = readFileSync(join(process.cwd(), "app/api/jobs/[id]/route.ts"), "utf8");
const limit = Number(/maxDuration = (\d+)/.exec(worker)?.[1]);
assert.ok(limit > 0 && STALE_MS > limit * 1000, "STALE_MS is longer than the worker's maxDuration");

// the table allows exactly the kinds the code knows, and holds each job to its org
const sql = migration("20261205090000_jobs.sql"); // check:baseline checks the kinds in the public repo
if (sql) {
  const kinds = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(kinds, [...JOB_KINDS]);
  assert.match(sql, /unique \(org_id, dedupe_key\)/);
  assert.match(sql, /create policy org_rows on jobs/);
}

// chain steps reach agents only as jobs: the agent route refuses trigger=chain, and nothing calls it for a step
const agentRoute = readFileSync(join(process.cwd(), "app/api/agents/[agent]/route.ts"), "utf8");
assert.match(agentRoute, /asked === "chain"\) return NextResponse\.json\(\{ error/);
assert.doesNotMatch(readFileSync(join(process.cwd(), "core/chain.ts"), "utf8"), /\/api\/agents/);

console.log(`check:jobs ok (${JOB_KINDS.length} kind)`);
