// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The paid layer's checks: `npm run check:ee`. Pure: no database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN, monthlyUsd, planBlockFor, planState, planWords, type Subscription } from "./plan-rules";
import type { PlanAsk } from "../core/extension-types";

const now = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sub = (s: Partial<Subscription>): Subscription => ({ status: "trialing", trialEndsAt: null, pastDueSince: null, seats: 1, currentPeriodEnd: null, hasCard: false, ...s });
const ASKS: PlanAsk[] = [{ kind: "run", agentId: "cfo", trigger: "cron" }, { kind: "invite", email: "a@b.co", role: "viewer" }, { kind: "agent_on", agentIds: ["cfo"] }, { kind: "custom_server" }];
const blocksAll = (s: ReturnType<typeof planState>) => ASKS.every((a) => typeof planBlockFor(s, a) === "string");
const blocksNone = (s: ReturnType<typeof planState>) => ASKS.every((a) => planBlockFor(s, a) === null);

// price: $20 with the owner, $5 for each other person
assert.equal(monthlyUsd(1), 20);
assert.equal(monthlyUsd(3), 30);
assert.equal(monthlyUsd(0), 20, "never below the base");
assert.deepEqual(PLAN, { baseUsd: 20, seatUsd: 5, trialDays: 14, graceDays: 7 });

// the home org is never billed, whatever its row says
assert.deepEqual(planState(sub({ status: "canceled" }), { home: true, now }), { kind: "exempt" });
assert.ok(blocksNone(planState(null, { home: true, now })), "nothing pauses the home org");

// no row: no plan, so the crew can't run or grow
assert.deepEqual(planState(null, { home: false, now }), { kind: "none" });
assert.ok(blocksAll(planState(null, { home: false, now })));

// trial: live until its end, then over; a trial with no end date isn't live
const trial = planState(sub({ trialEndsAt: iso(now + 3.5 * DAY) }), { home: false, now });
assert.deepEqual(trial, { kind: "trial", until: iso(now + 3.5 * DAY), daysLeft: 4 });
assert.ok(blocksNone(trial));
assert.deepEqual(planState(sub({ trialEndsAt: iso(now - 1) }), { home: false, now }), { kind: "lapsed", why: "trial_over" });
assert.deepEqual(planState(sub({}), { home: false, now }), { kind: "lapsed", why: "trial_over" });

// active, grace for 7 days after a failed payment, then paused; canceled pauses
assert.ok(blocksNone(planState(sub({ status: "active" }), { home: false, now })));
const grace = planState(sub({ status: "past_due", pastDueSince: iso(now - 6 * DAY) }), { home: false, now });
assert.equal(grace.kind, "grace");
assert.ok(blocksNone(grace), "the grace period pauses nothing");
assert.deepEqual(planState(sub({ status: "past_due", pastDueSince: iso(now - 8 * DAY) }), { home: false, now }), { kind: "lapsed", why: "unpaid" });
assert.equal(planState(sub({ status: "past_due" }), { home: false, now }).kind, "grace", "no date yet: the grace period starts now");
assert.ok(blocksAll(planState(sub({ status: "canceled" }), { home: false, now })));

// what the owner reads: says what's paused and that nothing was deleted
const no = planBlockFor({ kind: "lapsed", why: "trial_over" }, ASKS[0])!;
assert.match(no, /trial is over\. Runs are paused\. .*nothing has been deleted/);
assert.match(planWords(trial, 3), /4 days left\. Then \$30\/month for 3 people/);
assert.match(planWords({ kind: "exempt" }, 1), /no plan and no limits/);

// a plan never reaches past its slot: no vault, no gateway, no write tools, no deletes, no send
for (const f of ["ee/plan-rules.ts", "ee/plan.ts", "ee/billing-card.tsx", "ee/index.ts"]) {
  const s = readFileSync(f, "utf8");
  assert.doesNotMatch(s, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(|\.update\(|\.insert\(|\.upsert\(/, `${f} only reads`);
  assert.match(s, /^\/\/ Copyright Operator Enterprises and Technologies, LLC\. Licensed under ee\/LICENSE/, `${f} carries the ee license line`);
}
assert.match(readFileSync("ee/plan.ts", "utf8"), /=== HOME_ORG_ID\) return planState\(null, \{ home: true/, "the home org never reads a row");

console.log("check:ee ok (plan, trial, grace, home org exempt)");
