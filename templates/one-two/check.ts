// One Two's own checks: its crew installs cleanly, its planned seats show on the roster, and Avery's
// brief helpers. No database, no network. Run: npm run check:pack-one-two
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { crewProblems, installRows } from "../../core/install-rules";
import { readSpec } from "../../core/agent-spec";
import { buildCrew } from "../../dashboard/roster";
import { ONE_TWO_CREW as crew } from "./crew";
import { ONE_TWO_PLANNED as PLANNED } from "./planned";
import { parseJudgment } from "./agents/chief-of-staff";
import { deptLine, replyUrl } from "./agents/chief-of-staff/email";
import { MEASURES, planGoal, progress, type GoalRow } from "../../core/goal-rules";
import { MCP_SERVERS } from "../../core/mcp-rules";
import { SHOPIFY_TOOLS, assertReadOnly, shopifyVariables } from "../../core/shopify-queries";
import { ONE_TWO_SHOPIFY } from "./shopify/queries";
import { ONE_TWO_MEASURE_DEFS } from "./measure-defs";

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

// the storefront reads: served by our Shopify server, read-only, no customer details, no caller writes the search
for (const q of ONE_TWO_SHOPIFY) {
  assert.ok(SHOPIFY_TOOLS.includes(q.tool) && (MCP_SERVERS.shopify.readTools as readonly string[]).includes(q.tool), `${q.tool} is on the Shopify profile`);
  assert.doesNotThrow(() => assertReadOnly(q.doc), q.tool);
  assert.ok(!/\b(email|phone|address|firstName|lastName|displayName)\b/.test(q.doc), `${q.tool} reads no customer details`);
}
const ctx = { stockCollection: "", productCollections: [], productFields: [] };
assert.deepEqual(shopifyVariables("shopify_green_lots", { query: "status:any" }, ctx), { tool: "shopify_green_lots", doc: ONE_TWO_SHOPIFY[0].doc, variables: { query: "tag:blended-green AND -status:archived" } }, "a caller never writes the search");
const stock = shopifyVariables("shopify_stock_coffees", { handle: "secret-drops" }, ctx);
assert.ok(!("problem" in stock) && stock.variables.handle === "our-coffees", "the collection comes from settings");
const stock2 = shopifyVariables("shopify_stock_coffees", {}, { ...ctx, stockCollection: "fall-coffees" });
assert.ok(!("problem" in stock2) && stock2.variables.handle === "fall-coffees");
const board = shopifyVariables("shopify_board_orders", { since: "2026-08-18" }, ctx);
assert.ok(!("problem" in board) && board.variables.query === "tag:blended created_at:>=2026-08-18" && board.variables.after === null);
const green = shopifyVariables("shopify_green_orders_between", { start: "2026-11-15", end: "2026-11-16" }, ctx);
assert.ok(!("problem" in green) && /created_at:>='2026-11-15T00:00:00-06:00'/.test(String(green.variables.query)));
for (const [tool, args, why] of [
  ["shopify_recent_orders", { since: "2026-11-01 OR tag:x" }, /since/],
  ["shopify_board_orders", { since: "2026-11-01", after: "x' OR '1" }, /after/],
  ["shopify_green_orders_between", { start: "2026-11-16", end: "2026-11-15" }, /end after start/],
] as const) { const r = shopifyVariables(tool, args, ctx); assert.ok("problem" in r && why.test(r.problem), tool); }

// the green-cover goal: listed in the picker, a floor in days
for (const m of ONE_TWO_MEASURE_DEFS) assert.ok(MEASURES.some((x) => x.key === m.key), `${m.key} is in the goal picker`);
assert.ok("plan" in planGoal({ title: "Never run out", measure: "lowest_cover_days", target: 45 }, "2026-11-18"));
const cover: GoalRow = { measure: "lowest_cover_days", target: 45, start_value: null, due_on: null, state: "active", paced_from: "2026-11-01T18:00:00Z" };
assert.equal(progress(cover, { value: 62 }, "2026-11-18").status, "on_track");
const behind = progress(cover, { value: 40 }, "2026-11-18");
assert.deepEqual([behind.status, behind.line], ["behind", "40 days, at least 45 days"]);

// card 132: Rowan's offer is core's Product facts; the pack keeps no offer of its own
assert.ok(!existsSync("templates/one-two/agents/wholesale-hunter"), "the pack's wholesale offer is gone");
for (const f of ["templates/one-two/tools.ts", "templates/one-two/crew.json", "templates/one-two/domain/coffee.ts"]) {
  assert.ok(!/wholesale_offer|PL_MIN|PL_BAGS|PL_PACK|wholesaleOf/.test(readFileSync(f, "utf8")), `${f} keeps no offer of its own`);
}
console.log(`check:pack-one-two ok (${crew.agents.length} agents, ${PLANNED.length} planned seats)`);

