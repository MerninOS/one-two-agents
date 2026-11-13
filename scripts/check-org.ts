// Checks the org chart rules (core/org-rules.ts) on a small chart: no database, no network.
// Run: npm run check:org
import assert from "node:assert/strict";
import { below, depthOf, deptSlug, headOf, orgProblems, reportsTo, seatOf, seatPath, type Org } from "../core/org-rules";

const org: Org = {
  departments: [{ id: "marketing", name: "Marketing", sort: 1 }],
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

const broken: Org = { departments: [...org.departments, { id: "coffee", name: "Coffee", sort: 2 }], seats: [...org.seats, { id: "x", departmentId: "coffee", parentId: "l", title: "Stray", sub: "", holder: "open", agentId: null, sort: 0 }] };
const p = orgProblems(broken);
assert.ok(p.some((t) => t.includes("another department")));
assert.ok(p.some((t) => t.includes("Coffee has no head")));

console.log("check-org: all passed");
