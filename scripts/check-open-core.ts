// Open core (LICENSE, ee/README.md): `npm run check:open-core`. Pure: reads files only.
// The AGPL app never imports the paid layer in ee/, and the license files say what covers what.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".next", ".git", "ee", ".schemas"]);
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(p);
  }
};
walk(".");
const EE = /(from\s+|import\s*\(\s*|require\(\s*)["'](@\/ee\/|(\.\.?\/)+ee\/)/;
for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), EE, `${f} imports ee/: the open-source app must be complete without it`);

assert.match(readFileSync("LICENSE", "utf8"), /^GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007/);
assert.ok(existsSync("ee/LICENSE") && /not the AGPL-3.0/.test(readFileSync("ee/LICENSE", "utf8")), "ee/ has its own license");
for (const doc of ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CLA.md", ".github/CODEOWNERS", ".github/workflows/ci.yml"]) assert.ok(existsSync(doc), `${doc} is there`);
console.log(`check:open-core ok (${files.length} files, none import ee/)`);
