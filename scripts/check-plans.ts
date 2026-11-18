// Checks plans (core/plan-rules.ts and the Plan and review tool): weeks, what a plan line may hold,
// who it may name, and the focus note. No database, no network.
// Run: npm run check:plans
import assert from "node:assert/strict";

import { MAX_PLAN_LINES, addDays, checkLine, focusText, openJobs, planItems, resolveWho, runMode, weekOf } from "../core/plan-rules";
import { TOOLS } from "../core/tools/catalog";
import { checkInput } from "../core/tools/types";

// weeks start on Monday, Chicago calendar dates
assert.equal(weekOf("2026-11-15"), "2026-11-09", "a Sunday belongs to the week that started Monday");
assert.equal(weekOf("2026-11-16"), "2026-11-16", "a Monday starts its own week");
assert.equal(weekOf("2026-11-21"), "2026-11-16");
assert.equal(weekOf("2027-01-01"), "2026-12-28", "across a year");
assert.equal(addDays("2026-11-16", 7), "2026-11-23");

// a line: words tidied, links and addresses refused
const line = (o: Record<string, unknown>) => { const r = checkLine(o); if ("problem" in r) throw new Error(r.problem); return r.line; };
const no = (o: Record<string, unknown>) => { const r = checkLine(o); return "problem" in r ? r.problem : null; };
assert.deepEqual(line({ title: " Find cafés  that fit ", who: "Rowan", words: "5 leads, not 10. Independent cafés with their own espresso program." }),
  { title: "Find cafés that fit", who: "Rowan", words: "5 leads, not 10. Independent cafés with their own espresso program." });
assert.match(no({ title: "x", who: "Rowan", words: "Find five good cafés this week." }) ?? "", /title/);
assert.match(no({ title: "Find cafés", who: "", words: "Find five good cafés this week." }) ?? "", /who/);
assert.match(no({ title: "Find cafés", who: "Rowan", words: "go" }) ?? "", /words/);
assert.match(no({ title: "Find cafés", who: "Rowan", words: "Email owner@cafe.com about a tasting." }) ?? "", /address/);
assert.match(no({ title: "Find cafés", who: "Rowan", words: "Start from https://evil.example/list today." }) ?? "", /link/);
assert.match(no({ title: "Call (512) 555-0101", who: "the owner", words: "Call them about a tasting this week." }) ?? "", /phone/);

// who: the owner, a teammate under the head, or an open seat in its department; nobody else
const reach = { team: [{ id: "wholesale_hunter", name: "Rowan" }], openSeats: [{ id: "s-fu", title: "Follow-ups" }] };
assert.deepEqual(resolveWho("the owner", reach), { kind: "owner" });
assert.deepEqual(resolveWho("you", reach), { kind: "owner" });
assert.deepEqual(resolveWho("rowan", reach), { kind: "agent", agentId: "wholesale_hunter", name: "Rowan" });
assert.deepEqual(resolveWho("follow-ups", reach), { kind: "seat", seatId: "s-fu", title: "Follow-ups" });
assert.ok("problem" in resolveWho("Quinn", reach), "an agent in another department");
assert.ok("problem" in resolveWho("b_reese", reach), "the head itself isn't on its own team");

// a plan: one focus per teammate, lines naming nobody are dropped with why, at most 8 lines
const lines = [
  { title: "Find cafés that fit", who: "Rowan", words: "5 leads, not 10." },
  { title: "Follow up with quiet leads", who: "Follow-ups", words: "Nobody holds this; I proposed a hire." },
  { title: "Turn the two tastings into orders", who: "the owner", words: "Bring the Huila and the house blend." },
  { title: "Another Rowan job", who: "Rowan", words: "Also do this other thing." },
  { title: "Quinn's job", who: "Quinn", words: "Not on this team." },
];
const { items, dropped } = planItems(lines, reach);
assert.deepEqual(items.map((i) => [i.n, i.kind, i.who]), [[1, "agent", "Rowan"], [2, "seat", "Follow-ups"], [3, "owner", "You"]]);
assert.equal(dropped.length, 2);
assert.match(dropped.join(" "), /already has a focus/);
assert.match(dropped.join(" "), /Quinn isn't a teammate/);
assert.equal(planItems(Array.from({ length: 12 }, (_, i) => ({ title: `Job ${i}`, who: "the owner", words: "Something to do." })), reach).items.length, MAX_PLAN_LINES);
assert.deepEqual(openJobs([...items, { ...items[2], n: 4, doneAt: "2026-11-17T12:00:00Z" }]).map((i) => i.n), [3]);

// the focus note: who it's from and until when, never longer than a memory line
assert.equal(focusText("Rico", "2026-11-23", "5 leads, not 10."), "Focus from Rico, until Nov 23: 5 leads, not 10.");
assert.equal(focusText("Rico", "2026-11-23", "x".repeat(400)).length, 280);

// plan when the week has no plan, review once it does
assert.equal(runMode(false), "plan");
assert.equal(runMode(true), "review");

// the tools: heads only; Plan and review checks each line and holds at most 8
const t = TOOLS.plan_week;
assert.equal(t.kind, "report");
assert.equal(t.seat, "head");
assert.equal(TOOLS.week_plan.seat, "head");
assert.equal(TOOLS.week_plan.kind, "read");
const ok = checkInput(t.params, { title: "Find cafés that fit", who: "Rowan", words: "5 leads, not 10." });
assert.ok("input" in ok);
const input = (ok as { input: Record<string, string | number> }).input;
const held = t.collect!(input, []);
assert.ok("row" in held);
assert.match((t.collect!(input, ["row" in held ? held.row : {}]) as { problem: string }).problem, /already in this plan/);
assert.match((t.collect!(input, Array.from({ length: 8 }, () => ({}))) as { problem: string }).problem, /at most 8/);
assert.ok("problem" in checkInput(t.params, { title: "Find", who: "Rowan", words: "See https://x.example" }), "the runner refuses links too");

console.log("plans: ok");
