// Template packs (docs/templates.md): core never reaches into a pack. Run: npm run check:packs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { packDirs, packTables } from "./lib/schema";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });
const importsOf = (f: string) => [...readFileSync(f, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

// Outside templates/, only the registration points import a pack, and only through templates/index.ts.
const REGISTRATION = new Set(["core/tools/catalog.ts", "core/measures.ts", "core/install.ts"]);
// The pure registry (Shopify reads, goal measure definitions) is listed by core's pure rules.
const PURE_REGISTRATION = new Set(["core/shopify-queries.ts", "core/goal-rules.ts"]);
const outside = ["core", "agents", "dashboard", "app", "integrations", "scripts"].flatMap(files).filter((f) => !f.startsWith("scripts/check-"));
let registered = 0, pure = 0;
for (const f of outside) {
  for (const m of importsOf(f)) {
    if (!/^@\/templates(\/|$)|^\.\.\/templates\//.test(m)) continue;
    if (m === "@/templates/types") continue; // the shape of a pack, not a pack
    if (m === "@/templates/registry") { assert.ok(PURE_REGISTRATION.has(f), `${f} imports @/templates/registry: only ${[...PURE_REGISTRATION].join(" and ")} list pure pack parts`); pure++; continue; }
    if (m === "@/templates") { assert.ok(REGISTRATION.has(f), `${f} imports @/templates: only ${[...REGISTRATION].join(" and ")} register packs`); registered++; continue; }
    assert.fail(`${f} reaches into a pack (${m}); go through templates/index.ts`);
  }
}
assert.equal(registered, REGISTRATION.size, "the tool list, the goal measures and the installer register packs");
assert.equal(pure, PURE_REGISTRATION.size, "the Shopify tools and the goal picker list pure pack parts");
assert.ok(!statSync("templates").isFile());
for (const gone of ["domain", "agents/cfo", "agents/chief-of-staff", "agents/wholesale-hunter", "core/green.ts", "integrations/shopify/lots.ts", "integrations/shopify/settings.ts", "integrations/shopify/stock.ts"]) {
  let there = true; try { statSync(gone); } catch { there = false; }
  assert.ok(!there, `${gone} belongs in a template pack, not core`);
}
// The books (receipts, mileage, home office, tax packets) are core: every business has them.
for (const core of ["core/books/rules.ts", "core/books/sync.ts", "core/books/prompt.ts"]) assert.ok(statSync(core).isFile(), `${core} is core's`);
for (const d of packDirs()) {
  for (const f of files(join("templates", d))) assert.doesNotMatch(readFileSync(f, "utf8"), /report_books_sync|from\("(trips|home_office|tax_packets|expense_docs)"\)/, `${f} has books code; the books are core's (core/books)`);
  for (const t of ["trips", "home_office", "tax_packets", "expense_docs"]) assert.ok(!packTables(d).includes(t), `${t} is a core table, not templates/${d}'s`);
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

// Every pack under templates/ (a folder with an index.ts). There may be none.
const registry = readFileSync("templates/index.ts", "utf8"), pureRegistry = readFileSync("templates/registry.ts", "utf8");
const catalog = readFileSync("core/tools/catalog.ts", "utf8");
const ids = (s: string) => [...s.matchAll(/^\s+id: "([a-z_]+)"/gm)].map((m) => m[1]);
const core = ids(catalog);
assert.ok(core.length > 20, "found the core tool ids");
assert.match(catalog, /\[\.\.\.TOOLS_LIST, \.\.\.packTools\(\)\]/, "the tool list adds pack tools");
const tenancy = readFileSync("core/tenancy.ts", "utf8");
let tables = 0, tools = 0;
const seenTools = new Set<string>();
// templates/registry.ts lists a pack's pure parts (Shopify reads, measure definitions) only when it has some.
for (const m of pureRegistry.matchAll(/from "\.\/([a-z0-9-]+)\//g)) assert.ok(packDirs().includes(m[1]), `templates/registry.ts lists templates/${m[1]}, which isn't a pack`);
for (const d of packDirs()) {
  assert.match(registry, new RegExp(`from "\\./${d}"`), `templates/${d} is a pack, so templates/index.ts registers it`);
  // A pack's own tables are tenant tables like any other, and only the pack reads or writes them.
  const own = packTables(d);
  for (const t of own) {
    assert.match(tenancy, new RegExp(`"${t}"`), `${t} is a pack table, so it needs a place in TENANT_TABLES`);
    for (const f of outside) assert.doesNotMatch(readFileSync(f, "utf8"), new RegExp(`from\\("${t}"\\)`), `${f} reads ${t}, a pack table`);
  }
  tables += own.length;
  // Pack tool ids are unique and don't clash with core's (catalog.ts also refuses this at load).
  let packSrc = ""; try { packSrc = readFileSync(join("templates", d, "tools.ts"), "utf8"); } catch { /* a pack with no tools */ }
  for (const id of ids(packSrc)) {
    assert.ok(!core.includes(id), `${id} is in core and templates/${d}`);
    assert.ok(!seenTools.has(id), `${id} is in two packs`);
    seenTools.add(id); tools++;
  }
}

console.log(`check:packs ok (${packDirs().length} packs, ${tools} pack tools, ${tables} pack tables, ${core.length} core tools)`);
