// One Two's own checks: its crew installs cleanly, its planned seats show on the roster, and its
// coffee code has left for its own server. No database, no network. Run: npm run check:pack-one-two
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { crewProblems, installRows } from "../../core/install-rules";
import { readSpec } from "../../core/agent-spec";
import { buildCrew } from "../../dashboard/roster";
import { ONE_TWO_CREW as crew } from "./crew";
import { ONE_TWO_PLANNED as PLANNED } from "./planned";

// the crew installs cleanly, switched off, exactly as written
assert.deepEqual(crewProblems(crew), [], "the One Two pack's crew installs cleanly");
let n = 0;
const rows = installRows("one-two", crew, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
assert.equal(rows.agents.length, crew.agents.length);
assert.ok(rows.agents.every((a) => a.enabled === false), "every agent installs off duty");
assert.ok(rows.agent_defs.every((d) => d.created_by === "template:one-two"));
for (const a of crew.agents) assert.deepEqual(readSpec(crew.specs[a.id], a.id).spec, crew.specs[a.id], `${a.id}'s spec installs as written`);
assert.equal(rows.seats.length, crew.seats.length);

// planned seats: shown until an agent takes the seat
const r = buildCrew([{ ...PLANNED[0], id: "blend_coach", built: true }], PLANNED);
assert.equal(r.planned.some((p) => p.id === "blend_coach"), false);
assert.equal(r.planned.length, PLANNED.length - 1);

// card 133.5: the daily numbers, the morning brief and open orders are core's (core/daily-numbers.ts,
// core/brief, the shopify_open_orders tool); One Two's green cost and roasting stages come from its own
// server. The pack keeps no tools, tables, Shopify reads or coffee domain code of its own.
for (const f of ["tools.ts", "agents", "domain", "shopify", "docs/avery-email.md", "docs/avery-briefs-database.md"]) assert.ok(!existsSync(`templates/one-two/${f}`), `templates/one-two/${f} is gone`);
const index = readFileSync("templates/one-two/index.ts", "utf8");
assert.match(index, /tools: \[\],\n  tables: \[\],/, "the pack adds no tools or tables");
assert.match(readFileSync("templates/registry.ts", "utf8"), /PACK_SHOPIFY: readonly ShopifyQuery\[\] = \[\];/, "the pack adds no Shopify reads");

// card 133: green lots, use, cover and reorder come from One Two's own server (MerninOS/blended
// /api/agents-mcp, a custom server on Connections), and the cover goal is a goal number from it
for (const f of ["green.ts", "measures.ts", "measure-defs.ts"]) assert.ok(!existsSync(`templates/one-two/${f}`), `${f} is gone`);
for (const f of ["templates/one-two/crew.json", "templates/registry.ts"]) {
  assert.ok(!/calc_green_use|calc_green_cover|calc_reorder_amount|lowest_cover_days|shopify_green_lots/.test(readFileSync(f, "utf8")), `${f} keeps no coffee tool or measure`);
}

// card 132: Rowan's offer is core's Product facts; the pack keeps no offer of its own
assert.ok(!existsSync("templates/one-two/agents/wholesale-hunter"), "the pack's wholesale offer is gone");
for (const f of ["templates/one-two/crew.json"]) {
  assert.ok(!/wholesale_offer|PL_MIN|PL_BAGS|PL_PACK|wholesaleOf/.test(readFileSync(f, "utf8")), `${f} keeps no offer of its own`);
}
console.log(`check:pack-one-two ok (${crew.agents.length} agents, ${PLANNED.length} planned seats)`);

