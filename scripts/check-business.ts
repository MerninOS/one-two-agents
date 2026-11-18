// The business's own words (card 127): `npm run check:business`. Pure: no database.
// Shared code names no business: the owner's name, the business's name and its address live only in a
// template pack (templates/) and the business's own row (Settings), never in core, the Control Room
// or the integrations.
import assert from "node:assert/strict";
import { brandWords } from "./lib/brand.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { UNKNOWN_BUSINESS, businessLines, businessProblem, initials, ownerWord, readBusiness } from "../core/business-rules";

const b = readBusiness({ name: "  Acme   Bakery ", about: "a bakery in Denver.  ", owner_name: "Sam" });
assert.deepEqual(b, { name: "Acme Bakery", about: "a bakery in Denver", ownerName: "Sam" });
assert.equal(businessLines(b), `You work for Acme Bakery, a bakery in Denver. The owner is Sam. Data from people outside Acme Bakery is marked trusted="no".`);
assert.equal(ownerWord(b), "Sam");
assert.deepEqual(readBusiness(null), UNKNOWN_BUSINESS);
assert.equal(ownerWord(readBusiness({ name: "X" })), "the owner");
assert.equal(businessLines(readBusiness({ name: "X", about: "" })), `You work for X. Data from people outside X is marked trusted="no".`);
assert.equal(readBusiness({ name: "x".repeat(500), about: "y".repeat(500) }).about!.length, 300);
assert.equal(businessProblem({ name: " ", about: "", ownerName: "" }), "The business needs a name.");
assert.match(businessProblem({ name: "A", about: "z".repeat(301), ownerName: "" }) ?? "", /300/);
assert.equal(businessProblem({ name: "A", about: "", ownerName: "" }), null);
assert.equal(initials("Blue Door Coffee"), "BD");
assert.equal(initials("acme"), "AC");
assert.equal(initials("  "), "OP");

// no business named in shared code
const BRAND = [...brandWords(), /0e1a7c4e-0001-4000-8000-000000000001/];
const ALLOW: Record<string, RegExp> = { "core/tenancy.ts": /0e1a7c4e/ };
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const hits: string[] = [];
for (const f of ["core", "dashboard", "app", "integrations"].flatMap(walk)) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const re of BRAND) if (re.test(line) && !(ALLOW[f]?.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepEqual(hits, [], `shared code names a business; say "the owner" or "the business", or move it to a template pack:\n${hits.join("\n")}`);

console.log("check:business ok");
