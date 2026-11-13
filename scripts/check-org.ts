// Checks the org chart rules (core/org-rules.ts) on a small chart: no database, no network.
// Run: npm run check:org
import assert from "node:assert/strict";

import { LEAD_MIN_TEAM, LEAD_REVIEW_HOURS, groupByDepartment, checkerOf, draftCode, leadCheck, agentsIn, below, companyBlock, departmentLines, seatToolBlocks, teamBlock, teamOf, deptBudgetBlock, deptBudgetChange, deptEmailCap, deptEmailChange, deptOf, deptSpent, depthOf, deptSlug, headOf, orgProblems, reportsTo, seatOf, seatPath, type Org } from "../core/org-rules";

const org: Org = {
  departments: [{ id: "marketing", name: "Marketing", sort: 1, monthlyBudgetUsd: 20, maxEmailsPerDay: null, leadChecksDrafts: false }],
  seats: [
    { id: "c", departmentId: null, parentId: null, title: "Chief of Staff", sub: "", holder: "agent", agentId: "chief_of_staff", sort: 0 },
    { id: "h", departmentId: "marketing", parentId: null, title: "Head of marketing", sub: "", holder: "open", agentId: null, sort: 0 },
    { id: "l", departmentId: "marketing", parentId: "h", title: "Retention lead", sub: "", holder: "open", agentId: null, sort: 1 },
    { id: "s", departmentId: "marketing", parentId: "l", title: "Subscriptions", sub: "", holder: "agent", agentId: "b_sub", sort: 1 },
  ],
};

assert.deepEqual(orgProblems(org), []);
assert.equal(headOf(org, "marketing")?.id, "h");
assert.equal(seatOf(org, "b_sub")?.id, "s");
assert.equal(depthOf(org, org.seats[3]), 3);
assert.equal(depthOf(org, org.seats[0]), 0);
assert.equal(reportsTo(org, org.seats[1])?.id, "c", "a head reports to the company seat");
assert.equal(reportsTo(org, org.seats[3])?.id, "l");
assert.equal(reportsTo(org, org.seats[0]), null, "the company seat reports to Zak");
assert.equal(seatPath(org, org.seats[3]), "Marketing › Head of marketing › Retention lead › Subscriptions");
assert.deepEqual(below(org, "h").map((s) => s.id), ["l", "s"]);
assert.equal(deptSlug("Customer care"), "customer_care");
assert.equal(deptSlug("1 thing"), "d_1_thing");

const broken: Org = { departments: [...org.departments, { id: "coffee", name: "Coffee", sort: 2, monthlyBudgetUsd: null, maxEmailsPerDay: 5, leadChecksDrafts: false }], seats: [...org.seats, { id: "x", departmentId: "coffee", parentId: "l", title: "Stray", sub: "", holder: "open", agentId: null, sort: 0 }] };
const p = orgProblems(broken);
assert.ok(p.some((t) => t.includes("another department")));
assert.ok(p.some((t) => t.includes("Coffee has no head")));

// Slice 2: department budgets and email caps
const mk = org.departments[0];
assert.deepEqual(agentsIn(org, "marketing"), ["b_sub"], "only seated agents count, not open seats");
assert.equal(deptOf(org, "b_sub")?.id, "marketing");
assert.equal(deptOf(org, "chief_of_staff"), null, "the company seat is in no department");
assert.equal(deptSpent(org, "marketing", { b_sub: 0.1, chief_of_staff: 9, other: 4 }), 0.1, "only the department's agents count");
assert.equal(deptSpent(org, "marketing", { b_sub: 19.995 }), 20);
assert.equal(deptBudgetBlock(mk, 19.99), null);
assert.ok(deptBudgetBlock(mk, 20)?.includes("Marketing"), "at the budget, runs stop");
assert.equal(deptBudgetBlock({ ...mk, monthlyBudgetUsd: null }, 999), null, "no department budget, nothing to check");
assert.equal(deptBudgetBlock({ ...mk, monthlyBudgetUsd: 0 }, 0)?.includes("used up"), true, "a $0 budget stops every run");
assert.deepEqual(deptBudgetChange(20, 10), { looser: false });
assert.deepEqual(deptBudgetChange(20, 30), { looser: true });
assert.deepEqual(deptBudgetChange(null, 30), { looser: false }, "setting a budget where there was none is stricter");
assert.deepEqual(deptBudgetChange(20, null), { looser: true }, "removing the budget is looser");
assert.ok("refuse" in deptBudgetChange(20, 501));
assert.ok("refuse" in deptBudgetChange(20, -1));
assert.ok("refuse" in deptBudgetChange(20, 1.234));
assert.ok("refuse" in deptBudgetChange(20, 20));
assert.ok("refuse" in deptEmailChange(null, 21, 20), "never above the company cap");
assert.ok("refuse" in deptEmailChange(null, 2.5, 20));
assert.deepEqual(deptEmailChange(null, 5, 20), { looser: false });
assert.deepEqual(deptEmailChange(5, 8, 20), { looser: true });
assert.deepEqual(deptEmailChange(5, null, 20), { looser: true });
assert.equal(deptEmailCap(broken.departments[1], 20), 5);
assert.equal(deptEmailCap(broken.departments[1], 3), 3, "a lowered company cap wins over a department row");
assert.equal(deptEmailCap(mk, 20), 20, "no department cap: the company cap");


// Slice 3: leads watch, heads report up. The team comes from the chart, live agents only.
const team: Org = {
  departments: org.departments,
  seats: [
    org.seats[0],
    { ...org.seats[1], holder: "agent", agentId: "b_head" },
    { ...org.seats[2], holder: "agent", agentId: "b_lead" },
    org.seats[3],
    { id: "s2", departmentId: "marketing", parentId: "l", title: "Wholesale", sub: "", holder: "agent", agentId: "b_ws", sort: 2 },
  ],
};
const live = new Set(["chief_of_staff", "b_head", "b_lead", "b_sub", "b_ws"]);
assert.equal(LEAD_MIN_TEAM, 2);
assert.deepEqual(teamOf(team, "b_head", live)?.agents, ["b_lead", "b_sub", "b_ws"], "a head's team is everyone under it, at any depth");
assert.equal(teamOf(team, "b_head", live)?.head, true);
assert.equal(teamOf(team, "nobody", live), null);
assert.equal(teamBlock(team, "b_head", live), null);
assert.equal(teamBlock(team, "b_lead", live), null, "a lead with 2 live agents under it");
assert.ok(teamBlock(team, "b_lead", new Set(["b_sub"]))?.includes("2 live agents"), "a lead with 1 live agent waits");
assert.equal(teamBlock(team, "b_head", new Set(["b_sub"])), null, "a head needs only 1");
assert.ok(teamBlock(team, "b_sub", live)?.includes("No live agent"), "a seat with nobody under it");
assert.ok(teamBlock(team, "chief_of_staff", live)?.includes("Department reports"), "the company seat reads Department reports instead");
assert.ok(teamBlock(team, "b_other", live)?.includes("org chart"));
assert.ok(teamBlock(team, null, live)?.includes("org chart"), "a new agent with no seat");
assert.equal(companyBlock(team, "chief_of_staff"), null);
assert.ok(companyBlock(team, "b_head"));
assert.ok(companyBlock(team, null));
assert.deepEqual(seatToolBlocks(team, "l", live), { team: null, company: companyBlock(team, "b_head") }, "a new agent picking the lead seat gets the same answer");
assert.equal(seatToolBlocks(team, "nope", live).team, teamBlock(team, null, live));

// Avery's department lines are matched to chart names in code; anything else is ignored
assert.deepEqual(
  departmentLines("Focus: Ship it. Today.\n- watch this\nmarketing: Two drafts wait.\n- Finance: Cash is fine.\nSales: not on the chart\nMarketing: a second line", ["Marketing", "Finance"]),
  { Marketing: "Two drafts wait.", Finance: "Cash is fine." },
);
assert.equal(departmentLines(`Marketing: ${"x".repeat(400)}`, ["Marketing"]).Marketing.length, 300);
assert.deepEqual(departmentLines("", ["Marketing"]), {});


// Slice 4: the lead checks drafts first, only where the department has it on
const on: Org = { ...team, departments: [{ ...mk, leadChecksDrafts: true }] };
const checkers = new Set(["b_head", "b_lead"]);
assert.equal(checkerOf(team, "b_sub", live, checkers), null, "off by default: drafts go straight to Zak");
assert.deepEqual(checkerOf(on, "b_sub", live, checkers), { reviewer: "b_lead", departmentId: "marketing" }, "the nearest agent above");
assert.deepEqual(checkerOf(on, "b_sub", live, new Set(["b_head"])), { reviewer: "b_head", departmentId: "marketing" }, "skips an agent above that can't check drafts");
assert.deepEqual(checkerOf(on, "b_sub", new Set(["b_sub", "b_head"]), checkers), { reviewer: "b_head", departmentId: "marketing" }, "skips an agent that isn't live");
assert.equal(checkerOf(on, "b_head", live, checkers), null, "a head's own drafts go to Zak: the company seat never checks");
assert.equal(checkerOf(on, "chief_of_staff", live, checkers), null);
assert.equal(checkerOf(on, "nobody", live, checkers), null);
assert.equal(LEAD_REVIEW_HOURS, 24);
assert.deepEqual(leadCheck("note", "  Check the  price. ", true), { verdict: "note", note: "Check the price." });
assert.deepEqual(leadCheck("send_back", "Wrong lead.", true), { verdict: "send_back", note: "Wrong lead." });
assert.ok("problem" in leadCheck("send_back", "Wrong lead.", false), "only once");
assert.ok("problem" in leadCheck("approve", "ok", true), "a lead can't approve");
assert.ok("problem" in leadCheck("note", "see https://x.co", true), "no links");
assert.ok("problem" in leadCheck("note", " ", true));
assert.equal(draftCode("3F2A9C1B-0000-4000-8000-000000000000"), "3f2a9c1b");


// Today: Needs you grouped by department, the rest last
const need = (title: string, agentId?: string) => ({ pri: "High" as const, title, sub: "", href: "/", agentId });
const dOf = (id: string) => (id === "b_sub" ? { id: "marketing", name: "Marketing", sort: 1 } : id === "cfo" ? { id: "finance", name: "Finance", sort: 0 } : null);
assert.deepEqual(groupByDepartment([need("a", "b_sub"), need("b"), need("c", "cfo")], dOf).map((g) => [g.name, g.items.map((x) => x.title)]), [["Finance", ["c"]], ["Marketing", ["a"]], ["Everything else", ["b"]]]);
assert.deepEqual(groupByDepartment([need("b")], dOf), [{ name: null, items: [need("b")] }], "no departments: one plain list");
assert.deepEqual(groupByDepartment([], dOf), []);

console.log("check-org: all passed");
