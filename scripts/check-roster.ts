// Checks the roster (dashboard/roster.ts) and the crew flow's agent rules (core/flow-rules.ts): no
// database, no network. Run: npm run check:roster
import assert from "node:assert/strict";

import { avgCostOf, buildCrew, costLabel, hueFor, memberOf, scheduleOf, sinceLabel } from "../dashboard/roster";
import { flowProblems, type Chain, type Crew } from "../core/flow-rules";

const tools = { team_report: { label: "Your team", kind: "read" }, report_email_owner: { label: "Email the owner the result", kind: "report" }, gmail_draft_lead: { label: "Draft an email to a lead", kind: "action" } };
const morning: Chain = { key: "morning", name: "Morning", on: true, start: { type: "schedule", days: "daily", time: "05:30" }, steps: [{ agent: "cfo" }, { agent: "b_reese", days: "weekdays", notBefore: "06:45" }] };

// an agent built in the app looks like any other: name from its live version, role from its seat
const reese = memberOf({ id: "b_reese", name: "Reese", role: "", icon: null, hue: null, manual_only: true, created_at: "2026-11-14T15:40:00Z" },
  { name: "Rico", mandate: "Head of sales: watches the pipeline", tools: ["team_report", "report_email_owner"], maxCostUsd: 0.25 },
  { tools, avgCost: null, seatTitle: "Head of sales", chains: [morning] });
assert.equal(reese.name, "Rico");
assert.equal(reese.role, "Head of sales");
assert.equal(reese.built, true);
assert.equal(reese.tier, "Report");
assert.equal(reese.icon, "cpu");
assert.equal(reese.hue, hueFor("b_reese"));
assert.equal(reese.estCostLabel, "Up to $0.25");
assert.equal(reese.writes, "Email the owner the result");
assert.equal(reese.since, "Nov 14");
assert.equal(reese.manualOnly, true);
assert.deepEqual(reese.schedule, { kind: "weekdays", time: "06:45", chain: "Morning" });

// a row's own role and avatar win; an action makes it Draft; no seat and no role says so
const rowan = memberOf({ id: "wholesale_hunter", name: "Rowan", role: "Wholesale Hunter", icon: "compass", hue: "#F5D35C", manual_only: true }, { name: "Rowan", tools: ["gmail_draft_lead"] }, { tools, avgCost: 1.02, seatTitle: "Wholesale prospecting", chains: [] });
assert.equal(rowan.role, "Wholesale Hunter");
assert.equal(rowan.tier, "Draft");
assert.equal(rowan.estCostLabel, "About $1.02");
assert.deepEqual(rowan.schedule, { kind: "manual" });
assert.equal(memberOf({ id: "x", name: "X" }, { tools: [] }, { tools, avgCost: null, seatTitle: null, chains: [] }).role, "Built in the app");
// before the roster migration there is no manual_only column: count it as by hand only
assert.equal(memberOf({ id: "x", name: "X" }, { tools: [] }, { tools, avgCost: null, seatTitle: null, chains: [] }).manualOnly, true);
assert.equal(memberOf({ id: "x", name: "X" }, null, { tools, avgCost: null, seatTitle: null, chains: [] }).built, false);

assert.equal(costLabel(0, 0.5), "$0");
assert.equal(costLabel(0.0031, 0.5), "About $0.003");
assert.equal(costLabel(null, undefined), "Unknown");
assert.equal(sinceLabel("2026-10-29T17:00:00Z"), "Oct 29");
assert.equal(sinceLabel(null), undefined);
assert.equal(avgCostOf([
  { agent_id: "a", status: "ok", trigger: "manual", cost_usd: 0.2 },
  { agent_id: "a", status: "ok", trigger: "preview", cost_usd: 9 },
  { agent_id: "a", status: "failed", trigger: "manual", cost_usd: 9 },
  { agent_id: "a", status: "ok", trigger: "cron", cost_usd: 0.4 },
], "a")?.toFixed(2), "0.30");
assert.equal(avgCostOf([], "a"), null);

// a chain on, preferred over an off one
assert.equal(scheduleOf("cfo", [{ ...morning, key: "off", name: "Off", on: false, start: { type: "schedule", days: "weekdays", time: "09:00" } }, morning]).chain, "Morning");

// the roster: agents first, then planned seats no agent has taken
const PLANNED = [{ ...memberOf({ id: "blend_coach", name: "Coach" }, null, { tools, avgCost: null, seatTitle: "Coach", chains: [] }), built: false }, { ...memberOf({ id: "scout", name: "Scout" }, null, { tools, avgCost: null, seatTitle: "Scout", chains: [] }), built: false }];
const r = buildCrew([reese, rowan, { ...PLANNED[0], id: "blend_coach", built: true }], PLANNED);
assert.equal(r.built.length, 3);
assert.equal(r.planned.some((p) => p.id === "blend_coach"), false);
assert.equal(r.planned.length, PLANNED.length - 1);
assert.equal(r.byId.b_reese.name, "Rico");
assert.equal(buildCrew([reese]).planned.length, 0, "no pack, no planned seats");

// the flow picks from the crew; an agent that runs only by hand needs a Run chain start; any agent reads a hand-off
const crew: Crew = { ids: ["b_reese", "cfo", "wholesale_hunter"], manualOnly: new Set(["wholesale_hunter"]) };
assert.deepEqual(flowProblems({ chains: [{ ...morning, steps: [{ agent: "cfo" }, { agent: "b_reese", passAlong: true }] }] }, crew), []);
assert.match(flowProblems({ chains: [{ ...morning, steps: [{ agent: "wholesale_hunter" }] }] }, crew).join(" "), /runs only by hand/);
assert.deepEqual(flowProblems({ chains: [{ ...morning, start: { type: "button" }, steps: [{ agent: "wholesale_hunter" }] }] }, crew), []);
assert.match(flowProblems({ chains: [{ ...morning, steps: [{ agent: "b_gone" }] }] }, crew).join(" "), /unknown agent/);

console.log("check:roster OK");
