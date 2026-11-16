// Checks what turning on the org does (dashboard/orgPlan.ts, docs/org-schedule.md): no database,
// no network. Run: npm run check:org-switch
import assert from "node:assert/strict";

import { planOrgOn, runsInMonth } from "../dashboard/orgPlan";
import type { Chain } from "../core/flow-rules";

// Monday 2026-11-16, 3:00 PM Central
const now = Date.parse("2026-11-16T15:00:00-06:00");
const morning: Chain = { key: "morning", name: "Morning", on: false, start: { type: "schedule", days: "daily", time: "05:30" }, steps: [{ agent: "cfo" }, { agent: "chief_of_staff", days: "weekdays", notBefore: "06:45", passAlong: true }] };
const test: Chain = { key: "test", name: "Test", on: false, start: { type: "schedule", days: "daily", time: "09:00" }, steps: [{ agent: "scratch" }] };
const members = [
  { id: "cfo", name: "Morgan", inOrg: true, avgCost: 0.05 },
  { id: "chief_of_staff", name: "Avery", inOrg: true, avgCost: null, capPerRun: 0.02 },
  { id: "wholesale_hunter", name: "Rowan", inOrg: true, avgCost: 1.02 },
  { id: "b_piper", name: "Piper", inOrg: true, avgCost: null },
  { id: "scratch", name: "Scratch", inOrg: false, avgCost: 0.01 },
];

const p = planOrgOn(members, [morning, test], now);

// every agent in the org wakes; the test agent and its chain stay off
assert.deepEqual(p.wake.map((w) => w.id), ["cfo", "chief_of_staff", "b_piper", "wholesale_hunter"]);
assert.deepEqual(p.left, [{ id: "scratch", name: "Scratch" }]);
assert.deepEqual(p.chainsOn, ["morning"]);
assert.equal(p.chains.find((c) => c.key === "test")!.on, false);
// the original chains are not changed in place
assert.equal(morning.on, false);

// first runs: Morgan daily at 5:30 tomorrow, Avery weekdays at 6:45 tomorrow (a Tuesday)
const cfo = p.wake.find((w) => w.id === "cfo")!;
assert.equal(cfo.firstRun, Date.parse("2026-11-17T05:30:00-06:00"));
assert.deepEqual(cfo.schedule, { kind: "daily", time: "05:30", chain: "Morning" });
const avery = p.wake.find((w) => w.id === "chief_of_staff")!;
assert.equal(avery.firstRun, Date.parse("2026-11-17T06:45:00-06:00"));

// cost a month, in code: average (or cap) times runs in 30 days; by hand is $0
assert.equal(cfo.perMonth.toFixed(2), (0.05 * 30).toFixed(2));
assert.equal(avery.perRun, 0.02);
assert.equal(avery.perMonth.toFixed(2), (0.02 * 22).toFixed(2));
const rowan = p.wake.find((w) => w.id === "wholesale_hunter")!;
assert.equal(rowan.firstRun, null);
assert.equal(rowan.perMonth, 0);
assert.equal(p.totalMonth.toFixed(2), (0.05 * 30 + 0.02 * 22).toFixed(2));
// an agent with no runs and no cap is by hand here, so nothing is unknown in the total
assert.deepEqual(p.unknownCost, []);

// a chain already on stays on and isn't counted as turned on
const p2 = planOrgOn(members, [{ ...morning, on: true }], now);
assert.deepEqual(p2.chainsOn, []);
assert.equal(p2.wake.find((w) => w.id === "cfo")!.firstRun, cfo.firstRun);

// a scheduled agent with no cost known is named, not guessed
const p3 = planOrgOn([{ id: "cfo", name: "Morgan", inOrg: true, avgCost: null }], [{ ...morning, steps: [{ agent: "cfo" }] }], now);
// a chain with an agent outside the org (here, one not in the list) never comes on
assert.deepEqual(planOrgOn([{ id: "cfo", name: "Morgan", inOrg: true, avgCost: 0.05 }], [morning], now).chainsOn, []);
assert.deepEqual(p3.unknownCost, ["Morgan"]);
assert.equal(p3.totalMonth, 0);

assert.equal(runsInMonth({ kind: "daily" }), 30);
assert.equal(runsInMonth({ kind: "weekdays" }), 22);
assert.equal(runsInMonth({ kind: "manual" }), 0);

console.log("org switch: ok");
