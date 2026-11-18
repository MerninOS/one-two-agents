// One Two's own checks: its crew installs cleanly, its planned seats show on the roster, and Avery's
// brief helpers. No database, no network. Run: npm run check:pack-one-two
import assert from "node:assert/strict";
import { crewProblems, installRows } from "../../core/install-rules";
import { readSpec } from "../../core/agent-spec";
import { buildCrew } from "../../dashboard/roster";
import { ONE_TWO_CREW as crew } from "./crew";
import { ONE_TWO_PLANNED as PLANNED } from "./planned";
import { parseJudgment } from "./agents/chief-of-staff";
import { deptLine, replyUrl } from "./agents/chief-of-staff/email";

// the crew installs cleanly, switched off, exactly as written
assert.deepEqual(crewProblems(crew), [], "the One Two pack's crew installs cleanly");
let n = 0;
const rows = installRows("one-two", crew, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
assert.equal(rows.agents.length, crew.agents.length);
assert.ok(rows.agents.every((a) => a.enabled === false), "every agent installs off duty");
assert.ok(rows.agent_defs.every((d) => d.created_by === "template:one-two"));
for (const a of crew.agents) assert.deepEqual(readSpec(crew.specs[a.id], a.id).spec, crew.specs[a.id], `${a.id}'s spec installs as written`);
assert.equal(rows.seats.length, crew.seats.length);

// planned seats: shown until an agent takes the seat
const r = buildCrew([{ ...PLANNED[0], id: "blend_coach", built: true }], PLANNED);
assert.equal(r.planned.some((p) => p.id === "blend_coach"), false);
assert.equal(r.planned.length, PLANNED.length - 1);

// Avery's focus and watch lines from a runner result
assert.deepEqual(parseJudgment("Focus: Reorder Ethiopia Guji. It runs out first.\n- Guji has 9 days left.\n- 2 orders on QC hold.\nsomething else"), { focus: { action: "Reorder Ethiopia Guji", reason: "It runs out first." }, watch: ["Guji has 9 days left.", "2 orders on QC hold."] });
assert.equal(parseJudgment("No focus here"), null);
// department lines have no dash, so they never become watch items; counts come from code
assert.deepEqual(parseJudgment("Focus: Ship it. Now.\n- one\nFinance: Cash is fine.")?.watch, ["one"]);
assert.equal(deptLine({ name: "Finance", goals: ["Runway above 12 months: 14.3 months, at least 12 months, on track."], runs: 3, failed: 0, costUsd: 0.123 }), "Finance: Runway above 12 months: 14.3 months, at least 12 months, on track. 3 runs, all OK, $0.12, in the last 24 hours.");
assert.equal(deptLine({ name: "Sales", goals: [], runs: 0, failed: 0, costUsd: 0 }), "Sales: No goal set. No runs in the last 24 hours.");
assert.equal(deptLine({ name: "Ops", goals: ["A: 1 of 5 won, behind", "B: 2 days, at least 3 days, behind"], runs: 2, failed: 1, costUsd: 0.5 }), "Ops: A: 1 of 5 won, behind; B: 2 days, at least 3 days, behind. 2 runs, 1 failed, $0.50, in the last 24 hours.");

// the brief's "Not right? Tell Avery" link opens the run's reactions, only when both parts are known
const id = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
assert.equal(replyUrl({ dashboardUrl: "https://cr.example", runId: id }), `https://cr.example/runs/${id}#react`);
assert.equal(replyUrl({ dashboardUrl: "https://cr.example" }), undefined);
assert.equal(replyUrl({ runId: id }), undefined);

console.log(`check:pack-one-two ok (${crew.agents.length} agents, ${PLANNED.length} planned seats)`);
