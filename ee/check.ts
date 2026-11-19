// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The paid layer's checks: `npm run check:ee`. Pure: no database, no network.
import assert from "node:assert/strict";
import { EE_TABLES } from "../scripts/lib/schema";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { checkSignup, codeHash, newCode, normalCode, slugFor } from "./signup-rules";
import { formEncode, ourStatus, rowFromSubscription, trialEndFor, validSignature } from "./stripe-rules";
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

// a comped row is never billed and never paused (card 135): no business is exempt by being first
assert.deepEqual(planState(sub({ status: "comped" }), { now }), { kind: "comped" });
assert.ok(blocksNone(planState(sub({ status: "comped", trialEndsAt: iso(now - DAY) }), { now })), "nothing pauses a comped business");

// no row: no plan, so the crew can't run or grow
assert.deepEqual(planState(null, { now }), { kind: "none" });
assert.ok(blocksAll(planState(null, { now })));

// trial: live until its end, then over; a trial with no end date isn't live
const trial = planState(sub({ trialEndsAt: iso(now + 3.5 * DAY) }), { now });
assert.deepEqual(trial, { kind: "trial", until: iso(now + 3.5 * DAY), daysLeft: 4 });
assert.ok(blocksNone(trial));
assert.deepEqual(planState(sub({ trialEndsAt: iso(now - 1) }), { now }), { kind: "lapsed", why: "trial_over" });
assert.deepEqual(planState(sub({}), { now }), { kind: "lapsed", why: "trial_over" });

// active, grace for 7 days after a failed payment, then paused; canceled pauses
assert.ok(blocksNone(planState(sub({ status: "active" }), { now })));
const grace = planState(sub({ status: "past_due", pastDueSince: iso(now - 6 * DAY) }), { now });
assert.equal(grace.kind, "grace");
assert.ok(blocksNone(grace), "the grace period pauses nothing");
assert.deepEqual(planState(sub({ status: "past_due", pastDueSince: iso(now - 8 * DAY) }), { now }), { kind: "lapsed", why: "unpaid" });
assert.equal(planState(sub({ status: "past_due" }), { now }).kind, "grace", "no date yet: the grace period starts now");
assert.ok(blocksAll(planState(sub({ status: "canceled" }), { now })));

// what the owner reads: says what's paused and that nothing was deleted
const no = planBlockFor({ kind: "lapsed", why: "trial_over" }, ASKS[0])!;
assert.match(no, /trial is over\. Runs are paused\. .*nothing has been deleted/);
assert.match(planWords(trial, 3), /4 days left\. Then \$30\/month for 3 people/);
assert.match(planWords({ kind: "comped" }, 1), /Comped: no charge and no limits/);

// a plan never reaches past its slot: no vault, no gateway, no write tools, no deletes, no send
for (const f of ["ee/plan-rules.ts", "ee/plan.ts", "ee/billing-card.tsx", "ee/index.ts"]) {
  const s = readFileSync(f, "utf8");
  assert.doesNotMatch(s, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(|\.update\(|\.insert\(|\.upsert\(/, `${f} only reads`);
  assert.match(s, /^\/\/ Copyright Operator Enterprises and Technologies, LLC\. Licensed under ee\/LICENSE/, `${f} carries the ee license line`);
}
for (const f of readdirSync("ee").filter((f) => /\.tsx?$/.test(f) && f !== "check.ts")) assert.doesNotMatch(readFileSync(`ee/${f}`, "utf8"), /HOME_ORG_ID/, `ee/${f}: no business is special by being first (card 135)`);
assert.match(readFileSync(EE_TABLES, "utf8"), /'canceled', 'comped'\)\)/, "the database allows a comped row");

// Stripe: signatures, encoding, and the row a subscription leaves
{
  const secret = "whsec_test_secret";
  const body = '{"type":"customer.subscription.updated"}';
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.ok(validSignature(body, `t=${t},v1=${sig}`, secret, t + 10));
  assert.ok(validSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, secret, t), "any v1 may match (secret rolling)");
  assert.ok(!validSignature(body + " ", `t=${t},v1=${sig}`, secret, t), "a changed body fails");
  assert.ok(!validSignature(body, `t=${t},v1=${sig}`, "whsec_other", t), "another secret fails");
  assert.ok(!validSignature(body, `t=${t},v1=${sig}`, secret, t + 301), "an old signature fails");
  assert.ok(!validSignature(body, null, secret, t) && !validSignature(body, `t=${t},v1=${sig}`, "", t), "no header or no secret fails");
  assert.ok(!validSignature(body, `t=${t},v1=zz`, secret, t), "a malformed signature fails");
}
assert.equal(formEncode({ mode: "subscription", line_items: { 0: { price: "price_1", quantity: 3 } }, customer: undefined, subscription_data: { metadata: { org_id: "o" } } }),
  "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=3&subscription_data%5Bmetadata%5D%5Borg_id%5D=o");
assert.equal(ourStatus("unpaid"), "past_due");
assert.equal(ourStatus("incomplete"), null, "an incomplete first payment changes nothing");
assert.equal(ourStatus("incomplete_expired"), "canceled");
{
  const s = { id: "sub_ABC123", customer: "cus_XYZ789", status: "past_due", trial_end: null, metadata: { org_id: "0e1a7c4e-0002-4000-8000-000000000002" }, items: { data: [{ id: "si_1", quantity: 4, current_period_end: 1_800_000_000 }] } };
  const nowIso = "2026-12-01T12:00:00.000Z";
  const first = rowFromSubscription(s, { status: "active", past_due_since: null }, nowIso)!;
  assert.deepEqual(first, { status: "past_due", trial_ends_at: null, past_due_since: nowIso, seats: 4, stripe_customer_id: "cus_XYZ789", stripe_subscription_id: "sub_ABC123", current_period_end: new Date(1_800_000_000_000).toISOString() });
  assert.equal(rowFromSubscription(s, { status: "past_due", past_due_since: "2026-11-28T00:00:00.000Z" }, nowIso)!.past_due_since, "2026-11-28T00:00:00.000Z", "the grace period runs from the first failure");
  assert.equal(rowFromSubscription({ ...s, status: "active" }, { status: "past_due", past_due_since: nowIso }, nowIso)!.past_due_since, null, "paid: grace cleared");
  assert.equal(rowFromSubscription({ ...s, customer: "evil" }, null, nowIso), null, "ids must be Stripe's");
  assert.equal(rowFromSubscription({ ...s, status: "incomplete" }, null, nowIso), null);
}
assert.equal(trialEndFor(iso(now + 3 * DAY), now), Math.floor((now + 3 * DAY) / 1000), "the rest of our trial carries over to Stripe");
assert.equal(trialEndFor(iso(now + 47 * 3_600_000), now), undefined, "under 48 hours: Stripe charges at once");
assert.equal(trialEndFor(null, now), undefined);

// Stripe stays app infrastructure: one file calls it, nothing outside ee/ reaches it, no agent path
assert.deepEqual(readdirSync("ee").filter((f) => f !== "check.ts" && /\.tsx?$/.test(f) && /api\.stripe\.com|STRIPE_SECRET_KEY/.test(readFileSync(`ee/${f}`, "utf8"))), ["stripe.ts"], "only ee/stripe.ts calls Stripe or reads its key");
assert.match(readFileSync("ee/stripe.ts", "utf8"), /redirect: "error"/, "a request carrying the key never follows a redirect");
assert.match(readFileSync("ee/stripe.ts", "utf8"), /scrubSecrets\(/, "errors never show the key");
const billing = readFileSync("ee/billing.ts", "utf8");
assert.doesNotMatch(billing, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(/, "billing touches no vault, gateway or tool, and deletes nothing");
assert.deepEqual([...billing.matchAll(/db\(\)\.from\("(\w+)"\)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort(), ["ee_subscriptions", "orgs"], "billing reads only its row and whether the org exists");
assert.match(billing, /if \(prev\?\.status === "comped"\) return "a comped business is never billed"/, "the webhook never writes over a comped row");
assert.ok(billing.indexOf('prev?.status === "comped"') < billing.indexOf("rowFromSubscription(s, prev"), "checked before anything is written");
assert.match(billing, /if \(r\?\.status === "comped"\) throw/, "a comped business can't open Checkout");
assert.match(readFileSync("ee/billing-actions.ts", "utf8"), /^"use server";/);

// Invite-only sign-up: codes, the form, and one code making one business
{
  const code = newCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255]));
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, "codes use letters that can't be misread");
  assert.match(newCode(), /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.notEqual(newCode(), newCode());
  assert.equal(normalCode(` ${code.toLowerCase()} `), code.replace(/-/g, ""), "typed any case, with or without dashes");
  assert.equal(normalCode("ABCD-EFGH-IJK0"), null, "0, 1, I, L and O never appear in a code");
  assert.equal(codeHash("ABCDEFGHJKMN"), codeHash("ABCDEFGHJKMN"));
  assert.match(codeHash("ABCDEFGHJKMN"), /^[0-9a-f]{64}$/);
  assert.equal(slugFor("Café Olé & Sons!", "a1b2c3"), "cafe-ole-sons-a1b2c3");
  assert.equal(slugFor("!!", "a1b2c3"), "business-a1b2c3");
  assert.match(slugFor("x".repeat(200)), /^[a-z0-9][a-z0-9-]{1,40}$/, "a slug core/install accepts");
  const good = { code: code.toLowerCase(), business: "  Acme   Coffee ", ownerName: "Sam", email: "Sam@Acme.example" };
  assert.deepEqual(checkSignup(good), { ok: { code: code.replace(/-/g, ""), business: "Acme Coffee", ownerName: "Sam", email: "sam@acme.example" } });
  assert.ok("problem" in checkSignup({ ...good, code: "nope" }));
  assert.ok("problem" in checkSignup({ ...good, email: "sam@acme" }));
  assert.ok("problem" in checkSignup({ ...good, business: "" }));
  const signup = readFileSync("ee/signup.ts", "utf8");
  assert.match(signup, /\.update\(\{ used_at: now \}\)\.eq\("code_hash", codeHash\(f\.code\)\)\.is\("used_at", null\)\.gt\("expires_at", now\)/, "a code is used once, only while it's open, before anything is made");
  assert.ok(signup.indexOf("if (!claimed)") < signup.indexOf("await newOrg("), "no business without a used code");
  assert.match(signup, /status: "trialing", trial_ends_at: new Date\(Date\.now\(\) \+ PLAN\.trialDays/, "a new business starts on the trial");
  assert.doesNotMatch(signup, /\.delete\(|core\/vault|core\/gateway/, "codes are ended, never deleted");
  const actions = readFileSync("ee/signup-actions.ts", "utf8");
  assert.ok(actions.indexOf("checkSignup(") < actions.indexOf("signUpBusiness(ok)"), "the form is checked first");
  assert.equal(actions.match(/if \(me\.orgId !== adminOrgId\(\)\)/g)?.length, 2, "only the admin business makes and ends codes");
  assert.equal(signup.match(/withOrg\(/g)?.length, 2, "codes are read and written only as the admin business (asAdmin), and the new business as itself");
  assert.match(signup, /if \(!admin\) return Promise\.reject\(new Error\(SIGNUP_CLOSED\)\)/, "no admin business: sign-up is closed");
  const admin = readFileSync("ee/admin.ts", "utf8");
  assert.match(admin, /process\.env\.OPERATOR_ADMIN_ORG_ID/, "the admin business is one setting");
  assert.match(readFileSync("ee/signup-page.tsx", "utf8"), /if \(!adminOrgId\(\)\)/, "/signup says when sign-up is closed");
}

console.log("check:ee ok (plan, trial, grace, comped, Stripe signatures and rows, sign-up codes)");
