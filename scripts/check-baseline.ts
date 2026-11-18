// The clean starting migration (card 127): `npm run check:baseline`. Pure: reads files, no database.
// supabase/baseline/operator_baseline.sql is what a fresh install starts from (scripts/baseline.mjs
// makes it from a schema-only dump). It must hold every tenant table with org_id, row level security
// and the org_rows policy, and no rows but the receipts bucket and an empty home org. A migration
// that adds a table fails here until the baseline is made again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOME_ORG_ID, ORGS_TABLE, TENANT_TABLES } from "../core/tenancy";
import { JOB_KINDS } from "../core/job-rules";
import { MCP_EVENTS } from "../core/mcp-rules";
import { BASELINE, isEeTable, packDirs, packTables } from "./lib/schema";
import { brandWords } from "./lib/brand.mjs";

const sql = readFileSync(BASELINE, "utf8");
// a pack's own tables are the pack's, and ee_* tables the paid layer's, not core's: they stay out of the baseline
const packOnly = new Set(packDirs().flatMap(packTables));
const eeOnly = TENANT_TABLES.filter(isEeTable);
const coreTables = TENANT_TABLES.filter((t) => !packOnly.has(t) && !isEeTable(t));
const tables = [...sql.matchAll(/^CREATE TABLE public\.([a-z_]+) \(([\s\S]*?)\n\);/gm)].map((m) => ({ name: m[1], body: m[2] }));
const names = tables.map((t) => t.name).sort();
assert.deepEqual(names, [...coreTables, ORGS_TABLE].sort(), "the baseline has exactly core's tenant tables and orgs: run scripts/baseline.mjs again after a migration adds or drops a table");

for (const t of tables) {
  assert.match(sql, new RegExp(`^ALTER TABLE public\\.${t.name} ENABLE ROW LEVEL SECURITY;`, "m"), `${t.name}: row level security`);
  if (t.name === ORGS_TABLE) continue;
  assert.match(t.body, /^\s+org_id uuid NOT NULL,?$/m, `${t.name}: org_id uuid not null`);
  assert.match(sql, new RegExp(`^CREATE POLICY org_rows ON public\\.${t.name} TO authenticated USING \\(\\(org_id = \\( SELECT public\\.jwt_org_id\\(\\)`, "m"), `${t.name}: the org_rows policy`);
  assert.match(sql, new RegExp(`^ALTER TABLE ONLY public\\.${t.name}\\n\\s+ADD CONSTRAINT \\w+ FOREIGN KEY \\(org_id\\) REFERENCES public\\.orgs\\(id\\)`, "m"), `${t.name}: org_id references orgs`);
}
assert.match(sql, /^CREATE POLICY org_self ON public\.orgs /m, "orgs: each org reads only its own row");

const inserts = [...sql.matchAll(/^INSERT INTO ([a-z_.]+)/gm)].map((m) => m[1]);
assert.deepEqual(inserts, ["storage.buckets", "public.orgs"], "no rows but the receipts bucket and the home org");
assert.ok(sql.includes(`VALUES ('${HOME_ORG_ID}', 'home', 'My business')`), "the home org starts empty and unnamed");
const rest = sql.replace(HOME_ORG_ID, "");
assert.doesNotMatch(rest, /0e1a7c4e/, "the home org id appears only in its own row");
for (const re of brandWords()) assert.doesNotMatch(rest, re, "the baseline names no business");
assert.doesNotMatch(sql, /^ALTER DEFAULT PRIVILEGES /m, "no default privileges: Supabase sets its own");

// what the history checks (check:jobs, check:mcp, check:audit) read from single migrations
const quoted = (constraint: string) => [...(new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*)\\),?$`, "m").exec(sql)?.[1] ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
assert.deepEqual(quoted("jobs_kind_check"), [...JOB_KINDS], "jobs.kind allows exactly the job kinds");
assert.deepEqual(quoted("mcp_connection_events_event_check"), [...MCP_EVENTS], "connection events allow exactly MCP_EVENTS");
assert.match(sql, /^ALTER TABLE ONLY public\.jobs\n\s+ADD CONSTRAINT \w+ UNIQUE \(org_id, dedupe_key\)/m, "a job is queued once per dedupe key");
const auditGrants = [...sql.matchAll(/^GRANT (\S+) ON TABLE public\.audit_log TO /gm)].map((m) => m[1]);
assert.ok(auditGrants.length && auditGrants.every((g) => !/ALL|UPDATE|DELETE|TRUNCATE/.test(g)), "the audit log can't be changed or emptied");

console.log(`check:baseline ok (${tables.length} tables, ${packOnly.size} pack tables left to their packs, ${eeOnly.length} to ee/)`);
