// Validates every gql`…` document against Shopify's Admin 2026-07 schema. The agents
// only ever talk to the Admin API, read-only. Fetch the schema once: npm run schemas
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { buildClientSchema, parse, validate } from "graphql";

const root = new URL("..", import.meta.url).pathname;
const p = join(root, ".schemas", "admin-2026-07.json");
if (!existsSync(p)) { console.error(`Missing ${p}: run npm run schemas`); process.exit(2); }
const j = JSON.parse(readFileSync(p, "utf8"));
const schema = buildClientSchema(j.data ?? j, { assumeValid: true });

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else if (/\.(ts|tsx)$/.test(f)) files.push(q); });
for (const d of ["agents", "integrations", "core"]) walk(join(root, d));

const fragments = new Map();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/const (\w+) = gql`(\s*fragment[\s\S]*?)`/g)) fragments.set(m[1], m[2]);

let docs = 0, bad = 0;
for (const f of files) {
  const rel = relative(root, f);
  for (const m of readFileSync(f, "utf8").matchAll(/gql`([\s\S]*?)`/g)) {
    if (/^\s*fragment\b/.test(m[1])) continue;
    docs++;
    try {
      const doc = m[1].replace(/\$\{(\w+)\}/g, (_, n) => { if (!fragments.has(n)) throw new Error(`unknown fragment \${${n}}`); return fragments.get(n); });
      const ast = parse(doc);
      // Read-only by construction: no mutations or subscriptions anywhere in this repo.
      const op = ast.definitions.find((d) => d.kind === "OperationDefinition" && d.operation !== "query");
      if (op) throw new Error(`${op.operation} found; agents may only query Shopify`);
      const errs = validate(schema, ast);
      if (errs.length) { bad++; console.error(`✗ ${rel}\n  ${errs.map((e) => e.message).join("\n  ")}`); }
    } catch (e) { bad++; console.error(`✗ ${rel}: ${e.message}`); }
  }
}
console.log(`${docs - bad}/${docs} GraphQL documents valid`);
process.exit(bad ? 1 : 0);
