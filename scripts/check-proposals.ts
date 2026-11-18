// Checks proposals (core/proposal-rules.ts and the propose tool): what a proposal may hold, that it
// never hands out an action, and that a hire becomes a spec code accepts. No database, no network.
// Run: npm run check:proposals
import assert from "node:assert/strict";

import { KNOWN_SERVERS, MAX_ASKS_KEPT, REQUEST_CARD, checkServiceName, checkWhat, knownByAddress, knownServer, requestCard, requestCardName, serviceKey, withAsk, type Ask } from "../core/connector-rules";
import { BRAINS, HIRE_STEPS, MAX_HIRE_TOOLS, hireSpec, planProposal, proposalTitle, toolIds, toolInfoOf, type ProposalPlan } from "../core/proposal-rules";
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

// Find a tool (docs/custom-servers.md, slice 3): asks counted per service, known servers only from code
assert.equal(serviceKey("Post Hog"), "posthog");
assert.equal(serviceKey("Google Analytics 4"), "googleanalytics4");
assert.deepEqual(checkServiceName("  Square  "), { name: "Square", key: "square" });
assert.ok("problem" in checkServiceName(""));
assert.ok("problem" in checkServiceName("https://evil.example"), "no links in a name");
assert.ok("problem" in checkServiceName("!!!"));
assert.ok("problem" in checkServiceName("x".repeat(61)));
assert.ok("problem" in checkWhat("hi"));
assert.ok("problem" in checkWhat("read www.evil.example for this"), "no links in what");
assert.deepEqual(checkWhat("Weekly  sessions\nand drop-off"), { what: "Weekly sessions and drop-off" });
assert.equal(knownServer("Post Hog")?.url, "https://mcp.posthog.com/mcp");
assert.equal(knownServer("klaviyo")?.builtIn, "klaviyo");
assert.equal(knownServer("nope"), null);
assert.equal(knownServer(null), null);
assert.equal(knownByAddress("https://mcp.posthog.com/mcp?x=1")?.key, "posthog");
assert.equal(knownByAddress("https://evil.example/mcp"), null);
assert.equal(knownByAddress("not a url"), null);
for (const k of KNOWN_SERVERS) {
  assert.equal(k.key, serviceKey(k.name), `${k.name}'s key`);
  if (k.url) { assert.ok(k.url.startsWith("https://"), `${k.name} is https`); assert.ok(!k.builtIn); }
  else assert.ok(k.builtIn, `${k.name} without an address is built in`);
}
assert.equal(new Set(KNOWN_SERVERS.map((k) => k.key)).size, KNOWN_SERVERS.length, "one entry per service");
const asks = Array.from({ length: 25 }, (_, i) => ({ by: "Sam", what: `ask ${i}`, at: String(i) }));
const kept = asks.reduce<Ask[]>((a, x) => withAsk(a, x), []);
assert.equal(kept.length, MAX_ASKS_KEPT);
assert.equal(kept[0].what, "ask 24", "newest first");
assert.equal(requestCardName("PostHog", 1), "Connector: PostHog");
assert.equal(requestCardName("PostHog", 3), "Connector: PostHog (3 asks)");
const rc = requestCard({ name: "PostHog", ask: { by: "Avery", what: "Weekly sessions", at: "x" }, date: "November 17, 2026", link: "https://x.test/connections/find", known: knownServer("posthog") });
assert.equal(rc.name, "Connector: PostHog");
assert.deepEqual(rc.sections.map((s) => s.heading), ["Why", "Where things stand today", "What to build", "Rules that apply", "Done when", "Before you start"]);
assert.match(rc.sections[0].lines[0], /^Avery asked for PostHog on November 17, 2026: Weekly sessions$/);
assert.ok(rc.sections[1].lines[0].includes("https://mcp.posthog.com/mcp"));
assert.ok(rc.sections[1].lines.includes("Requests: https://x.test/connections/find"));
assert.ok(!requestCard({ name: "Square", ask: { by: "Sam", what: "Sales", at: "x" }, date: "d", link: null, known: null }).sections[1].lines.some((l) => l.startsWith("Requests:")));
assert.equal(REQUEST_CARD.status, "Backlog");

console.log("proposals: ok");
