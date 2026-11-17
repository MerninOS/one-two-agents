// Template packs (docs/templates.md): core never reaches into a pack. Run: npm run check:packs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });
const importsOf = (f: string) => [...readFileSync(f, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

// Outside templates/, only the registration points import a pack, and only through templates/index.ts.
const REGISTRATION = new Set(["core/tools/catalog.ts", "core/measures.ts"]);
const outside = ["core", "agents", "dashboard", "app", "integrations", "scripts"].flatMap(files).filter((f) => !f.startsWith("scripts/check-"));
let registered = 0;
for (const f of outside) {
  for (const m of importsOf(f)) {
    if (!/^@\/templates(\/|$)|^\.\.\/templates\//.test(m)) continue;
    if (m === "@/templates") { assert.ok(REGISTRATION.has(f), `${f} imports @/templates: only ${[...REGISTRATION].join(" and ")} register packs`); registered++; continue; }
    assert.fail(`${f} reaches into a pack (${m}); go through templates/index.ts`);
  }
}
assert.equal(registered, REGISTRATION.size, "the tool list and the goal measures register packs");
assert.ok(!statSync("templates").isFile());
for (const gone of ["domain", "agents/cfo", "agents/chief-of-staff", "agents/bookkeeper", "agents/wholesale-hunter", "core/green.ts", "integrations/shopify/lots.ts", "integrations/shopify/settings.ts", "integrations/shopify/stock.ts"]) {
  let there = true; try { statSync(gone); } catch { there = false; }
  assert.ok(!there, `${gone} moved into templates/one-two`);
}

// A pack reaches core only through core's public pieces: it reads through callMcpTool like core
// does and proposes actions through core/gateway's front door (an approval card), never the vault,
// the gateway's insides, a write tool, a custom tool or one of our servers directly.
for (const f of files("templates")) {
  for (const m of importsOf(f)) {
    assert.ok(!/core\/vault|core\/gateway\/|shopify-server|gmail-server|notion-server|mercury-files-server/.test(m), `${f} imports ${m}`);
  }
  assert.doesNotMatch(readFileSync(f, "utf8"), /\b(callWriteTool|callCustomTool|callLocalTool)\b/, `${f} calls past the read path`);
}

// A pack's own tables are tenant tables like any other, and only the pack reads or writes them.
const tenancy = readFileSync("core/tenancy.ts", "utf8");
const packTables = [...readFileSync("templates/one-two/index.ts", "utf8").matchAll(/tables: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
assert.ok(packTables.length >= 4, "found the pack's tables");
for (const t of packTables) {
  assert.match(tenancy, new RegExp(`"${t}"`), `${t} is a pack table, so it needs a place in TENANT_TABLES`);
  for (const f of outside) assert.doesNotMatch(readFileSync(f, "utf8"), new RegExp(`from\\("${t}"\\)`), `${f} reads ${t}, a pack table`);
}

// Pack tool ids are unique and don't clash with core's (catalog.ts also refuses this at load).
const catalog = readFileSync("core/tools/catalog.ts", "utf8"), pack = readFileSync("templates/one-two/tools.ts", "utf8");
const ids = (s: string) => [...s.matchAll(/^\s+id: "([a-z_]+)"/gm)].map((m) => m[1]);
const core = ids(catalog), one = ids(pack);
assert.ok(core.length > 20 && one.length >= 10, "found the tool ids");
for (const id of one) assert.ok(!core.includes(id), `${id} is in core and the pack`);
assert.equal(new Set(one).size, one.length, "pack tool ids are unique");
assert.match(catalog, /\[\.\.\.TOOLS_LIST, \.\.\.packTools\(\)\]/, "the tool list adds pack tools");

console.log(`check:packs ok (${one.length} pack tools, ${packTables.length} pack tables, ${core.length} core tools)`);
