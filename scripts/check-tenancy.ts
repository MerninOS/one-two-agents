// Tenancy rules (docs/tenancy.md, slice 1): `npm run check:tenancy`. Pure: no network, no database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { REFRESH_MS, TOKEN_MS, orgToken, parseSigningKey } from "../core/org-token";
import { join } from "node:path";
import { hasHistory } from "./lib/schema";
import { HOME_ORG_ID, ORGS_TABLE, TENANT_TABLES, conflictColumns, currentOrgId, scopeClient, stampRows, updateValues, withOrg } from "../core/tenancy";

const OTHER = "0e1a7c4e-0002-4000-8000-000000000002";

// A fake client: records every call made on it, the way supabase-js chains them.
type Call = [string, ...unknown[]];
function fake() {
  const calls: Call[] = [];
  type B = { [m: string]: (...args: unknown[]) => B };
  const builder = (): B => {
    const b: B = {};
    for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "order", "limit", "single"]) {
      b[m] = (...args: unknown[]) => { calls.push([m, ...args]); return b; };
    }
    return b;
  };
  const client = {
    from: (table: string) => { calls.push(["from", table]); return builder(); },
    rpc: () => { calls.push(["rpc"]); },
    storage: { from: (bucket: string) => ({ bucket }) },
  };
  return { calls, client };
}

// select, update and delete are filtered by the current org; the caller's own filters follow
{
  const { calls, client } = fake();
  const db = scopeClient(client);
  db.from("agents").select("id, enabled").eq("id", "cfo");
  assert.deepEqual(calls, [["from", "agents"], ["select", "id, enabled"], ["eq", "org_id", HOME_ORG_ID], ["eq", "id", "cfo"]]);
}
{
  const { calls, client } = fake();
  scopeClient(client).from("agent_memory").update({ state: "kept" }).eq("id", "m1");
  assert.deepEqual(calls, [["from", "agent_memory"], ["update", { state: "kept" }, undefined], ["eq", "org_id", HOME_ORG_ID], ["eq", "id", "m1"]]);
}
{
  const { calls, client } = fake();
  scopeClient(client).from("jobs").delete().eq("id", "w1");
  assert.deepEqual(calls.slice(1, 3), [["delete", undefined], ["eq", "org_id", HOME_ORG_ID]]);
}

// insert and upsert stamp every row; upsert conflict columns start with org_id
{
  const { calls, client } = fake();
  const db = scopeClient(client);
  db.from("agent_runs").insert({ agent_id: "cfo" });
  db.from("run_steps").insert([{ idx: 0 }, { idx: 1 }]);
  db.from("mcp_connections").upsert({ id: "mercury" }, { onConflict: "id" });
  db.from("policies").upsert({ key: "org" });
  assert.deepEqual(calls[1], ["insert", { agent_id: "cfo", org_id: HOME_ORG_ID }, undefined]);
  assert.deepEqual(calls[3], ["insert", [{ idx: 0, org_id: HOME_ORG_ID }, { idx: 1, org_id: HOME_ORG_ID }], undefined]);
  assert.deepEqual(calls[5], ["upsert", { id: "mercury", org_id: HOME_ORG_ID }, { onConflict: "org_id,id" }]);
  assert.deepEqual(calls[7], ["upsert", { key: "org", org_id: HOME_ORG_ID }, { onConflict: undefined }]);
}
assert.equal(conflictColumns("department_id,week_of"), "org_id,department_id,week_of");
assert.equal(conflictColumns(" org_id , id "), "org_id,id");
assert.equal(conflictColumns(undefined), undefined);

// another org's rows are refused, never moved; a row read back and saved again keeps working
assert.throws(() => stampRows({ id: "x", org_id: OTHER }, HOME_ORG_ID), /another org/);
assert.throws(() => stampRows([{ id: "a" }, { id: "b", org_id: OTHER }], HOME_ORG_ID), /another org/);
assert.deepEqual(stampRows({ id: "x", org_id: HOME_ORG_ID }, HOME_ORG_ID), { id: "x", org_id: HOME_ORG_ID });
assert.throws(() => stampRows("nope", HOME_ORG_ID));
assert.deepEqual(updateValues({ merchant: "Canva", org_id: HOME_ORG_ID }, HOME_ORG_ID), { merchant: "Canva" });
assert.throws(() => updateValues({ org_id: OTHER }, HOME_ORG_ID), /can't be changed/);
{
  const { client } = fake();
  assert.throws(() => scopeClient(client).from("expense_docs").update({ org_id: OTHER }), /can't be changed/);
}

// unknown tables, rpc and schema are refused; orgs reads only the current org and is never written
{
  const { calls, client } = fake();
  const db = scopeClient(client);
  assert.throws(() => db.from("auth_users"), /isn't a tenant table/);
  assert.throws(() => (db as unknown as { rpc: () => void }).rpc(), /skips org scoping/);
  db.from(ORGS_TABLE).select("name");
  assert.deepEqual(calls.slice(-2), [["select", "name"], ["eq", "id", HOME_ORG_ID]]);
  for (const verb of ["insert", "upsert", "update", "delete"] as const) {
    assert.throws(() => (db.from(ORGS_TABLE) as unknown as Record<string, (x?: unknown) => unknown>)[verb]({ name: "x" }), /not written/);
  }
  assert.deepEqual(db.storage.from("receipts"), { bucket: "receipts" }, "storage passes through");
}

// slice 2b: with tablesFor, tables go through the org's own client; storage stays on the base client
{
  const base = fake(), mine = fake(), theirs = fake();
  const db = scopeClient(base.client, currentOrgId, (org) => (org === HOME_ORG_ID ? mine.client : theirs.client));
  db.from("agents").select("id");
  withOrg(OTHER, () => db.from("agents").select("id"));
  assert.deepEqual(base.calls, [], "tables never use the base client");
  assert.deepEqual(mine.calls, [["from", "agents"], ["select", "id"], ["eq", "org_id", HOME_ORG_ID]]);
  assert.deepEqual(theirs.calls, [["from", "agents"], ["select", "id"], ["eq", "org_id", OTHER]]);
  assert.deepEqual(db.storage.from("receipts"), { bucket: "receipts" });
}

// org tokens: ES256, signed by our key, holding one org, expiring
{
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: "test-kid" };
  const k = parseSigningKey(JSON.stringify(jwk));
  const now = Date.parse("2026-11-17T12:00:00Z");
  const { token, exp } = orgToken(k, OTHER, now);
  const [h, b, sig] = token.split(".");
  assert.ok(verify("sha256", Buffer.from(`${h}.${b}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")), "signature verifies");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", typ: "JWT", kid: "test-kid" });
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  assert.deepEqual({ role: claims.role, aud: claims.aud, sub: claims.sub, org_id: claims.org_id }, { role: "authenticated", aud: "authenticated", sub: OTHER, org_id: OTHER });
  assert.equal(exp, now + TOKEN_MS);
  assert.ok(REFRESH_MS < TOKEN_MS);
  assert.throws(() => orgToken(k, "not-a-uuid", now), /uuid/);
  assert.throws(() => parseSigningKey("nope"), /isn’t JSON/);
  assert.throws(() => parseSigningKey(JSON.stringify({ ...jwk, d: undefined })), /ES256 private key/);
  assert.throws(() => parseSigningKey(JSON.stringify({ ...jwk, kid: undefined })), /kid/);
}

// the current org: home by default, withOrg for the work inside it (sync and async), nested, then restored
assert.equal(currentOrgId(), HOME_ORG_ID);
assert.throws(() => withOrg("not-a-uuid", () => 1), /uuid/);
const asyncCheck = (async () => {
  const { calls, client } = fake();
  const db = scopeClient(client);
  await withOrg(OTHER, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentOrgId(), OTHER);
    db.from("goals").select("id");
    withOrg(HOME_ORG_ID, () => db.from("goals").select("id"));
    db.from("goals").insert({ id: "g" });
  });
  assert.equal(currentOrgId(), HOME_ORG_ID);
  assert.deepEqual(calls.filter((c) => c[0] === "eq" || c[0] === "insert"), [
    ["eq", "org_id", OTHER], ["eq", "org_id", HOME_ORG_ID], ["insert", { id: "g", org_id: OTHER }, undefined],
  ]);
})();

// The migration history (the public repo ships only the baseline: check:baseline covers it there)
if (hasHistory) {
  // every table the migrations create is a tenant table (or orgs); tables made after slice 1 carry org_id
  const dir = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const SLICE1 = "20261202090000_orgs.sql";
  assert.ok(files.includes(SLICE1), "tenancy migration present");
  const created = new Map<string, string>();
  const dropped = new Set<string>();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      created.set(m[1], f);
      dropped.delete(m[1]);
      if (f > SLICE1) assert.match(m[2], /\borg_id\s+uuid\s+not null\b[^,]*references orgs/i, `${f}: table ${m[1]} needs org_id uuid not null references orgs`);
    }
    for (const m of sql.matchAll(/drop table (?:if exists )?(?:public\.)?([a-z_]+)/gi)) dropped.add(m[1]);
  }
  const live = [...created.keys()].filter((t) => !dropped.has(t) && t !== ORGS_TABLE).sort();
  assert.deepEqual(live, [...TENANT_TABLES].sort(), "TENANT_TABLES lists exactly the tables the migrations leave");
  const slice1 = readFileSync(join(dir, SLICE1), "utf8");
  // tables from before slice 1 got org_id there; later ones carry it in their own create table (checked above)
  for (const t of TENANT_TABLES) if ((created.get(t) ?? "") < SLICE1) assert.ok(slice1.includes(`'${t}'`), `slice 1 adds org_id to ${t}`);

  // slice 2b: every tenant table has the org_rows policy, from the policies migration or its own create
  const POLICIES = "20261204090000_org_policies.sql";
  assert.ok(files.includes(POLICIES), "policies migration present");
  const policySql = readFileSync(join(dir, POLICIES), "utf8");
  assert.match(policySql, /create policy org_self on orgs/);
  for (const t of TENANT_TABLES) {
    const from = created.get(t) ?? "";
    if (from < POLICIES) assert.ok(policySql.includes(`'${t}'`), `${POLICIES} adds org_rows to ${t}`);
    else assert.match(readFileSync(join(dir, from), "utf8"), new RegExp(`create policy \\w+ on ${t}\\b[\\s\\S]*org_id = \\(select public\\.jwt_org_id\\(\\)\\)`), `${from}: ${t} needs a policy holding it to jwt_org_id()`);
  }
}

asyncCheck.then(() => console.log(`check:tenancy ok (${TENANT_TABLES.length} tenant tables)`), (e) => { console.error(e); process.exit(1); });
