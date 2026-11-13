// Checks the runner's limits and refusals with a stand-in model: no network, no database, no cost.
// Run: npm run check:runner
import assert from "node:assert/strict";
import { checkInput } from "../core/tools/types";
import { readSpec, specLooser } from "../core/agent-spec";
import { runExplore, traceNumbers, type Step } from "../core/runner";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
let n = 0;
const reply = (content: Block[], stop = "tool_use") => ({ id: `m${++n}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 200 } });
const fake = (script: (turn: number, body: { messages: unknown[]; tools: { name: string }[] }) => ReturnType<typeof reply>) => {
  let turn = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { beta: { messages: { create: async (body: any) => script(turn++, body) as any } } };
};

async function main() {
  // inputs: ranges and lists are enforced, extra keys dropped
  const params = [{ name: "days", type: "int", min: 1, max: 90, default: 30, description: "" }] as const;
  assert.deepEqual(checkInput(params, {}), { input: { days: 30 } });
  assert.deepEqual(checkInput(params, { days: 7, url: "http://x" }), { input: { days: 7 } });
  assert.ok("problem" in checkInput(params, { days: 500 }));
  assert.ok("problem" in checkInput([{ name: "page", type: "enum", options: ["a"], description: "" }], { page: "b" }));

  // specs: limits above the ceiling are refused, unknown tools and non-Claude models dropped
  const bad = readSpec({ directive: "x", model: "openai/gpt-6.1-sol", tools: ["shopify_green_lots", "send_money"], limits: { maxSteps: 99, maxCostUsd: 5 } });
  assert.equal(bad.spec.model, "claude-haiku-5-5");
  assert.deepEqual(bad.spec.tools, ["shopify_green_lots"]);
  assert.equal(bad.spec.limits.maxSteps, 12);
  assert.equal(bad.problems.length, 4);
  const { spec } = readSpec({ name: "t", directive: "Check things.", model: "claude-haiku-5-5", effort: "low", tools: ["mercury_balances"], limits: { maxSteps: 3, maxCostUsd: 0.5 } });
  assert.equal(spec.outputName, "result");

  // versions: only a higher cost or step limit counts as spending more
  assert.deepEqual(specLooser(spec, { ...spec, limits: { maxSteps: 2, maxCostUsd: 0.4 } }), []);
  assert.equal(specLooser(spec, { ...spec, limits: { maxSteps: 3, maxCostUsd: 0.6 } }).length, 1);
  assert.equal(specLooser(spec, { ...spec, limits: { maxSteps: 9, maxCostUsd: 2 } }).length, 2);
  assert.deepEqual(specLooser(null, spec), []);

  // finishes: a tool the agent doesn't have is refused, then finish ends the run
  const r1 = await runExplore(spec, { agentId: "scratch", client: fake((t, body) => {
    assert.deepEqual(body.tools.map((x) => x.name), ["mercury_balances", "finish"]);
    return t === 0 ? reply([{ type: "tool_use", id: "a", name: "shopify_green_lots", input: {} }]) : reply([{ type: "tool_use", id: "b", name: "finish", input: { result: "All fine." } }]);
  }) });
  assert.equal(r1.finished, true);
  assert.equal(r1.summary, "All fine.");
  assert.equal(r1.steps.find((s) => s.kind === "tool")?.ok, false);

  // step limit: a model that keeps calling tools is stopped after maxSteps tool calls
  const r2 = await runExplore(spec, { agentId: "scratch", client: fake(() => reply([{ type: "tool_use", id: `c${n}`, name: "mercury_balances", input: {} }])) });
  assert.equal(r2.finished, false);
  assert.equal(r2.steps.filter((s) => s.kind === "tool").length, 3);
  assert.match(r2.summary, /3-step limit/);

  // cost limit: stops before a turn that could go over
  const tight = readSpec({ directive: "x", model: "claude-opus-5-5", tools: [], limits: { maxSteps: 30, maxCostUsd: 0.05 } }).spec;
  let calls = 0;
  const r3 = await runExplore(tight, { agentId: "scratch", client: fake(() => { calls++; return reply([{ type: "text", text: "thinking" }], "end_turn"); }) });
  assert.equal(r3.finished, false);
  assert.match(r3.summary, /cost limit/);
  assert.ok(calls <= 1, `made ${calls} calls over the cost limit`);

  // outputs: a number is kept only when it points at a number a tool computed in this run
  const st: Step[] = [
    { idx: 0, kind: "model", ok: true, ms: 0 },
    { idx: 1, kind: "tool", tool: "calc_green_cover", ok: true, numbers: { min_days: 14.5 }, ms: 0 },
    { idx: 2, kind: "tool", tool: "mercury_balances", ok: false, numbers: { cash: 9 }, ms: 0 },
  ];
  const tr = traceNumbers([
    { label: "Lowest cover", step: 1, key: "min_days" },
    { label: "Made up", step: 1, key: "max_days" },
    { label: "Failed tool", step: 2, key: "cash" },
    { label: "Model step", step: 0, key: "x" },
    { label: "", step: 1, key: "min_days" },
  ], st);
  assert.deepEqual(tr.numbers, [{ label: "Lowest cover", value: 14.5, tool: "calc_green_cover", step: 1, key: "min_days" }]);
  assert.equal(tr.refused, 4);
  assert.deepEqual(traceNumbers("not a list", st), { numbers: [], refused: 0 });

  // finish with a number the model typed instead of citing: left out and counted in the summary
  const r4 = await runExplore(spec, { agentId: "scratch", client: fake(() => reply([{ type: "tool_use", id: "f", name: "finish", input: { result: "Done.", numbers: [{ label: "Cash", step: 7, key: "cash" }] } }])) });
  assert.deepEqual(r4.output, []);
  assert.match(r4.summary, /1 number left out/);

  // sources: picking agent_output needs an agent to read from
  assert.ok(readSpec({ directive: "x", model: "claude-haiku-5-5", tools: ["agent_output"] }).problems.some((p) => /no agent is picked/.test(p)));
  const reads = readSpec({ directive: "x", model: "claude-haiku-5-5", tools: ["agent_output"], readsFrom: [{ agentId: "b_green", label: "G" }, { agentId: "b_green" }, { agentId: "Bad Id!" }] });
  assert.deepEqual(reads.spec.readsFrom, [{ agentId: "b_green", label: "G" }]);
  assert.equal(reads.problems.length, 1);

  console.log("check-runner: all passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
