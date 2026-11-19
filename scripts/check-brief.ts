// The morning brief (core/brief, docs/morning-brief.md): `npm run check:brief`.
// Pure: no database, no network. Numbers are code's; the model writes only the focus and watch list.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { openCounts, parseJudgment, rulesJudgment } from "../core/brief/rules";
import { briefEmail, deptLine, openLine, rateLine, replyUrl, type BriefView, type Kpi } from "../core/brief/email";

// ---- the run's Focus line and watch list
assert.deepEqual(parseJudgment("Focus: Call the two wholesale leads. They asked twice.\n- Cash is below 30 days.\n- 2 orders on hold.\nsomething else"), { focus: { action: "Call the two wholesale leads", reason: "They asked twice." }, watch: ["Cash is below 30 days.", "2 orders on hold."] });
assert.equal(parseJudgment("No focus here"), null);
assert.equal(parseJudgment("Focus:   "), null);
assert.deepEqual(parseJudgment("Focus: Ship it. Now.\n- one\nFinance: Cash is fine.")?.watch, ["one"]);
assert.equal(parseJudgment("focus: x\n- 1\n- 2\n- 3\n- 4\n- 5\n- 6")?.watch.length, 5);

// ---- the fixed rules
const none = rulesJudgment({ behind: [], openOrders: null, agentRuns: [] });
assert.equal(none.focus.action, "Pick one thing that grows the business");
assert.deepEqual(none.watch, []);
const ship = rulesJudgment({ behind: [], openOrders: { unfulfilled: 2, partial: 1, onHold: ["#1001"] }, agentRuns: [] });
assert.equal(ship.focus.action, "Ship the 3 open orders");
assert.deepEqual(ship.watch, ["1 order on hold: #1001."]);
const goals = rulesJudgment({
  behind: [{ title: "Land 5 accounts", line: "1 of 5 won", status: "behind" }, { title: "Runway above 12 months", line: "9.1 months", status: "missed" }],
  openOrders: { unfulfilled: 4, partial: 0, onHold: [] },
  agentRuns: [{ agent_id: "a1", status: "failed", error: "Shopify said no" }, { agent_id: "a2", status: "ok", error: null }],
  names: { a1: "Finn" },
});
assert.equal(goals.focus.action, "Get Runway above 12 months back on track", "a missed date comes first");
assert.deepEqual(goals.watch, ["Runway above 12 months is past its date: 9.1 months.", "Land 5 accounts is behind: 1 of 5 won.", "Finn's run failed: Shopify said no."]);

// ---- open orders by Shopify's own status
const oc = openCounts([
  { name: "#1", displayFulfillmentStatus: "UNFULFILLED" }, { name: "#2", displayFulfillmentStatus: "PARTIALLY_FULFILLED" },
  { name: "#3", displayFulfillmentStatus: "ON_HOLD" }, { name: "#4", displayFulfillmentStatus: "FULFILLED" },
  { name: "#5", displayFulfillmentStatus: "RESTOCKED" }, { name: "#6", displayFulfillmentStatus: "SCHEDULED" },
]);
assert.deepEqual(oc, { unfulfilled: 2, partial: 1, onHold: ["#3"] });
assert.equal(openLine(oc), "Open orders: 2 to ship, 1 partly shipped");
assert.equal(openLine({ unfulfilled: 0, partial: 0, onHold: ["#3"] }), null);
assert.equal(openLine(null), null);

// ---- lines worked out in code
const y: Kpi = { date: "2026-11-18", revenue: 412, orders: 5, aov: 82.4, repeat_rate: 0.3, margin: 0.61, cash_usd: 20000 };
assert.equal(rateLine(y), "Repeat rate 30%, margin 61%");
assert.equal(rateLine({ ...y, margin: null }), "Repeat rate 30%", "no margin without cost of goods");
assert.equal(deptLine({ name: "Finance", goals: ["Runway above 12 months: 14.3 months, at least 12 months, on track."], runs: 3, failed: 0, costUsd: 0.123 }), "Finance: Runway above 12 months: 14.3 months, at least 12 months, on track. 3 runs, all OK, $0.12, in the last 24 hours.");
assert.equal(deptLine({ name: "Sales", goals: [], runs: 0, failed: 0, costUsd: 0 }), "Sales: No goal set. No runs in the last 24 hours.");
assert.equal(deptLine({ name: "Ops", goals: ["A: 1 of 5 won, behind", "B: 2 days, at least 3 days, behind"], runs: 2, failed: 1, costUsd: 0.5 }), "Ops: A: 1 of 5 won, behind; B: 2 days, at least 3 days, behind. 2 runs, 1 failed, $0.50, in the last 24 hours.");
const id = "00000000-0000-0000-0000-000000000001";
assert.equal(replyUrl({ dashboardUrl: "https://cr.example", runId: id }), `https://cr.example/runs/${id}#react`);
assert.equal(replyUrl({ dashboardUrl: "https://cr.example" }), undefined);
assert.equal(replyUrl({ runId: id }), undefined);

// ---- the email
const view: BriefView = {
  today: "2026-11-19", yesterday: y, earlier: [], openOrders: oc, ownNumbers: ["Open tickets: 4", "<b>x</b>: 1"], runs: [], departments: [],
  approvals: { pending: 0, oldestHours: null }, newDrafts: 0, watch: ["<script>alert(1)</script>"], focus: { action: "Ship the 3 open orders", reason: "They're waiting." },
  dashboardUrl: "https://cr.example", runId: id, chief: "Finn",
};
const e = briefEmail(view);
assert.equal(e.subject, "Thu: Ship the 3 open orders · $412 yesterday");
assert.match(e.html, /Open tickets: 4/); assert.match(e.text, /Open tickets: 4/);
assert.match(e.html, /&lt;b&gt;x&lt;\/b&gt;: 1/, "own numbers are escaped");
assert.doesNotMatch(e.html, /<script>/, "model text is escaped");
assert.match(e.html, /Open orders: 2 to ship, 1 partly shipped/);
assert.match(e.html, /On hold: #3/);
assert.match(e.html, /margin 61%/);
assert.match(e.html, /Not right\? Tell Finn/);
const bare = briefEmail({ ...view, yesterday: null, ownNumbers: [], openOrders: null, chief: undefined });
assert.equal(bare.subject, "Thu: Ship the 3 open orders");
assert.match(bare.html, /No daily numbers yet/);
assert.match(bare.html, /Not right\? Tell your Chief of Staff/);

// ---- core's brief knows nothing of one business
const src = readdirSync("core/brief").map((f) => readFileSync(`core/brief/${f}`, "utf8")).join("\n");
assert.doesNotMatch(src, /\bgreen|roast|coffee|\bQC\b|Avery|Morgan|Rowan|Marlow/i, "no coffee words or agent names in core/brief");
assert.match(readFileSync("integrations/email.ts", "utf8"), /export/, "the email goes through integrations/email.ts");
assert.doesNotMatch(src, /\bto:\s*["'`]/, "no recipient in core/brief");

console.log("check:brief ok");
