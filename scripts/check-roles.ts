// People and roles (docs/tenancy.md, slice 2): `npm run check:roles`. Pure: no network, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { atLeast, isRole, memberChangeProblem, normalEmail, refusal, safeNext } from "../core/roles";

// roles: viewer < approver < owner
assert.ok(atLeast("owner", "approver") && atLeast("approver", "approver") && atLeast("viewer", "viewer"));
assert.ok(!atLeast("viewer", "approver") && !atLeast("approver", "owner"));
assert.ok(isRole("owner") && !isRole("admin") && !isRole(undefined));
assert.match(refusal("viewer", "approver"), /Approvers and owners only: you’re signed in as a viewer/);
assert.match(refusal("approver", "owner"), /Owners only: you’re signed in as an approver/);

// emails
assert.equal(normalEmail("  Sam@Example.COM "), "sam@example.com");
for (const bad of ["", "owner", "owner@", "@x.co", "a b@x.co", "x".repeat(250) + "@x.co", null]) assert.equal(normalEmail(bad), null);

// at least one owner always remains
const ms = [{ id: "a", role: "owner" as const }, { id: "b", role: "approver" as const }];
assert.match(memberChangeProblem(ms, "a", "removed")!, /last owner/);
assert.match(memberChangeProblem(ms, "a", "viewer")!, /last owner/);
assert.equal(memberChangeProblem(ms, "a", "owner"), null);
assert.equal(memberChangeProblem(ms, "b", "removed"), null);
assert.equal(memberChangeProblem([...ms, { id: "c", role: "owner" }], "a", "removed"), null);
assert.match(memberChangeProblem(ms, "zz", "viewer")!, /isn’t a member/);

// after sign-in: this site's own paths only
assert.equal(safeNext("/approvals?x=1"), "/approvals?x=1");
for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/auth/confirm", "", undefined]) assert.equal(safeNext(bad), "/");

// sessions: signed, expiring, naming a member id; no secret means nobody gets in
const ID = "0e1a7c4e-00aa-4000-8000-0000000000aa";
const run = async () => {
  delete process.env.SESSION_SECRET;
  const s = await import("../dashboard/session");
  assert.equal(s.loginConfigured(), false);
  assert.throws(() => s.newSessionToken(ID), /SESSION_SECRET/);
  process.env.SESSION_SECRET = "short";
  assert.equal(s.loginConfigured(), false, "a short secret signs nobody in");
  process.env.SESSION_SECRET = "a".repeat(44);
  const now = Date.parse("2026-11-17T12:00:00Z");
  const t = s.newSessionToken(ID, now);
  assert.equal(s.sessionMemberId(t, now + 1000), ID);
  assert.equal(s.sessionMemberId(t, now + 31 * 864e5), null, "expires after 30 days");
  assert.throws(() => s.newSessionToken("cfo", now), /member id/);
  const [v, , exp, mac] = t.split(".");
  assert.equal(s.sessionMemberId(`${v}.0e1a7c4e-00bb-4000-8000-0000000000bb.${exp}.${mac}`, now), null, "another member id fails the signature");
  assert.equal(s.sessionMemberId(`v1.${Date.now() + 1e9}.${mac}`, now), null, "old password cookies don't work");
  process.env.SESSION_SECRET = "b".repeat(44);
  assert.equal(s.sessionMemberId(t, now + 1000), null, "a new secret signs everyone out");

  // every server action checks a role; sign-in is the only exception
  const files = ["dashboard/actions.ts", "dashboard/orgActions.ts", "dashboard/connectionActions.ts", "dashboard/goalActions.ts", "dashboard/proposalActions.ts", "dashboard/chatActions.ts", "dashboard/peopleActions.ts"];
  let n = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/export async function (\w+)\([^\n]*\{\n([^\n]*\n){0,3}/g)) {
      n++;
      assert.match(m[0], /await asRole\("(approver|owner)"\)|await asRole\(\w+ \? "(approver|owner)" : "(approver|owner)"\)/, `${f}: ${m[1]} checks a role`);
    }
  }
  assert.ok(n > 60, `found ${n} actions`);
  console.log(`check:roles ok (${n} actions check a role)`);
};
run().catch((e) => { console.error(e); process.exit(1); });
