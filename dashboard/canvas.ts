import "server-only";
// Builds the agent canvas (docs/agent-setup.md): for each of the six boxes, what the latest
// run did (Replay), what the setup says (Edit), and every value behind the box with the
// place it lives. Plain data for dashboard/components/AgentCanvas.tsx; no values of keys.
import { MENUS } from "@/agents/menus";
import { DEFAULT_BUDGET, KEEPS_WORKING, MEMORY_AGENTS } from "@/core/memory";
import type { AgentMenu, Setup } from "@/core/setup";
import { ACCESS, HARD_RULES, INTEGRATIONS, type CrewMember, type IntegrationId } from "./crew";
import type { AgentRow, Run } from "./data";
import { budget, dur, m4, num, when } from "./format";
import { schedSentence, schedWords } from "./schedule";
import { RUN_LOOK, isLive } from "./status";
import type { CanvasBox, CanvasModel, CanvasRow } from "./components/AgentCanvas";

const FOLDER: Record<string, string> = { chief_of_staff: "chief-of-staff", cfo: "cfo", wholesale_hunter: "wholesale-hunter", bookkeeper: "bookkeeper" };
const MEM_NAME: Record<string, string> = { crew: "Crew memory", standing_order: "Standing orders", note: "Zak’s notes", lesson: "Lessons", working: "Working memory" };

export interface CanvasInput {
  a: CrewMember;
  row?: AgentRow;
  /** The latest real run, for Replay. */
  run: Run | null;
  /** The setup version that run used, when the column exists and the run recorded one. */
  runSetupVersion?: number | null;
  leads?: number | null;
  health: Record<IntegrationId, boolean>;
  /** Null for an agent without a menu. */
  setup: { setup: Setup; problem?: string } | null;
  /** What the agent's next run would load from memory, when it can be read. */
  memory?: { budget: number; lines: number } | null;
}

const has = (keys: readonly string[] | undefined) => (keys ?? []).every((k) => !!process.env[k]?.trim());
const status = (ok: boolean): "ok" | "missing" => (ok ? "ok" : "missing");

export function buildCanvas(i: CanvasInput): CanvasModel {
  const { a, row, run, health } = i;
  const menu: AgentMenu | undefined = MENUS[a.id];
  const setup = i.setup?.setup ?? null;
  const file = `agents/${FOLDER[a.id] ?? a.id}/index.ts`;
  const live = !!run && isLive(run);
  const usesModel = !!a.model?.startsWith("claude");
  const from = (picked: boolean | undefined) => (picked && setup?.version != null ? `Setup v${setup.version}` : "Built-in default");
  const fixed = (box: CanvasBox["id"]): CanvasRow[] => (menu?.fixed ?? []).filter((f) => f.box === box).map((f) => ({ label: f.label, value: f.value, home: "code", where: f.note ?? file }));
  const numbers = (box: CanvasBox["id"]): CanvasRow[] => Object.entries(menu?.numbers ?? {}).filter(([, d]) => d.box === box).map(([k, d]) => ({
    label: d.label, value: `${setup?.numbers[k] ?? d.default} ${d.unit}`, home: "app", where: `${from(setup?.fromSetup.numbers[k])} · can be ${d.min} to ${d.max}`,
  }));
  const access = (levels: string[]) => INTEGRATIONS.filter((x) => levels.includes(ACCESS[a.id]?.[x.id]?.[0] ?? ""));

  // 1. Trigger
  const sched = a.schedule;
  const trigger: CanvasBox = {
    id: "trigger", title: "Trigger", icon: "play",
    replay: [!run ? "No real run yet" : run.trigger === "manual" ? "Zak pressed Run" : run.trigger === "approval" ? "Zak approved changes" : "Vercel Schedule", run ? `Real run · ${when(run.started_at)} CT` : "Dry runs aren’t logged"],
    edit: [schedWords(sched), row ? (row.enabled ? "On the crew" : "Off duty") : "Not in the database"],
    rows: [
      { label: "Schedule", value: schedSentence(sched), home: "code", where: sched?.vercelName ? `vercel.json, schedule “${sched.vercelName}”` : "No schedule. agents/registry.ts marks it manual only" },
      ...(sched?.vercelName ? [{ label: "Schedule on or off", value: "Set in Vercel, not shown here", home: "vercel", where: `vercel schedules enable ${sched.vercelName} (or disable), from a terminal` } as CanvasRow] : []),
      { label: "On the crew", value: row ? (row.enabled ? "Yes. Runs go through." : "No. Every run is skipped and logged at $0.") : "Not in the agents table yet", home: "app", where: "Profile tab, the On the crew switch" },
      { label: "Run by hand", value: "Run and Dry run buttons", home: "app", where: "Profile tab. Real runs need DASHBOARD_CONTROLS=on" },
    ],
  };

  // 2. Memory
  const mem = run?.memory_json ?? null;
  const memLines = mem ? Object.entries(mem.groups).filter(([, v]) => v.lines > 0) : [];
  const loads = MEMORY_AGENTS.has(a.id);
  const memBudget = i.memory?.budget ?? mem?.budget ?? DEFAULT_BUDGET;
  const memory: CanvasBox = {
    id: "memory", title: "Memory", icon: "brain",
    replay: mem ? (memLines.length ? memLines.map(([g, v]) => `${MEM_NAME[g] ?? g} · ${v.lines}`) : ["Nothing in memory yet"]) : [!run ? "Loads its memory when it runs" : usesModel ? "This run loaded no memory" : "No model, so no memory to load"],
    replayFoot: mem ? `${num(mem.tokens)} of ${num(mem.budget)} tokens` : undefined,
    edit: loads ? [i.memory ? `${i.memory.lines} line${i.memory.lines === 1 ? "" : "s"} for the next run` : "Loads memory each run", `Budget ${num(memBudget)} tokens`] : ["Loads no memory"],
    rows: [
      { label: "Loads memory", value: loads ? "Yes, on every real run" : "No. This agent’s model step doesn’t read memory.", home: "code", where: "MEMORY_AGENTS in core/memory.ts" },
      ...(loads ? [
        { label: "Standing orders, notes, lessons", value: i.memory ? `${i.memory.lines} line${i.memory.lines === 1 ? "" : "s"} would load on the next run` : "Zak’s words, and lessons he kept", home: "app", where: "Memory tab: Teach, Edit, Forget" },
        { label: "Linked Notion pages", value: "Read fresh on every run, up to 1,500 tokens a page", home: "app", where: "Memory tab: a standing order can link a page" },
        { label: "Memory budget", value: `${num(memBudget)} tokens`, home: "database", where: "policies.memory_budget_tokens, one value for every agent" },
        { label: "Working memory", value: KEEPS_WORKING.has(a.id) ? "The model leaves itself up to 5 short lines for its next run" : "None. This agent keeps no working memory.", home: KEEPS_WORKING.has(a.id) ? "database" : "code", where: KEEPS_WORKING.has(a.id) ? "policies.working_memory_max_lines" : "KEEPS_WORKING in core/memory.ts" },
      ] as CanvasRow[] : []),
    ],
  };

  // 3. Reads
  const readsAccess = access(["read"]);
  const reads: CanvasBox = {
    id: "reads", title: "Reads · facts", icon: "shopping-bag",
    replay: readsAccess.length ? readsAccess.map((x) => x.name) : ["No reads"],
    edit: menu ? [`${menu.reads.length} fact sources`, ...numbers("reads").map((r) => `${r.label} ${r.value}`)] : (readsAccess.length ? readsAccess.map((x) => x.name) : ["No reads"]),
    rows: menu
      ? [
        ...menu.reads.map((r): CanvasRow => ({ label: r.label, value: r.detail, home: "code", where: `Always on. ${file}`, status: status(health[r.integration as IntegrationId] ?? false) })),
        ...numbers("reads"), ...fixed("reads"),
      ]
      : readsAccess.map((x): CanvasRow => ({ label: x.name, value: ACCESS[a.id]?.[x.id]?.[1] ?? "", home: "code", where: file, status: status(health[x.id]) })),
  };

  // 4. Thinking
  const step = menu?.steps[0];
  const thinking: CanvasBox = {
    id: "thinking", title: usesModel ? "Thinking" : "Computing", icon: "cpu",
    replay: [setup && i.runSetupVersion != null ? `${a.model} · setup v${i.runSetupVersion}` : a.model ?? "Set when built"],
    replayFoot: run ? (run.tokens_in + run.tokens_out > 0 ? `${num(run.tokens_in)} in · ${num(run.tokens_out)} out` : "No model tokens") : undefined,
    edit: setup && step ? [setup.model, `Effort ${setup.effort}`, `Instructions · ${num(setup.instructions.length)} characters`] : [a.model ?? "Set when built"],
    rows: setup && step && menu
      ? [
        { label: "Step", value: `${step.label}. Needs: ${step.needs}`, home: "code", where: file },
        { label: "Model", value: setup.model, home: "app", where: `${from(setup.fromSetup.model)} · can be ${step.models.join(", ")}` },
        { label: "Effort", value: setup.effort, home: "app", where: `${from(setup.fromSetup.effort)} · can be low, medium or high` },
        { label: "Instructions", value: `${num(setup.instructions.length)} characters`, home: "app", where: setup.fromSetup.instructions ? `Setup v${setup.version}` : `Built-in text in agents/${FOLDER[a.id]}/prompt.ts`, long: setup.instructions },
        ...fixed("thinking"),
        { label: "Price", value: "Per token, by model", home: "code", where: "integrations/anthropic.ts, so cost is always computed in code" },
        { label: "Claude API key", value: "ANTHROPIC_API_KEY", home: "vercel", where: "Vercel, Environment Variables", status: status(health.claude) },
      ]
      : usesModel
        ? [
          { label: "Model", value: a.model ?? "", home: "code", where: file },
          { label: "Instructions", value: "Built-in text", home: "code", where: `agents/${FOLDER[a.id] ?? a.id}/prompt.ts` },
          { label: "Claude API key", value: "ANTHROPIC_API_KEY", home: "vercel", where: "Vercel, Environment Variables", status: status(health.claude) },
        ]
        : [{ label: "Method", value: "Plain code. No model is called.", home: "code", where: file }],
  };

  // 5. Guardrails: only what code enforces. Instructions and standing orders are guidance, so they sit in Thinking and Memory.
  const guardrails: CanvasBox = {
    id: "guardrails", title: "Guardrails", icon: "lock",
    replay: [`${HARD_RULES.length} hard rules, locked`, "Budget checked every run"],
    edit: [`${HARD_RULES.length} hard rules, locked`, row ? `Daily budget ${budget(row.daily_budget_usd)}` : "Daily budget set when built"],
    rows: [
      { label: "Hard rules", value: `${HARD_RULES.length} rules. Can’t be switched off in this app.`, home: "code", where: "CLAUDE.md, the gateway and lint", long: HARD_RULES.map((r, k) => `${k + 1}. ${r}`).join("\n") },
      { label: "Daily budget", value: row ? `${budget(row.daily_budget_usd)} of model spend per UTC day` : "Set when built", home: "app", where: "Settings tab. Raising it needs DASHBOARD_CONTROLS=on" },
      { label: "Before every run", value: "Off duty or over budget means the run is skipped and logged at $0", home: "code", where: "withRun in core/runs.ts" },
      { label: "Numbers", value: "Money, margins, counts and days of cover are computed in code, never by the model", home: "code", where: file },
      ...(ACCESS[a.id]?.email ? [{ label: "Email recipient", value: "One address. The email code has no recipient field.", home: "vercel", where: "BRIEF_TO in Vercel, read by integrations/email.ts", status: status(!!process.env.BRIEF_TO?.trim()) } as CanvasRow] : []),
      ...numbers("guardrails"), ...fixed("guardrails"),
    ],
  };

  // 6. Writes
  const writesAccess = access(["write", "draft"]);
  const writes: CanvasBox = {
    id: "writes", title: "Writes · outputs", icon: "shield-check",
    replay: writesAccess.map((x) => `${x.name}${ACCESS[a.id]?.[x.id]?.[0] === "draft" ? " · draft" : ""}`),
    edit: menu ? menu.outputs.filter((o) => has(o.env)).map((o) => o.label).concat(menu.outputs.some((o) => !has(o.env)) ? [`${menu.outputs.filter((o) => !has(o.env)).length} not set up`] : []) : writesAccess.map((x) => x.name),
    rows: menu
      ? [
        ...menu.outputs.map((o): CanvasRow => ({ label: o.label, value: o.detail, home: "vercel", where: `Vercel, Environment Variables: ${(o.env ?? []).join(", ")}`, status: status(has(o.env)) })),
        ...numbers("writes"), ...fixed("writes"),
      ]
      : writesAccess.map((x): CanvasRow => ({ label: x.name, value: ACCESS[a.id]?.[x.id]?.[1] ?? "", home: "code", where: file, status: status(health[x.id]) })),
  };

  const look = run ? RUN_LOOK[run.status] : null;
  const leadCount = a.id === "wholesale_hunter" && i.leads != null && run ? i.leads : null;
  return {
    agentName: a.name, hasMenu: !!menu, live, hasRun: !!run,
    versionLabel: !menu ? "No menu yet" : setup?.version != null ? `Setup v${setup.version}` : "Built-in setup",
    versionNote: setup?.version != null ? [setup.note, setup.createdAt ? `Saved ${when(setup.createdAt)} CT.` : ""].filter(Boolean).join(" ") : undefined,
    problem: i.setup?.problem
      ? `The setup can’t be read (${i.setup.problem}), so ${a.name} runs on the built-in values. Apply the agent setup migration and this fills in.`
      : setup?.problems.length ? `Setup v${setup.version} holds values this agent’s menu doesn’t offer. They are ignored and the built-in value is used: ${setup.problems.join("; ")}.` : undefined,
    boxes: [trigger, memory, reads, thinking, guardrails, writes],
    result: {
      big: !run ? "—" : live ? "…" : leadCount != null ? String(leadCount) : look!.label,
      label: leadCount != null ? "new leads" : "",
      text: run ? (run.error ?? run.summary ?? "") : "Press Dry run on the profile to check the plumbing for free.",
      foot: !run ? "Waiting for the first run" : live ? "Working now" : `${run.status === "failed" ? "Failed after" : "Done in"} ${dur(run.started_at, run.ended_at)} · ${m4(run.cost_usd)}`,
      pct: run ? (live ? 50 : 100) : 0,
      href: run ? `/runs/${run.id}` : undefined,
    },
  };
}
