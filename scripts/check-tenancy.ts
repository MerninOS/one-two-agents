// Tenancy rules (docs/tenancy.md, slice 1): `npm run check:tenancy`. Pure: no network, no database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { REFRESH_MS, TOKEN_MS, orgToken, parseSigningKey } from "../core/org-token";
import { join } from "node:path";
import { hasHistory } from "./lib/schema";
import { TEST_ORG } from "./lib/test-org";
import { NO_ORG, ORGS_TABLE, TENANT_TABLES, conflictColumns, orgId, scopeClient, setRequestOrg, stampRows, updateValues, withOrg } from "../core/tenancy";

const OTHER = "0e1a7c4e-0002-4000-8000-000000000002";
const ME = TEST_ORG;

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
withOrg(ME, () => {
  const { calls, client } = fake();
  const db = scopeClient(client);
  db.from("agents").select("id, enabled").eq("id", "cfo");
  assert.deepEqual(calls, [["from", "agents"], ["select", "id, enabled"], ["eq", "org_id", ME], ["eq", "id", "cfo"]]);
});
withOrg(ME, () => {
  const { calls, client } = fake();
  scopeClient(client).from("agent_memory").update({ state: "kept" }).eq("id", "m1");
  assert.deepEqual(calls, [["from", "agent_memory"], ["update", { state: "kept" }, undefined], ["eq", "org_id", ME], ["eq", "id", "m1"]]);
});
withOrg(ME, () => {
  const { calls, client } = fake();
  scopeClient(client).from("jobs").delete().eq("id", "w1");
  assert.deepEqual(calls.slice(1, 3), [["delete", undefined], ["eq", "org_id", ME]]);
});

// insert and upsert stamp every row; upsert conflict columns start with org_id
withOrg(ME, () => {
  const { calls, client } = fake();
  const db = scopeClient(client);
  db.from("agent_runs").insert({ agent_id: "cfo" });
  db.from("run_steps").insert([{ idx: 0 }, { idx: 1 }]);
  db.from("mcp_connections").upsert({ id: "mercury" }, { onConflict: "id" });
  db.from("policies").upsert({ key: "org" });
  assert.deepEqual(calls[1], ["insert", { agent_id: "cfo", org_id: ME }, undefined]);
  assert.deepEqual(calls[3], ["insert", [{ idx: 0, org_id: ME }, { idx: 1, org_id: ME }], undefined]);
  assert.deepEqual(calls[5], ["upsert", { id: "mercury", org_id: ME }, { onConflict: "org_id,id" }]);
  assert.deepEqual(calls[7], ["upsert", { key: "org", org_id: ME }, { onConflict: undefined }]);
});
assert.equal(conflictColumns("department_id,week_of"), "org_id,department_id,week_of");
assert.equal(conflictColumns(" org_id , id "), "org_id,id");
assert.equal(conflictColumns(undefined), undefined);

// another org's rows are refused, never moved; a row read back and saved again keeps working
assert.throws(() => stampRows({ id: "x", org_id: OTHER }, ME), /another org/);
assert.throws(() => stampRows([{ id: "a" }, { id: "b", org_id: OTHER }], ME), /another org/);
assert.deepEqual(stampRows({ id: "x", org_id: ME }, ME), { id: "x", org_id: ME });
assert.throws(() => stampRows("nope", ME));
assert.deepEqual(updateValues({ merchant: "Canva", org_id: ME }, ME), { merchant: "Canva" });
assert.throws(() => updateValues({ org_id: OTHER }, ME), /can't be changed/);
withOrg(ME, () => {
  const { client } = fake();
  assert.throws(() => scopeClient(client).from("expense_docs").update({ org_id: OTHER }), /can't be changed/);
});

// unknown tables, rpc and schema are refused; orgs reads only the current org and is never written
withOrg(ME, () => {
  const { calls, client } = fake();
  const db = scopeClient(client);
  assert.throws(() => db.from("auth_users"), /isn't a tenant table/);
  assert.throws(() => (db as unknown as { rpc: () => void }).rpc(), /skips org scoping/);
  db.from(ORGS_TABLE).select("name");
  assert.deepEqual(calls.slice(-2), [["select", "name"], ["eq", "id", ME]]);
  for (const verb of ["insert", "upsert", "update", "delete"] as const) {
    assert.throws(() => (db.from(ORGS_TABLE) as unknown as Record<string, (x?: unknown) => unknown>)[verb]({ name: "x" }), /not written/);
  }
  assert.deepEqual(db.storage.from("receipts"), { bucket: "receipts" }, "storage passes through");
});

// slice 2b: with tablesFor, tables go through the org's own client; storage stays on the base client
withOrg(ME, () => {
  const base = fake(), mine = fake(), theirs = fake();
  const db = scopeClient(base.client, (org) => (org === ME ? mine.client : theirs.client));
  db.from("agents").select("id");
  withOrg(OTHER, () => db.from("agents").select("id"));
  assert.deepEqual(base.calls, [], "tables never use the base client");
  assert.deepEqual(mine.calls, [["from", "agents"], ["select", "id"], ["eq", "org_id", ME]]);
  assert.deepEqual(theirs.calls, [["from", "agents"], ["select", "id"], ["eq", "org_id", OTHER]]);
  assert.deepEqual(db.storage.from("receipts"), { bucket: "receipts" });
});

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

// the current org: none by default (work is refused, card 135), withOrg for the work inside it (sync
// and async), nested, then restored
assert.throws(() => withOrg("not-a-uuid", () => 1), /uuid/);
const asyncCheck = (async () => {
  await assert.rejects(orgId(), (e: Error) => e.message === NO_ORG, "no business named: refused");
  {
    const { calls, client } = fake();
    await assert.rejects(async () => { await scopeClient(client).from("agents").select("id"); }, /no business named/);
    assert.deepEqual(calls, [], "a query with no business never reaches the database");
  }
  const { calls, client } = fake();
  const db = scopeClient(client);
  await withOrg(OTHER, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await orgId(), OTHER);
    db.from("goals").select("id");
    withOrg(ME, () => db.from("goals").select("id"));
    db.from("goals").insert({ id: "g" });
  });
  await assert.rejects(orgId(), /no business named/, "restored: none again");
  assert.deepEqual(calls.filter((c) => c[0] === "eq" || c[0] === "insert"), [
    ["eq", "org_id", OTHER], ["eq", "org_id", ME], ["insert", { id: "g", org_id: OTHER }, undefined],
  ]);

  // slice 8.1: in a request, the org comes from the signed-in member's session, read when the query
  // is awaited; withOrg still wins; a request with nobody signed in is refused
  let fromCookie: string | null = OTHER;
  setRequestOrg(async () => fromCookie);
  const r = fake();
  const rdb = scopeClient(r.client);
  const q = rdb.from("agents").select("id").eq("id", "cfo");
  assert.deepEqual(r.calls, [], "nothing runs until the query is awaited");
  await q;
  assert.deepEqual(r.calls, [["from", "agents"], ["select", "id"], ["eq", "org_id", OTHER], ["eq", "id", "cfo"]]);
  r.calls.length = 0;
  await rdb.from("goals").insert({ id: "g2" }).select("id");
  assert.deepEqual(r.calls[1], ["insert", { id: "g2", org_id: OTHER }, undefined], "inserts are stamped with the member's org");
  await assert.rejects(async () => { await rdb.from("goals").insert({ id: "g3", org_id: ME }); }, /another org/);
  r.calls.length = 0;
  withOrg(ME, () => rdb.from("goals").select("id"));
  assert.deepEqual(r.calls.slice(0, 3), [["from", "goals"], ["select", "id"], ["eq", "org_id", ME]], "withOrg runs at once, as before");
  assert.equal(await orgId(), OTHER);
  fromCookie = null;
  await assert.rejects(orgId(), /no business named/, "nobody signed in: refused, never the first business");
  await assert.rejects(async () => { await rdb.from("agents").select("id"); }, /no business named/);
  fromCookie = "not-a-uuid";
  await assert.rejects(orgId(), /no business named/);
  // no file guesses the org synchronously
  for (const f of ["core/jobs.ts", "core/business.ts", "core/trace.ts", "core/status.ts", "integrations/mcp.ts", "dashboard/actions.ts"]) {
    assert.ok(!/currentOrgId/.test(readFileSync(f, "utf8")), `${f} reads the org with await orgId()`);
  }
})();

// No business is special by being first (card 135): HOME_ORG_ID is the fresh install's first business,
// named only where it is made (the baseline) and where its first owner is made (dashboard/signin.ts)
{
  // the checks themselves name it to look for it
  const ALLOWED = new Set(["core/tenancy.ts", "dashboard/signin.ts", "scripts/baseline.mjs"]);
  const isCheck = (f: string) => /^scripts\/check-[a-z-]+\.ts$/.test(f) || f === "ee/check.ts";
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(p)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [p] : [];
  });
  const users = ["app", "core", "dashboard", "integrations", "agents", "ee", "scripts"].flatMap(walk).filter((f) => /HOME_ORG_ID/.test(readFileSync(f, "utf8")) && !isCheck(f));
  assert.deepEqual(users.filter((f) => !ALLOWED.has(f)), [], "only the first owner and the baseline name the first business");
  const signin = readFileSync("dashboard/signin.ts", "utf8");
  assert.equal(signin.match(/HOME_ORG_ID/g)?.length, 2, "signin.ts imports it and uses it once: the first owner");
  assert.match(signin, /if \(found\.length\) return found;\n\s+const first = await withOrg\(HOME_ORG_ID, \(\) => memberToSignIn\(email\)\);/, "only while the address belongs to no business");
}

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
