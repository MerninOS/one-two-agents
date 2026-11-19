// Goal numbers from your own tools (core/goal-number-rules.ts, docs/custom-servers.md): `npm run check:goal-numbers`.
// Pure: no database, no network. Code calls the tool with its pins only and reads one field; the
// number must be a plain finite number, and only the owner sets it up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIELD, checkGoalNumber, isNumberKey, numberDefs, numberFrom, numberKey, numberSources, unpinned } from "../core/goal-number-rules";
import { acceptTools, type CustomServer, type CustomTool, type ToolOn } from "../core/custom-mcp-rules";
import { measureOf, planGoal, progress } from "../core/goal-rules";

const tool = (inputs: CustomTool["inputs"] = []): CustomTool => ({ name: "green_cover", title: "Days of green cover", about: "", readOnly: true, inputs, fingerprint: "fp1" });
const on = (p: Partial<ToolOn> = {}): ToolOn => ({ label: "Days of green cover", line: "Days each lot lasts.", pins: {}, fingerprint: "fp1", ...p });
const good = { field: "numbers.lowest_days_of_cover", label: "Lowest days of green cover", unit: "days", shape: "floor" };

// ---- the field and the setup checks
for (const f of ["value", "numbers.lowest_days_of_cover", "a.b.c", "_x"]) assert.ok(FIELD.test(f), f);
for (const f of ["", "a.b.c.d", "a..b", "1a", "a-b", "a[0]", "__proto__.x".replace("__proto__", "a b"), "x".repeat(65)]) assert.ok(!FIELD.test(f), f);
assert.deepEqual(checkGoalNumber(good, tool(), on()), { number: { field: good.field, label: good.label, unit: "days", shape: "floor" } });
assert.match((checkGoalNumber({ ...good, field: "numbers[0]" }, tool(), on()) as { problem: string }).problem, /three names/);
assert.match((checkGoalNumber({ ...good, label: "x" }, tool(), on()) as { problem: string }).problem, /name/);
assert.match((checkGoalNumber({ ...good, label: "see https://x.co" }, tool(), on()) as { problem: string }).problem, /link/);
assert.match((checkGoalNumber({ ...good, unit: "kg" }, tool(), on()) as { problem: string }).problem, /counts/);
assert.match((checkGoalNumber({ ...good, shape: "month" }, tool(), on()) as { problem: string }).problem, /total to reach/);
// code calls it with no model: every required input must be pinned
const needsDays = tool([{ name: "days", kind: "integer", required: true, about: "" }, { name: "note", kind: "text", required: false, about: "" }]);
assert.deepEqual(unpinned(needsDays, on()), ["days"]);
assert.match((checkGoalNumber(good, needsDays, on()) as { problem: string }).problem, /Pin days/);
assert.ok("number" in checkGoalNumber(good, needsDays, on({ pins: { days: 30 } })));

// ---- reading the number out of a reply: only a plain finite number counts
const reply = { data: { lots: [] }, numbers: { lowest_days_of_cover: 34, lots_under_21_days: 0 } };
assert.deepEqual(numberFrom(reply, "numbers.lowest_days_of_cover"), { value: 34 });
assert.deepEqual(numberFrom(JSON.stringify(reply), "numbers.lowest_days_of_cover"), { value: 34 }, "a JSON text reply is read the same");
assert.match((numberFrom(reply, "numbers.missing") as { error: string }).error, /no numbers.missing/);
assert.match((numberFrom({ numbers: { x: "34" } }, "numbers.x") as { error: string }).error, /isn't a number/, "a number written as text doesn't count");
assert.match((numberFrom({ x: NaN }, "x") as { error: string }).error, /isn't a number/);
assert.match((numberFrom({ x: 2e9 }, "x") as { error: string }).error, /too big/);
assert.match((numberFrom({ x: [1] }, "x.0") as { error: string }).error, /isn't a plain field|no x\.0/);
assert.match((numberFrom("not json", "x") as { error: string }).error, /isn't JSON/);
assert.match((numberFrom({ x: 1 }, "constructor") as { error: string }).error, /no constructor/, "inherited properties aren't fields");
assert.match((numberFrom({ a: { b: 5 } }, "a.b.c") as { error: string }).error, /no a\.b\.c/);

// ---- keys: stable across renames, distinct per server, tool and field, and fit the goals table's check
const k = numberKey("c_ab12cd34", "green_cover", good.field);
assert.ok(isNumberKey(k) && /^[a-z][a-z0-9_]{1,40}$/.test(k), k);
assert.equal(k, numberKey("c_ab12cd34", "green_cover", good.field));
assert.notEqual(k, numberKey("c_ab12cd35", "green_cover", good.field));
assert.notEqual(k, numberKey("c_ab12cd34", "green_cover", "numbers.lots_under_21_days"));
assert.ok(!isNumberKey("lowest_cover_days") && !isNumberKey("n_xyz"));

// ---- the picker and the goal: a number becomes a measure only for the business that set it
const server: CustomServer = { id: "c_ab12cd34", name: "Roastery stock", url: "https://example.com/api/agents-mcp", auth: "key", scopes: [], scopesOffered: [], tools: [tool()], toolsOn: { green_cover: on({ number: { field: good.field, label: good.label, unit: "days", shape: "floor" } }), other: on() } } as CustomServer;
const src = numberSources([server]);
assert.equal(src.length, 1, "only tools marked as goal numbers");
const defs = numberDefs(src);
assert.deepEqual([defs[0].key, defs[0].label, defs[0].unit, defs[0].shape, defs[0].available, defs[0].hint], [k, good.label, "days", "floor", true, "own"]);
assert.match(defs[0].how, /numbers\.lowest_days_of_cover.*Roastery stock/);
assert.equal(measureOf(k), null, "not a measure without the business's own list");
assert.equal(measureOf(k, defs)?.label, good.label);
const today = "2026-11-19";
assert.match((planGoal({ title: "Keep green stocked", measure: k, target: "45" }, today) as { error: string }).error, /Pick a measure/);
const plan = planGoal({ title: "Keep green stocked", measure: k, target: "45" }, today, defs);
assert.ok("plan" in plan && plan.plan.measure === k && plan.plan.target === 45);
const row = { measure: k, target: 45, start_value: null, due_on: null, state: "active" as const, paced_from: "2026-11-01T18:00:00Z" };
assert.equal(progress(row, { value: 50 }, today, defs).status, "on_track");
assert.equal(progress(row, { value: 30 }, today, defs).status, "behind");
assert.equal(progress(row, { error: "Roastery stock is paused" }, today, defs).status, "unreadable");
// accepting a changed tool keeps the goal number (the tool check pauses the server until then)
assert.deepEqual(acceptTools(server.toolsOn, [{ ...tool(), fingerprint: "fp2" }]).on.green_cover.number, server.toolsOn.green_cover.number);

// ---- wiring: only core/tools/custom.ts calls the tool, through the same tool check as a run
const custom = readFileSync("core/tools/custom.ts", "utf8");
assert.match(custom, /export async function readOwnNumber[\s\S]*readyCustomServers\(\[s\.serverId\]\)[\s\S]*callCustomToolData\(r\.server\.id, s\.tool, \{\}\)/);
assert.match(readFileSync("eslint.config.mjs", "utf8"), /importNames: \["callCustomTool", "callCustomToolData"\]/);
assert.match(readFileSync("dashboard/connectionActions.ts", "utf8"), /export async function customNumber\([^\n]*\n\s+const \{ me, no \} = await asRole\("owner"\)/);
assert.match(readFileSync("dashboard/components/GoalForm.tsx", "utf8"), /From your own tools/);

console.log("check:goal-numbers ok");
