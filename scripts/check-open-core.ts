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

// Extension slots (docs/extensions.md): one door, a default for every slot, and only the build
// config swaps the default for ee/index.ts.
const SLOT_IMPORT = /(from\s+|import\s*\(\s*)["']operator-extensions["']/;
for (const f of files) if (f !== "core/extensions.ts") assert.doesNotMatch(readFileSync(f, "utf8"), SLOT_IMPORT, `${f} imports operator-extensions: only core/extensions.ts may`);
assert.match(readFileSync("core/extensions.ts", "utf8"), SLOT_IMPORT, "core/extensions.ts is the door to the slots");
const slots = [...(readFileSync("core/extension-types.ts", "utf8").match(/SLOTS = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
assert.ok(slots.length >= 4, "core/extension-types.ts lists its SLOTS");
const fills = (f: string) => { const s = readFileSync(f, "utf8"); for (const k of slots) assert.match(s, new RegExp(`^\\s+${k}[:,]`, "m"), `${f} fills the ${k} slot`); return s; };
const open = fills("core/extensions/none.ts");
assert.match(open, /edition: "open"/, "the default edition is open");
assert.match(open, /planBlock: async \(\) => null/, "the open edition blocks nothing");
if (existsSync("ee/index.ts")) assert.match(fills("ee/index.ts"), /edition: "cloud"/, "ee/index.ts is the cloud edition");
assert.match(readFileSync("tsconfig.json", "utf8"), /"operator-extensions": \["\.\/core\/extensions\/none\.ts"\]/, "tsconfig points the slots at the open edition");
const nextConfig = readFileSync("next.config.ts", "utf8");
assert.match(nextConfig, /cloud \? \{ turbopack: \{ resolveAlias: \{ "operator-extensions": "\.\/ee\/index\.ts" \} \} \}/, "only OPERATOR_EDITION=cloud swaps in ee/index.ts");
// every place that could need a plan asks it (each is a no-op in the open edition)
assert.match(open, /api: \{\}/, "the open edition has no extra routes");
assert.equal(readFileSync("dashboard/peopleActions.ts", "utf8").match(/await membersChanged\(\)/g)?.length, 2, "adding and removing a person both tell the paid layer");
const asks: Record<string, string> = { "core/runs.ts": "run", "dashboard/peopleActions.ts": "invite", "dashboard/actions.ts": "agent_on", "dashboard/connectionActions.ts": "custom_server" };
for (const [f, kind] of Object.entries(asks)) assert.match(readFileSync(f, "utf8"), new RegExp(`planBlock\\(\\{ kind: "${kind}"`), `${f} asks the plan (${kind})`);
assert.equal(readFileSync("dashboard/actions.ts", "utf8").match(/planBlock\(\{ kind: "agent_on"/g)?.length, 2, "both ways to put agents on duty ask the plan");

assert.match(readFileSync("LICENSE", "utf8"), /^GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007/);
assert.ok(existsSync("ee/LICENSE") && /not the AGPL-3.0/.test(readFileSync("ee/LICENSE", "utf8")), "ee/ has its own license");
for (const doc of ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CLA.md", ".github/CODEOWNERS", ".github/workflows/ci.yml"]) assert.ok(existsSync(doc), `${doc} is there`);
console.log(`check:open-core ok (${files.length} files, none import ee/; ${slots.length} slots, each with a default)`);
