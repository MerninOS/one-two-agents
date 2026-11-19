// The business's own words (card 127): `npm run check:business`. Pure: no database.
// The repo names no business: the owner's name, the business's name and its address live only in the
// business's own row (Settings). The words to look for come from outside the repo (scripts/lib/brand.mjs).
import assert from "node:assert/strict";
import { brandWords } from "./lib/brand.mjs";
import { hasHistory } from "./lib/schema";
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

// no business named anywhere in the repo but the word list itself (.brand.json, private/) and the migration
// history (the public repo replaces it with the starting migration)
const BRAND = brandWords();
if (process.env.GITHUB_ACTIONS === "true" && !BRAND.length) console.warn("check:business: no BRAND_WORDS here (a fork's pull request), so the names check is skipped");
// the old history is skipped; migrations written after the baseline (the public repo's) are checked
const SKIP = new Set(["node_modules", ".git", ".next", ".schemas", ".brand.json", "private", ...(hasHistory ? ["supabase/migrations"] : [])]);
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = d === "." ? n : join(d, n);
  if (SKIP.has(p)) return [];
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js|json|md|sql|css|sh|ya?ml|txt)$/.test(n) && n !== "package-lock.json" ? [p] : [];
});
const hits: string[] = [];
for (const f of walk(".")) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const re of BRAND) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepEqual(hits, [], `the repo names a business; say "the owner" or "the business", or keep it out of the repo:\n${hits.join("\n")}`);

console.log("check:business ok");
