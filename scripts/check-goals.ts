// Checks the goal rules (core/goal-rules.ts): what a goal may hold, pace and status. No database, no network.
// Run: npm run check:goals
import assert from "node:assert/strict";

import { MEASURES, fmt, measureOf, planGoal, progress, type GoalRow } from "../core/goal-rules";

const today = "2026-11-15";
const ok = (r: ReturnType<typeof planGoal>) => { if ("error" in r) throw new Error(r.error); return r.plan; };
const err = (r: ReturnType<typeof planGoal>) => ("error" in r ? r.error : null);

// the list: unique keys, every measure says how it's counted, and one that can't be counted says what's missing
assert.equal(new Set(MEASURES.map((m) => m.key)).size, MEASURES.length);
for (const m of MEASURES) { assert.ok(m.how.length > 10, m.key); if (!m.available) assert.ok(m.needs, m.key); }
assert.equal(measureOf("drop table"), null);

// a total goal: words tidied, a target and a date
assert.deepEqual(ok(planGoal({ title: "  Land 5   wholesale accounts ", measure: "wholesale_won", target: "5", dueOn: "2027-03-31" }, today)),
  { title: "Land 5 wholesale accounts", measure: "wholesale_won", target: 5, dueOn: "2027-03-31" });
// a monthly goal drops the date; dollars are rounded to cents and may carry $ and commas
assert.deepEqual(ok(planGoal({ title: "Sell more", measure: "revenue_month", target: "$3,000.456", dueOn: "2027-01-01" }, today)),
  { title: "Sell more", measure: "revenue_month", target: 3000.46, dueOn: null });
// a floor goal: a date is optional
assert.equal(ok(planGoal({ title: "Stay funded", measure: "runway_months", target: 12 }, today)).dueOn, null);
// Email list size (Klaviyo, slice 6) counts now: a total, so it needs a target and a date
assert.deepEqual(ok(planGoal({ title: "Grow the list", measure: "email_list_size", target: "1000", dueOn: "2027-01-01" }, today)),
  { title: "Grow the list", measure: "email_list_size", target: 1000, dueOn: "2027-01-01" });
assert.ok("error" in planGoal({ title: "Grow the list", measure: "email_list_size", target: "1000" }, today), "a total needs a date");
// no measure at all is allowed (it shows No measure yet)
assert.equal(ok(planGoal({ title: "Be loved", measure: "" }, today)).measure, null);

// refusals
assert.match(err(planGoal({ title: "x" }, today)) ?? "", /Say what the goal is/);
assert.match(err(planGoal({ title: "y".repeat(121) }, today)) ?? "", /120/);
assert.match(err(planGoal({ title: "See https://evil.example" }, today)) ?? "", /link/);
assert.match(err(planGoal({ title: "Goal", measure: "made_up" }, today)) ?? "", /from the list/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "0", dueOn: "2027-01-01" }, today)) ?? "", /above zero/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "2.5", dueOn: "2027-01-01" }, today)) ?? "", /whole number/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "5" }, today)) ?? "", /needs a date/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "5", dueOn: today }, today)) ?? "", /after today/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "5", dueOn: "2026-02-30" }, today)) ?? "", /real date/);
assert.match(err(planGoal({ title: "Goal", measure: "wholesale_won", target: "5", dueOn: "2031-01-01" }, today)) ?? "", /3 years/);

// pace for a total goal: set Nov 15 with 1 won, 5 by Mar 31 (136 days)
const won = (o: Partial<GoalRow> = {}): GoalRow => ({ measure: "wholesale_won", target: 5, start_value: 1, due_on: "2027-03-31", state: "active", paced_from: "2026-11-15T18:00:00Z", ...o });
let p = progress(won(), { value: 1 }, today);
assert.equal(p.status, "on_track", "day one is on pace");
assert.equal(p.line, "1 of 5 won");
assert.match(p.pace ?? "", /One more every 34 days/);
p = progress(won(), { value: 1 }, "2027-01-15");
assert.equal(p.status, "behind", "two months in with nothing new");
p = progress(won(), { value: 3 }, "2027-01-15");
assert.equal(p.status, "on_track");
assert.match(p.pace ?? "", /At the current rate, about 5 by Mar 31/);
assert.equal(progress(won(), { value: 5 }, "2027-01-15").status, "reached");
assert.equal(progress(won(), { value: 4 }, "2027-04-01").status, "missed");
assert.equal(progress(won({ state: "paused" }), { value: 1 }, "2027-01-15").status, "paused");
assert.equal(progress(won(), { error: "Shopify took too long" }, today).status, "unreadable");
assert.equal(progress(won(), null, today).status, "unreadable");

// a monthly goal: $3,000, $1,000 by the 15th of a 30-day month is behind; $1,600 is on pace
const rev: GoalRow = { measure: "revenue_month", target: 3000, start_value: null, due_on: null, state: "active", paced_from: "2026-11-01T18:00:00Z" };
p = progress(rev, { value: 1000 }, today);
assert.equal(p.status, "behind");
assert.equal(p.line, "$1,000 of $3,000 this month");
assert.match(p.pace ?? "", /On pace for \$2,000/);
assert.equal(progress(rev, { value: 1600 }, today).status, "on_track");
assert.equal(progress(rev, { value: 3100 }, today).status, "reached");

// a floor goal
const runway: GoalRow = { measure: "runway_months", target: 12, start_value: null, due_on: null, state: "active", paced_from: "2026-11-01T18:00:00Z" };
assert.equal(progress(runway, { value: 14 }, today).status, "on_track");
p = progress(runway, { value: 8 }, today);
assert.equal(p.status, "behind");
assert.equal(progress(runway, { value: 0, unbounded: true }, today).status, "on_track", "no burn, no runway limit");

// no measure yet
p = progress({ ...won(), measure: "email_list_size", target: null }, null, today);
assert.equal(p.status, "no_measure");
assert.equal(progress({ ...won(), measure: null, target: null }, null, today).status, "no_measure");

// formatting
assert.equal(fmt(14.25, "months"), "14.3 months");
assert.equal(fmt(1, "days"), "1 day");
assert.equal(fmt(12.5, "usd"), "$12.50");
assert.equal(fmt(3000.46, "usd"), "$3,000");

console.log("goal rules: ok");
