// Checks Avery's chat and the Desk (core/chat-rules.ts, dashboard/desk.ts): a rule is saved only in
// the person's words, who a rule is for, the prompt, and the Desk's summary line. No database, no network.
// Run: npm run check:chat
import assert from "node:assert/strict";

import { HISTORY_TURNS, MAX_MESSAGE, chatPrompt, cleanMessage, deptNamed, inOwnWords, resolveRuleWho, savedLines } from "../core/chat-rules";
import { deskLine, firstSentence } from "../dashboard/desk";

// what the person typed: tidied, never empty, never too long
assert.deepEqual(cleanMessage("  Rowan's leads were too generic.\r\n\r\n\r\nSkip chains.  "), { text: "Rowan's leads were too generic.\n\nSkip chains." });
assert.ok("problem" in cleanMessage("   "));
assert.ok("problem" in cleanMessage("x".repeat(MAX_MESSAGE + 1)));

// a rule is saved only in the person's own words, copied from this message
const msg = "Rowan's leads this week were too generic. Skip chains.";
assert.ok(inOwnWords("Skip chains.", msg));
assert.ok(inOwnWords("skip   chains", msg), "case, spacing and the full stop don't matter");
assert.ok(inOwnWords("“Skip chains”", msg), "quotes don't matter");
assert.ok(!inOwnWords("Never contact chain coffee shops", msg), "Avery's own wording is refused");
assert.ok(!inOwnWords("Skip chains and franchises", msg), "adding words is refused");
assert.ok(!inOwnWords("go", "go"), "too short to be a rule");

// who a rule is for: an agent, a department, or everyone; nobody else
const reach = { agents: [{ id: "wholesale_hunter", name: "Rowan" }, { id: "bookkeeper", name: "Quinn" }], departments: [{ id: "sales", name: "Sales" }] };
assert.deepEqual(resolveRuleWho("rowan", reach), { scope: "agent", agentId: "wholesale_hunter", name: "Rowan" });
assert.deepEqual(resolveRuleWho("All of Sales", reach), { scope: "department", deptId: "sales", name: "Sales" });
assert.deepEqual(resolveRuleWho("the Sales team", reach), { scope: "department", deptId: "sales", name: "Sales" });
assert.deepEqual(resolveRuleWho("everyone", reach), { scope: "crew" });
assert.ok("problem" in resolveRuleWho("Tate", reach), "an agent that doesn't exist");
assert.deepEqual(deptNamed("the Sales department", reach.departments), { id: "sales" });
assert.deepEqual(deptNamed(undefined, reach.departments), { id: null });
assert.ok("problem" in deptNamed("Legal", reach.departments));

// the prompt: earlier turns (at most HISTORY_TURNS), then the new message
const hist = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? "avery" : "owner") as "owner" | "avery", text: `line ${i}` }));
const p = chatPrompt(hist, "How's Sales?", "Sunday, Nov 15, 2026-11-15");
assert.match(p, /Their new message:\nHow's Sales\?/);
assert.ok(!p.includes("line 3"), "older turns are dropped");
assert.equal((p.match(/^(Them|You): line/gm) ?? []).length, HISTORY_TURNS);
assert.doesNotMatch(chatPrompt([], "Hi", "today"), /Earlier/);

// what code says it saved: only real notes, split one per line
assert.deepEqual(savedLines([{ tool: "save_rule", ok: true, note: "Saved for Rowan in your words: “Skip chains.” | Not saved (“x”): nope." }, { tool: "file_proposal", ok: true, note: "no proposals" }]),
  ["Saved for Rowan in your words: “Skip chains.”", "Not saved (“x”): nope."]);

// the Desk's summary line, counted in code
assert.equal(deskLine(["on_track", "on_track", "behind", "no_measure"], 3, 0), "Two goals on track, one behind, one can’t be measured yet. Three proposals need you.");
assert.equal(deskLine(["behind"], 1, 2), "One goal behind. One proposal needs you and two other things.");
assert.equal(deskLine([], 0, 1), "No goals set yet. One thing needs you.");
assert.equal(deskLine(["reached"], 0, 0), "One goal on track. Nothing needs you.");
assert.equal(firstSentence("[runner, spec v2] Leads come in, but nobody follows up after day 4. I asked to hire."), "Leads come in, but nobody follows up after day 4.");
assert.equal(firstSentence("x".repeat(300), 20).length, 20);

console.log("chat: ok");
