// The template installer (docs/templates.md): a crew is valid and installs switched
// off. Run: npm run check:install
import assert from "node:assert/strict";
import { crewProblems, installRows } from "../core/install-rules";
import { readSpec } from "../core/agent-spec";
import { SAMPLE_CREW } from "./fixtures/sample-crew";
import type { Crew } from "../core/template-rules";

const crew = SAMPLE_CREW;
assert.deepEqual(crewProblems(crew), [], "the sample crew installs cleanly");

let n = 0;
const rows = installRows("sample", crew, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
assert.equal(rows.agents.length, crew.agents.length);
assert.ok(rows.agents.every((a) => a.enabled === false), "every agent installs off duty");
assert.ok(rows.agent_playbooks.every((p) => p.status === "proposed" && p.auto === false), "every playbook waits for the owner");
assert.ok((rows.crew_flow[0].flow as { chains: { on: boolean }[] }).chains.every((c) => c.on === false), "every chain installs off");
assert.ok(rows.goals.every((g) => g.due_on === null && g.state === "active"), "goals install with no due date");
assert.ok(rows.agent_defs.every((d) => d.version === 1 && d.active === true && d.created_by === "template:sample"));
// a spec installs exactly as the template wrote it: readSpec dropped nothing
for (const a of crew.agents) assert.deepEqual(readSpec(crew.specs[a.id], a.id).spec, crew.specs[a.id], `${a.id}'s spec installs as written`);
// seats: parents first, ids remapped
const seen = new Set<unknown>();
for (const s of rows.seats) { assert.ok(s.parent_id === null || seen.has(s.parent_id), `${String(s.title)} comes after its parent`); seen.add(s.id); }
assert.equal(rows.seats.length, crew.seats.length);
// no policies, memory, vendors or connections: those start at code defaults or empty
assert.deepEqual(Object.keys(rows).sort(), ["agent_defs", "agent_playbooks", "agents", "crew_flow", "departments", "goals", "seats"]);

// a broken crew is refused, not half installed
const broken = (f: (c: Crew) => void) => { const c = structuredClone(crew) as Crew; f(c); return c; };
const refuses = (c: Crew, why: RegExp) => { assert.match(crewProblems(c).join("; "), why); assert.throws(() => installRows("x", c), why); };
refuses(broken((c) => { c.playbooks.cfo = [{ tool: "no_such_tool", input: {} }]; }), /isn't a tool/);
refuses(broken((c) => { c.playbooks.cfo = [{ tool: "web_search", input: {} }]; }), /isn't one of its tools/);
refuses(broken((c) => { c.seats[1].parent = "nowhere"; }), /no parent/);
refuses(broken((c) => { c.seats[0].parent = c.seats[2].key; c.seats[2].parent = c.seats[0].key; }), /loop/);
refuses(broken((c) => { (c.specs.cfo as { tools: string[] }).tools.push("send_money_now"); }), /cfo/);
refuses(broken((c) => { c.goals[0].department = "nowhere"; }), /no department/);
refuses(broken((c) => { c.goals[0].measure = "made_up"; }), /no measure/);
refuses(broken((c) => { c.agents[0].daily_budget_usd = 500; }), /daily budget/);
refuses(broken((c) => { (c.flow as { chains: { steps: { agent: string }[] }[] }).chains[0].steps[0].agent = "ghost"; }), /flow/);

console.log(`check:install ok (${crew.agents.length} agents, ${crew.seats.length} seats, ${Object.keys(crew.playbooks).length} playbooks)`);
