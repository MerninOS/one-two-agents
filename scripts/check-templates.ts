// Department templates (core/template-rules.ts, core/templates.ts, docs/templates.md):
// `npm run check:templates`. Pure: no database. Templates are data: every file in templates/ is
// JSON, listed once in core/templates.ts, names only core's tools and measures, installs switched
// off on its own and with any other pick, and names no business.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mergeTemplates, templateProblems, type Template } from "../core/template-rules";
import { crewProblems, installRows } from "../core/install-rules";
import { TOOLS } from "../core/tools/catalog";
import { brandWords } from "./lib/brand.mjs";

// ---- templates/ holds data only, and one reader lists it
const files = readdirSync("templates");
assert.ok(files.length >= 4, "the starting set is there");
for (const f of files) assert.match(f, /^[a-z][a-z0-9-]+\.json$/, `templates/${f}: templates are JSON files, no code`);
const reader = readFileSync("core/templates.ts", "utf8");
for (const f of files) assert.match(reader, new RegExp(`from "@/templates/${f.replace(".", "\\.")}"`), `core/templates.ts lists templates/${f}`);
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : []; });
for (const f of ["core", "agents", "dashboard", "app", "integrations", "ee", "scripts"].flatMap(walk)) {
  if (f === "core/templates.ts" || f === "scripts/check-templates.ts") continue;
  assert.doesNotMatch(readFileSync(f, "utf8"), /from "(@\/|(\.\.\/)+)templates\//, `${f} reads templates/: only core/templates.ts does`);
}
// the pack mechanism is gone
for (const gone of ["templates/index.ts", "templates/registry.ts", "templates/types.ts", "scripts/check-packs.ts"]) {
  let there = true; try { statSync(gone); } catch { there = false; }
  assert.ok(!there, `${gone} is gone (card 134)`);
}
for (const f of ["core/tools/catalog.ts", "core/measures.ts", "core/shopify-queries.ts", "core/goal-rules.ts", "core/install.ts", "dashboard/roster.ts", "dashboard/data.ts"]) {
  assert.doesNotMatch(readFileSync(f, "utf8"), /packTools|packMeasure|PACK_SHOPIFY|PACK_MEASURE_DEFS|plannedSeats|plannedIds/, `${f} has no pack hooks or planned seats`);
}

// ---- each template on its own
const all: Template[] = files.map((f) => JSON.parse(readFileSync(join("templates", f), "utf8")));
const brand = brandWords();
for (const [i, t] of all.entries()) {
  assert.deepEqual(templateProblems(t), [], `${files[i]}: shape`);
  assert.equal(`${t.id}.json`, files[i], `${files[i]}: named by its id`);
  assert.deepEqual(crewProblems(mergeTemplates([t])), [], `${t.id} installs on its own`);
  for (const a of t.agents) for (const tool of (t.specs[a.id] as { tools: string[] }).tools) assert.ok(TOOLS[tool], `${t.id}: ${a.id} names ${tool}, which isn't a core tool`);
  const text = JSON.stringify(t);
  for (const re of brand) assert.doesNotMatch(text, re, `${t.id} names a business`);
  assert.doesNotMatch(text, /\b(coffee|roast\w*|green lots?)\b/i, `${t.id} is generic`);
}
// ids are unique across templates, so any pick merges cleanly
const ids = (k: (t: Template) => string[]) => all.flatMap(k);
for (const [what, list] of [["department", ids((t) => t.departments.map((d) => d.id))], ["agent", ids((t) => t.agents.map((a) => a.id))], ["seat", ids((t) => t.seats.map((s) => s.key))]] as const) {
  assert.equal(new Set(list).size, list.length, `a ${what} id is used by two templates`);
}

// ---- picks
const by = (id: string) => all.find((t) => t.id === id)!;
const order = ["finance", "chief-of-staff", "prospecting", "email-marketing"];
const everything = mergeTemplates(order.map(by));
assert.deepEqual(crewProblems(everything), [], "all four install together");
const morning = (everything.flow.chains as { key: string; steps: { agent: string }[] }[]).find((c) => c.key === "morning")!;
assert.deepEqual(morning.steps.map((s) => s.agent), ["cfo", "chief_of_staff"], "the morning chain: the numbers, then the brief");
const briefOnly = mergeTemplates([by("chief-of-staff")]);
assert.deepEqual((briefOnly.flow.chains as { steps: { agent: string }[] }[]).flatMap((c) => c.steps.map((s) => s.agent)), ["chief_of_staff"]);
const noBrief = mergeTemplates([by("finance"), by("prospecting")]);
assert.ok((noBrief.flow.chains as { steps: { agent: string }[] }[]).every((c) => c.steps.every((s) => s.agent !== "chief_of_staff")), "a step for an agent not installed is dropped");
for (let mask = 1; mask < 16; mask++) {
  const pick = order.filter((_, i) => mask & (1 << i)).map(by);
  assert.deepEqual(crewProblems(mergeTemplates(pick)), [], `pick ${pick.map((t) => t.id).join("+")} installs`);
}
// everything installs switched off
const rows = installRows("finance+chief-of-staff+prospecting+email-marketing", everything);
assert.ok(rows.agents.every((a) => a.enabled === false), "every agent off duty");
assert.ok(rows.agent_playbooks.every((p) => p.status === "proposed"), "every playbook waits for the owner");
assert.ok((rows.crew_flow[0].flow as { chains: { on: boolean }[] }).chains.every((c) => !c.on), "every chain off");
assert.equal(rows.departments.length, 3);
// the gateway's action types still match the agents that use them
for (const id of ["cfo", "bookkeeper", "wholesale_hunter"]) assert.ok(everything.agents.some((a) => a.id === id), `${id} keeps its id: the gateway's policy names it`);
// a template that names a tool core doesn't have is refused
const bad = structuredClone(by("finance"));
(bad.specs.cfo as { tools: string[] }).tools.push("send_money_now");
assert.ok(crewProblems(mergeTemplates([bad])).some((p) => /cfo/.test(p)));
// shape checks
assert.ok(templateProblems({ id: "X", name: "", about: "" }).length >= 3);
assert.deepEqual(templateProblems(null), ["a template is an object"]);

console.log(`check:templates ok (${all.length} templates, ${everything.agents.length} agents in all)`);
