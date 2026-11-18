// Checks the teach-by-reacting rules (core/reaction-rules.ts): no database, no network.
// Run: npm run check:reactions
import assert from "node:assert/strict";

import { MAX_REACTION, canReplace, planReaction, savedWords, tally, tallyWords } from "../core/reaction-rules";

const ok = (r: ReturnType<typeof planReaction>) => { if ("error" in r) throw new Error(r.error); return r.plan; };
const err = (r: ReturnType<typeof planReaction>) => ("error" in r ? r.error : null);
const id = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

// Good saves only the signal, even with words
assert.deepEqual(ok(planReaction({ verdict: "good", text: "nice" }, { hasDept: true })), { verdict: "good", text: null, rule: null });
// Not this without words: a signal, no rule
assert.equal(ok(planReaction({ verdict: "not", text: "   " }, { hasDept: true })).rule, null);
// Not this with words: a rule in his words, whitespace tidied, kept always by default as a standing order
const p = ok(planReaction({ verdict: "not", text: "  Skip   chains. " }, { hasDept: true }));
assert.deepEqual(p.rule, { scope: "agent", grp: "standing_order", keep: "always", text: "Skip chains.", replaces: null });
// an agent's own rule can be short-lived: then it's a note
assert.equal(ok(planReaction({ verdict: "not", text: "x", keep: "days_30" }, { hasDept: false })).rule?.grp, "note");
assert.equal(ok(planReaction({ verdict: "not", text: "x", keep: "next_run" }, { hasDept: false })).rule?.keep, "next_run");
// a department or crew rule is always kept, whatever was asked
const d = ok(planReaction({ verdict: "not", text: "x", scope: "department", keep: "next_run" }, { hasDept: true }));
assert.deepEqual([d.rule?.grp, d.rule?.keep], ["department", "always"]);
const c = ok(planReaction({ verdict: "not", text: "x", scope: "crew", keep: "days_30" }, { hasDept: false }));
assert.deepEqual([c.rule?.grp, c.rule?.keep], ["crew", "always"]);
// refusals
assert.match(err(planReaction({ verdict: "meh" }, { hasDept: true })) ?? "", /Good or Not this/);
assert.match(err(planReaction({ verdict: "not", text: "x", scope: "department" }, { hasDept: false })) ?? "", /isn't in a department/);
assert.match(err(planReaction({ verdict: "not", text: "x", scope: "team" }, { hasDept: true })) ?? "", /who should follow/);
assert.match(err(planReaction({ verdict: "not", text: "x", keep: "forever" }, { hasDept: true })) ?? "", /how long/);
assert.match(err(planReaction({ verdict: "not", text: "y".repeat(MAX_REACTION + 1) }, { hasDept: true })) ?? "", /Keep it to 280/);
assert.match(err(planReaction({ verdict: "not", text: "x", replaces: "drop table" }, { hasDept: true })) ?? "", /isn't one of its rules/);
assert.equal(ok(planReaction({ verdict: "not", text: "x", replaces: id }, { hasDept: true })).rule?.replaces, id);

// what a rule may replace: kept, and in the same scope
const agentRule = ok(planReaction({ verdict: "not", text: "x" }, { hasDept: true })).rule!;
const row = (o: Partial<{ state: string; grp: string; agent_id: string | null; department_id: string | null }>) => ({ state: "kept", grp: "standing_order", agent_id: "wholesale_hunter", department_id: null, ...o });
assert.equal(canReplace(row({}), agentRule, "wholesale_hunter", "sales"), true);
assert.equal(canReplace(row({ grp: "lesson" }), agentRule, "wholesale_hunter", "sales"), true);
assert.equal(canReplace(row({ agent_id: "cfo" }), agentRule, "wholesale_hunter", "sales"), false, "another agent's rule");
assert.equal(canReplace(row({ state: "forgotten" }), agentRule, "wholesale_hunter", "sales"), false);
assert.equal(canReplace(row({ grp: "working" }), agentRule, "wholesale_hunter", "sales"), false, "working memory isn't a rule");
const deptRule = d.rule!;
assert.equal(canReplace(row({ grp: "department", agent_id: null, department_id: "sales" }), deptRule, "wholesale_hunter", "sales"), true);
assert.equal(canReplace(row({ grp: "department", agent_id: null, department_id: "coffee" }), deptRule, "wholesale_hunter", "sales"), false);
assert.equal(canReplace(row({ grp: "crew", agent_id: null }), c.rule!, "wholesale_hunter", null), true);
assert.equal(canReplace(row({}), c.rule!, "wholesale_hunter", null), false, "an agent's rule isn't a crew rule");

// the scorecard
const t = tally([
  { agent_id: "a", verdict: "not", text: "third" }, { agent_id: "a", verdict: "good", text: null },
  { agent_id: "a", verdict: "not", text: null }, { agent_id: "a", verdict: "not", text: "second" },
  { agent_id: "a", verdict: "not", text: "first" }, { agent_id: "a", verdict: "not", text: "zeroth" },
  { agent_id: "b", verdict: "good", text: null },
]);
assert.deepEqual(t.a, { good: 1, not: 5, said: ["third", "second", "first"] });
assert.equal(tallyWords(t.a), "1 good · 5 not this");
assert.equal(tallyWords(undefined), null);
assert.equal(tallyWords({ good: 0, not: 0, said: [] }), null);

// what the toast says
assert.match(savedWords(p, "Rowan", "Sales"), /Rowan follows it from the next run/);
assert.match(savedWords(d, "Rowan", "Sales"), /Everyone in Sales follows it/);
assert.match(savedWords({ verdict: "good", text: null, rule: null }, "Rowan", null), /scorecard/);

console.log("reaction rules: ok");
