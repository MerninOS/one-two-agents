// Checks the org chart rules (core/org-rules.ts) on a small chart: no database, no network.
// Run: npm run check:org
import assert from "node:assert/strict";
import { agentsIn, below, deptBudgetBlock, deptBudgetChange, deptEmailCap, deptEmailChange, deptOf, deptSpent, depthOf, deptSlug, headOf, orgProblems, reportsTo, seatOf, seatPath, type Org } from "../core/org-rules";

const org: Org = {
  departments: [{ id: "marketing", name: "Marketing", sort: 1, monthlyBudgetUsd: 20, maxEmailsPerDay: null }],
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

const broken: Org = { departments: [...org.departments, { id: "coffee", name: "Coffee", sort: 2, monthlyBudgetUsd: null, maxEmailsPerDay: 5 }], seats: [...org.seats, { id: "x", departmentId: "coffee", parentId: "l", title: "Stray", sub: "", holder: "open", agentId: null, sort: 0 }] };
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

console.log("check-org: all passed");
