// Checks what turning on the org does (dashboard/orgPlan.ts, docs/org-schedule.md): no database,
// no network. Run: npm run check:org-switch
import assert from "node:assert/strict";

import { planOrgOn, runsInMonth } from "../dashboard/orgPlan";
import { flowProblems, nextFirings, onDay, runsPerMonth, withAgentTime, type Chain, type Flow } from "../core/flow-rules";
import { nextRuns } from "../dashboard/schedule";
import { orgDay } from "../dashboard/orgDay";
import type { CrewMember } from "../dashboard/crew";

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
assert.equal(runsInMonth({ kind: "mondays" }), 4);

// ---- Mondays (slice 3): a chain can start on Mondays only; the next Monday from Monday afternoon is a week out
assert.equal(onDay("mondays", "2026-11-16"), true);
assert.equal(onDay("mondays", "2026-11-17"), false);
assert.deepEqual(nextRuns({ kind: "mondays", time: "07:00" }, now, 2), [Date.parse("2026-11-23T07:00:00-06:00"), Date.parse("2026-11-30T07:00:00-06:00")]);
const mondayFlow: Flow = { chains: [{ key: "plan", name: "Plan", on: true, start: { type: "schedule", days: "mondays", time: "07:00" }, steps: [{ agent: "b_piper" }] }] };
assert.deepEqual(flowProblems(mondayFlow, { ids: ["b_piper"], manualOnly: new Set() }), []);
assert.deepEqual(nextFirings(mondayFlow.chains[0], now, 1), [Date.parse("2026-11-23T07:00:00-06:00")]);
assert.equal(runsPerMonth(mondayFlow.chains[0]), 4);
assert.deepEqual(flowProblems({ chains: [{ ...mondayFlow.chains[0], start: { type: "schedule", days: "fridays" as never, time: "07:00" } }] }, { ids: ["b_piper"], manualOnly: new Set() }).length, 1);

// ---- one agent's time (core/flow-rules.ts withAgentTime)
const flow: Flow = { chains: [{ ...morning, on: true }] };
const crew = { ids: ["b_piper", "cfo", "chief_of_staff", "wholesale_hunter"], manualOnly: new Set<string>() };
const ok = (r: ReturnType<typeof withAgentTime>) => { if ("refuse" in r) throw new Error(r.refuse); return r.flow; };

// a new time for an agent in no chain: its own one-step chain, on
const piper = ok(withAgentTime(flow, "b_piper", "Piper", { days: "weekdays", time: "06:30" }));
assert.equal(piper.chains.length, 2);
assert.deepEqual(piper.chains[1], { key: "solo-b_piper", name: "Piper", on: true, start: { type: "schedule", days: "weekdays", time: "06:30" }, steps: [{ agent: "b_piper" }] });
assert.deepEqual(flowProblems(piper, crew), []);
assert.equal(flow.chains.length, 1); // not changed in place
// a first step moves the chain's start; a later step moves its "not before"
assert.deepEqual(ok(withAgentTime(flow, "cfo", "Morgan", { days: "weekdays", time: "05:00" })).chains[0].start, { type: "schedule", days: "weekdays", time: "05:00" });
const av = ok(withAgentTime(flow, "chief_of_staff", "Avery", { days: "weekdays", time: "07:00" })).chains[0].steps[1];
assert.equal(av.notBefore, "07:00");
assert.equal(av.days, "weekdays");
assert.equal(av.passAlong, true);
// Mondays for an agent in no chain
assert.deepEqual(ok(withAgentTime(flow, "b_piper", "Piper", { days: "mondays", time: "07:00" })).chains[1].start, { type: "schedule", days: "mondays", time: "07:00" });
// a later step can't run before its chain starts
assert.ok("refuse" in withAgentTime(flow, "chief_of_staff", "Avery", { days: "weekdays", time: "05:00" }));
assert.ok("refuse" in withAgentTime(flow, "b_piper", "Piper", { days: "weekdays", time: "06:10" }));
// by hand: the first step leaves and the next takes the start at its own time and days
const morganByHand = ok(withAgentTime(flow, "cfo", "Morgan", null));
assert.deepEqual(morganByHand.chains[0].start, { type: "schedule", days: "weekdays", time: "06:45" });
assert.deepEqual(morganByHand.chains[0].steps, [{ agent: "chief_of_staff" }]);
assert.deepEqual(flowProblems(morganByHand, { ...crew, manualOnly: new Set(["cfo"]) }), []);
// by hand on the only step drops the chain; a button chain keeps the agent
const soloGone = ok(withAgentTime(piper, "b_piper", "Piper", null));
assert.equal(soloGone.chains.length, 1);
const button: Flow = { chains: [{ key: "b", name: "By button", on: false, start: { type: "button" }, steps: [{ agent: "b_piper" }] }] };
assert.deepEqual(ok(withAgentTime(button, "b_piper", "Piper", null)), button);

// ---- the org's day (dashboard/orgDay.ts)
const m = (id: string, name: string, schedule: CrewMember["schedule"], avgCost: number | null, extra: Partial<CrewMember> = {}): CrewMember =>
  ({ id, name, role: name, icon: "cpu", tier: "Report", mandate: "", job: "", hue: "#F2884B", schedule, avgCost, inOrg: true, ...extra });
const org = { departments: [{ id: "finance", name: "Finance", sort: 1, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false }], seats: [
  { id: "s0", departmentId: null, parentId: null, title: "Chief of Staff", sub: "", holder: "agent" as const, agentId: "chief_of_staff", sort: 0 },
  { id: "s1", departmentId: "finance", parentId: null, title: "CFO", sub: "", holder: "agent" as const, agentId: "cfo", sort: 0 },
] };
const day = orgDay({
  members: [
    m("cfo", "Morgan", { kind: "daily", time: "05:30", chain: "Morning" }, 0.05),
    m("chief_of_staff", "Avery", { kind: "weekdays", time: "06:45", chain: "Morning" }, 0.01),
    m("wholesale_hunter", "Rowan", { kind: "manual" }, 1.02),
    m("scratch", "Scratch", { kind: "manual" }, null, { inOrg: false }),
  ],
  enabled: { cfo: true }, budget: { cfo: 0.5 }, grants: { chief_of_staff: ["report_morning_brief"] }, org, now,
});
assert.deepEqual(day.groups.map((g) => [g.name, g.rows.map((r) => r.id)]), [["Company", ["chief_of_staff"]], ["Finance", ["cfo"]], ["Not on the chart", ["wholesale_hunter"]]]);
assert.deepEqual(day.window, [4, 12]);
assert.equal(day.rows.find((r) => r.id === "cfo")!.at, 1.5 / 8);
assert.equal(day.rows.find((r) => r.id === "chief_of_staff")!.reportsToYou, true);
assert.equal(day.rows.find((r) => r.id === "wholesale_hunter")!.at, null);
assert.equal(day.totalMonth.toFixed(2), (0.05 * 30 + 0.01 * 22).toFixed(2));
assert.deepEqual([day.scheduled, day.byHand], [2, 1]);
assert.deepEqual(day.left, ["Scratch"]);
assert.equal(day.rows.find((r) => r.id === "cfo")!.next[0], Date.parse("2026-11-17T05:30:00-06:00"));

console.log("org switch: ok");
