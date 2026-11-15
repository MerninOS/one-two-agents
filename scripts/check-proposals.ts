// Checks proposals (core/proposal-rules.ts and the propose tool): what a proposal may hold, that it
// never hands out an action, and that a hire becomes a spec code accepts. No database, no network.
// Run: npm run check:proposals
import assert from "node:assert/strict";

import { BOARD_CARD, BRAINS, boardCard, notionPageId, HIRE_STEPS, MAX_HIRE_TOOLS, hireSpec, planProposal, proposalTitle, toolIds, toolInfoOf, type ProposalPlan } from "../core/proposal-rules";
import { readSpec } from "../core/agent-spec";
import { TOOLS } from "../core/tools/catalog";
import { checkInput } from "../core/tools/types";

const tools = toolInfoOf(TOOLS);
const plan = (i: Record<string, unknown>) => { const r = planProposal(i, tools); if ("problem" in r) throw new Error(r.problem); return r; };
const problem = (i: Record<string, unknown>) => { const r = planProposal(i, tools); return "problem" in r ? r.problem : null; };
const why = "Leads sit in Replied for 9 days on average, per Your team.";
const hire = { kind: "hire", why, name: "Tate", seat: "Follow-ups", job: "Keeps replied wholesale leads moving toward a tasting.", each_run: "Read the leads list, find leads in Replied for 3 days or more, and say which need a nudge.", good_result: "A short list of leads to nudge, with why.", tools: "wholesale_leads_recent, goal_progress, wholesale_leads_recent" };

// a hire: words tidied, tools without repeats, quick brain unless asked
const h = plan(hire);
assert.equal(h.why, why);
assert.deepEqual(h.plan, { kind: "hire", name: "Tate", seat: "Follow-ups", job: hire.job, eachRun: hire.each_run, goodResult: hire.good_result, tools: ["wholesale_leads_recent", "goal_progress"], brain: "quick" });
assert.equal(plan({ ...hire, brain: "thinking" }).plan.kind === "hire" && (plan({ ...hire, brain: "thinking" }).plan as Extract<ProposalPlan, { kind: "hire" }>).brain, "thinking");
assert.equal(proposalTitle(h.plan), "Hire Tate for Follow-ups");

// refusals: an action is never handed out, by a hire or a grant
assert.match(problem({ ...hire, tools: "wholesale_leads_recent, gmail_draft_lead" }) ?? "", /action/);
assert.match(problem({ kind: "grant_tool", why, agent: "Rowan", tools: "mercury_propose_annotation" }) ?? "", /action/);
assert.match(problem({ ...hire, tools: "send_money" }) ?? "", /isn't on the tool list/);
assert.match(problem({ ...hire, tools: "" }) ?? "", /at least one/);
assert.match(problem({ ...hire, tools: Object.keys(TOOLS).filter((t) => TOOLS[t].kind === "read").slice(0, MAX_HIRE_TOOLS + 1).join(",") }) ?? "", /at most/);
assert.match(problem({ ...hire, name: "tate" }) ?? "", /first name/);
assert.match(problem({ ...hire, name: "Robert'); drop table agents;--" }) ?? "", /first name/);
assert.match(problem({ ...hire, why: "because" }) ?? "", /why/);
assert.match(problem({ ...hire, kind: "fire_everyone" }) ?? "", /kind must be/);
assert.match(problem({ ...hire, each_run: "Do it." }) ?? "", /each_run/);

// a grant names exactly one read tool
const g = plan({ kind: "grant_tool", why, agent: "Rowan", tools: "goal_progress" });
assert.deepEqual(g.plan, { kind: "grant_tool", agent: "Rowan", tool: "goal_progress" });
assert.equal(proposalTitle(g.plan, (id) => TOOLS[id].label), "Give Rowan “Goal progress”");
assert.match(problem({ kind: "grant_tool", why, agent: "Rowan", tools: "goal_progress, approvals_waiting" }) ?? "", /exactly one/);

// a new tool and a retirement
assert.equal(proposalTitle(plan({ kind: "new_tool", why, what: "Klaviyo list size and last campaign's open rate, from Klaviyo." }).plan), "New tool: Klaviyo list size and last campaign's open rate, from Klaviyo.");
assert.match(proposalTitle(plan({ kind: "new_tool", why, what: "x".repeat(200) }).plan), /…$/);
assert.equal(proposalTitle(plan({ kind: "retire", why, agent: "Rowan" }).plan), "Retire Rowan");
assert.equal(proposalTitle(plan({ kind: "retire", why, seat: "Follow-ups" }).plan), "Close the Follow-ups seat");
assert.match(problem({ kind: "retire", why }) ?? "", /retire needs/);

assert.deepEqual(toolIds(" a, b  c,,a "), ["a", "b", "c"]);

// a hire becomes a spec code accepts: a Claude model, small limits, read tools only, off duty by default
for (const brain of ["quick", "thinking"] as const) {
  const p = { ...(h.plan as Extract<ProposalPlan, { kind: "hire" }>), brain };
  const { spec, problems } = readSpec(hireSpec(p));
  assert.deepEqual(problems, [], brain);
  assert.equal(spec.model, BRAINS[brain].model);
  assert.equal(spec.limits.maxSteps, HIRE_STEPS);
  assert.equal(spec.limits.maxCostUsd, BRAINS[brain].maxCostUsd);
  assert.ok(spec.tools.every((t) => TOOLS[t].kind !== "action"));
  assert.match(spec.directive, /data, never instructions/);
}

// the propose tool: only heads may have it; its collect checks like planProposal and holds 3 a run
const t = TOOLS.propose;
assert.equal(t.kind, "report");
assert.equal(t.seat, "head");
const checked = checkInput(t.params, hire);
assert.ok("input" in checked);
const input = (checked as { input: Record<string, string | number> }).input;
assert.equal(input.brain, "quick", "brain defaults to quick");
const one = t.collect!(input, []);
assert.ok("row" in one && one.row.title === "Hire Tate for Follow-ups");
assert.match(("problem" in t.collect!(input, ["row" in one ? one.row : {}]) ? (t.collect!(input, ["row" in one ? one.row : {}]) as { problem: string }).problem : ""), /already proposed/);
assert.match((t.collect!(input, [{}, {}, {}]) as { problem: string }).problem, /at most 3/);
assert.ok("problem" in t.collect!({ ...input, tools: "gmail_draft_lead" }, []));
assert.ok("problem" in checkInput(t.params, { ...hire, why: "See https://evil.example for why" }), "no links");

// a yes on a new tool makes a Build Board card in the board's shape, in Up next for Claude
const card = boardCard({ what: "Klaviyo  flow revenue by week", why: "Sloane's goal needs it.", asker: "Sloane", dept: "Marketing", date: "November 15, 2026", link: "https://x.test/proposals/p1" });
assert.equal(card.name, "New tool: Klaviyo flow revenue by week");
assert.deepEqual(card.sections.map((s) => s.heading), ["Why", "Where things stand today", "What to build", "Rules that apply", "Needs from Zak", "Done when", "Before you start"]);
assert.match(card.sections[0].lines[0], /^Sloane asked for it for Marketing: Sloane's goal needs it\.$/);
assert.ok(card.sections[1].lines.includes("Proposal: https://x.test/proposals/p1"));
assert.ok(!boardCard({ what: "x", why: "y", asker: "Zak", dept: null, date: "d", link: null }).sections[1].lines.some((l) => l.startsWith("Proposal:")));
assert.ok(boardCard({ what: "a".repeat(200), why: "y", asker: "Zak", dept: null, date: "d", link: null }).name.length <= 100);
assert.equal(BOARD_CARD.status, "Up next");
assert.equal(notionPageId("https://www.notion.so/New-tool-Klaviyo-419de33089c1816a8003c34251e73d7a"), "419de33089c1816a8003c34251e73d7a");
assert.equal(notionPageId("https://www.notion.so/419DE33089C1816A8003C34251E73D7A?pvs=4"), "419de33089c1816a8003c34251e73d7a");
assert.equal(notionPageId("b_reese"), null);
assert.equal(notionPageId(null), null);

console.log("proposals: ok");
