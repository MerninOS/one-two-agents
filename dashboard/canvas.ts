import "server-only";
// Builds the agent canvas (docs/agent-setup.md): for each of the six boxes, what the latest
// run did (Replay), what the setup says (Edit), and every value behind the box with the
// place it lives. Plain data for dashboard/components/AgentCanvas.tsx; no values of keys.
import { MENUS } from "@/agents/menus";
import { DEFAULT_BUDGET, KEEPS_WORKING, MEMORY_AGENTS } from "@/core/memory";
import { TOOLS } from "@/core/gateway/policy";
import { env } from "@/core/env";
import { liveSections, type AgentMenu, type Setup } from "@/core/setup";
import { hasGateway } from "@/integrations/gateway";
import { modelDef } from "@/integrations/models";
import { HARD_RULES, type CrewMember, type IntegrationId } from "./crew";
import { isSetUp, type Reach } from "./connections";
import type { AgentRow, Run } from "./data";
import { budget, dur, m4, num, when } from "./format";
import { schedSentence, schedWords } from "./schedule";
import { RUN_LOOK, isLive } from "./status";
import type { CanvasBox, CanvasModel, CanvasRow } from "./components/AgentCanvas";

const FOLDER: Record<string, string> = { chief_of_staff: "chief-of-staff", cfo: "cfo", wholesale_hunter: "wholesale-hunter", bookkeeper: "bookkeeper" };
// A model id as people read it: "Claude Sonnet 5.5 (Anthropic)". Unknown ids show as they are.
const label = (id: string) => { const d = modelDef(id); return d ? `${d.label} (${d.provider})` : id; };
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
  /** What its saved setup can reach, per connection (dashboard/connections.ts). */
  reach: Reach[];
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
  const choices = (box: CanvasBox["id"]): CanvasRow[] => Object.entries(menu?.choices ?? {}).filter(([, d]) => d.box === box).map(([k, d]) => ({
    label: d.label, value: (setup?.choices[k] ?? d.default).map((id) => d.options.find((o) => o.id === id)?.label ?? id).join(", "), home: "app", where: `${from(setup?.fromSetup.choices[k])} · ${d.detail}`,
  }));
  const choiceWords = (box: CanvasBox["id"]) => Object.entries(menu?.choices ?? {}).filter(([, d]) => d.box === box).map(([k, d]) => `${d.label} · ${(setup?.choices[k] ?? d.default).length} picked`);

  // 1. Trigger
  const sched = a.schedule;
  const trigger: CanvasBox = {
    id: "trigger", title: "Trigger", icon: "play",
    replay: [!run ? "No real run yet" : run.trigger === "manual" ? "Zak pressed Run" : run.trigger === "approval" ? "Zak approved changes" : run.trigger === "chain" ? "A crew chain" : "Vercel Schedule", run ? `Real run · ${when(run.started_at)} CT` : "Dry runs aren’t logged"],
    edit: [schedWords(sched), row ? (row.enabled ? "On the crew" : "Off duty") : "Not in the database"],
    rows: [
      { label: "Schedule", value: schedSentence(sched), home: "app", where: sched?.chain ? `Crew canvas, chain “${sched.chain}”. Runs only while that chain is on` : "Not in a chain. Crew canvas can add it to one" },
      { label: "Dispatcher", value: "One Vercel Schedule every 15 minutes starts chains that are due", home: "vercel", where: "vercel.json “dispatch”. With every chain off it does nothing" },
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
  const readsAccess = i.reach.filter((x) => x.has.includes("read"));
  const reads: CanvasBox = {
    id: "reads", title: "Reads · facts", icon: "shopping-bag",
    replay: readsAccess.length ? readsAccess.map((x) => x.conn.name) : ["No reads"],
    edit: menu ? [`${menu.reads.length - (setup?.readsOff.length ?? 0)} of ${menu.reads.length} fact sources on`, ...numbers("reads").map((r) => `${r.label} ${r.value}`), ...choiceWords("reads")] : (readsAccess.length ? readsAccess.map((x) => x.conn.name) : ["No reads"]),
    // nothing to pick when every source is locked and no setting lives here (Morgan)
    editable: !!(setup && menu && (menu.reads.some((r) => !r.locked) || numbers("reads").length || choices("reads").length)),
    rows: menu
      ? [
        ...menu.reads.map((r): CanvasRow => {
          const off = !!setup?.readsOff.includes(r.id);
          return { label: r.label, value: off ? `Off. ${r.detail}` : r.detail, home: r.locked ? "code" : "app", where: r.locked ? `Always on · built in ${file}` : `${from(setup?.fromSetup.reads)} · built in ${file}`, status: off ? undefined : status(health[r.integration as IntegrationId] ?? false) };
        }),
        ...numbers("reads"), ...choices("reads"), ...fixed("reads"),
      ]
      : readsAccess.map((x): CanvasRow => ({ label: x.conn.name, value: (x.by.read ?? []).join(", "), home: "app", where: "Its saved setup", status: status(isSetUp(x.conn, health)) })),
  };

  // 4. Thinking
  const step = menu?.steps[0];
  const locked = !!menu?.instructionsLocked;
  const more = (menu?.steps.slice(1) ?? []).map((d) => ({ d, c: setup?.more[d.id] ?? { model: d.model, effort: d.effort, fallback: d.fallback } }));
  const thinking: CanvasBox = {
    id: "thinking", title: usesModel ? "Thinking" : "Computing", icon: "cpu",
    replay: [setup && i.runSetupVersion != null ? `${a.model} · setup v${i.runSetupVersion}` : a.model ?? "Set when built"],
    replayFoot: run ? (run.tokens_in + run.tokens_out > 0 ? `${num(run.tokens_in)} in · ${num(run.tokens_out)} out` : "No model tokens") : undefined,
    edit: setup && step
      ? [more.length ? `${step.label} · ${label(setup.model)}` : label(setup.model), ...more.map(({ d, c }) => `${d.label} · ${label(c.model)}`), more.length ? `Effort ${[setup.effort, ...more.map(({ c }) => c.effort)].join(" / ")}` : `Effort ${setup.effort}${setup.fallback ? ` · fallback ${modelDef(setup.fallback)?.label ?? setup.fallback}` : ""}`, locked ? "Instructions fixed in code" : `Instructions · ${num(setup.instructions.length)} characters`, ...choiceWords("thinking")]
      : [a.model ?? "Set when built"],
    editable: !!(setup && step),
    rows: setup && step && menu
      ? [
        { label: more.length ? `Step 1: ${step.label}` : "Step", value: `Needs: ${step.needs}`, home: "code", where: file },
        { label: "Model", value: label(setup.model), home: "app", where: `${from(setup.fromSetup.model)} · can be ${step.models.map((m) => modelDef(m)?.label ?? m).join(", ")}` },
        { label: "Effort", value: setup.effort, home: "app", where: `${from(setup.fromSetup.effort)} · can be low, medium or high` },
        step.fallbackOff
          ? { label: "Fallback model", value: "None", home: "code", where: `${file} has no fallback for this step` }
          : { label: "Fallback model", value: setup.fallback ? label(setup.fallback) : "None", home: "app", where: `${from(setup.fromSetup.fallback)} · tried once if ${modelDef(setup.model)?.label ?? setup.model} can’t be reached or answers in the wrong shape, before the fixed rules` },
        ...more.flatMap(({ d, c }, k): CanvasRow[] => [
          { label: `Step ${k + 2}: ${d.label}`, value: `Needs: ${d.needs}`, home: "code", where: file },
          { label: "Model", value: label(c.model), home: "app", where: `${from(setup.fromSetup.more[d.id])} · can be ${d.models.map((m) => modelDef(m)?.label ?? m).join(", ")}` },
          { label: "Effort", value: c.effort, home: "app", where: `${from(setup.fromSetup.more[d.id])} · can be low, medium or high` },
        ]),
        { label: "Safety block", value: locked ? "Locked, in code" : "Locked. Sent first on every call.", home: "code", where: locked ? `agents/${FOLDER[a.id]}/prompt.ts. No setup can change it` : `agents/${FOLDER[a.id]}/prompt.ts (SAFETY). No setup can change it`, long: menu.safety },
        locked
          ? { label: "Instructions", value: "Fixed in code", home: "code", where: `agents/${FOLDER[a.id]}/prompt.ts. Short prompts whose answers code checks, so a setup can’t change them`, long: setup.instructions }
          : { label: "Instructions", value: `${num(setup.instructions.length)} characters`, home: "app", where: setup.fromSetup.instructions ? `Setup v${setup.version}` : `Built-in text in agents/${FOLDER[a.id]}/prompt.ts`, long: setup.instructions },
        ...numbers("thinking"), ...choices("thinking"),
        ...fixed("thinking"),
        { label: "Price", value: "Per token, by model", home: "code", where: "integrations/models.ts, so cost is always computed in code" },
        { label: "Claude API key", value: "ANTHROPIC_API_KEY", home: "vercel", where: "Vercel, Environment Variables. Claude models go straight to Anthropic", status: status(health.claude) },
        { label: "AI Gateway", value: "OpenAI and Google models", home: "vercel", where: "Vercel AI Gateway: the deployment signs in by itself, or AI_GATEWAY_API_KEY in Environment Variables", status: status(hasGateway()) },
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
    id: "guardrails", title: "Guardrails", icon: "lock", editable: !!row,
    replay: [`${HARD_RULES.length} hard rules, locked`, "Budget checked every run"],
    edit: [`${HARD_RULES.length} hard rules, locked`, row ? `Daily budget ${budget(row.daily_budget_usd)}` : "Daily budget set when built"],
    rows: [
      { label: "Hard rules", value: `${HARD_RULES.length} rules. Can’t be switched off in this app.`, home: "code", where: "CLAUDE.md, the gateway and lint", long: HARD_RULES.map((r, k) => `${k + 1}. ${r}`).join("\n") },
      { label: "Daily budget", value: row ? `${budget(row.daily_budget_usd)} of model spend per UTC day` : "Set when built", home: "app", where: "Settings tab. Raising it needs DASHBOARD_CONTROLS=on" },
      { label: "Before every run", value: "Off duty or over budget means the run is skipped and logged at $0", home: "code", where: "withRun in core/runs.ts" },
      { label: "Numbers", value: "Money, margins, counts and days of cover are computed in code, never by the model", home: "code", where: file },
      ...(i.reach.some((x) => x.conn.id === "email") ? [{ label: "Email recipient", value: "One address. The email code has no recipient field.", home: "vercel", where: "BRIEF_TO in Vercel, read by integrations/email.ts", status: status(!!process.env.BRIEF_TO?.trim()) } as CanvasRow] : []),
      ...numbers("guardrails"), ...choices("guardrails"), ...fixed("guardrails"),
    ],
  };

  // 6. Writes
  const writesAccess = i.reach.filter((x) => x.has.some((h) => h !== "read"));
  const outOn = (id: string) => !setup?.outputsOff.includes(id);
  const envSet = (k?: string) => !!(k && process.env[k]?.trim());
  const target = !menu?.notion ? "" : setup?.notion ? `${setup.notion.kind === "database" ? "Database" : "Page"} “${setup.notion.title}”` : envSet(menu.notion.envDb) ? `The database in ${menu.notion.envDb}` : envSet(menu.notion.envPage) ? `A page per run under ${menu.notion.envPage}` : a.id !== "chief_of_staff" && env.notionBriefParent ? "A page per run under NOTION_BRIEF_PARENT_ID" : "Not set";
  const sectionLabel = (id: string) => menu?.sections.find((x) => x.id === id)?.label ?? id;
  const tools = Object.entries(TOOLS).filter(([, t]) => (t.agents as readonly string[]).includes(a.id));
  const writes: CanvasBox = {
    id: "writes", title: "Writes · outputs", icon: "shield-check",
    replay: writesAccess.map((x) => `${x.conn.name}${x.has.includes("do") ? " · asks first" : ""}`),
    edit: menu && setup ? [menu.outputs.filter((o) => outOn(o.id)).map((o) => o.label).join(" + ") || "Nothing on", ...(menu.sections.length ? [`${liveSections(menu, setup).length} sections`] : []), ...numbers("writes").map((r) => `${r.label} ${r.value}`)] : menu ? menu.outputs.map((o) => o.label) : writesAccess.map((x) => x.conn.name),
    editable: !!(setup && menu && (menu.outputs.some((o) => !o.locked) || menu.notion || menu.sections.length || numbers("writes").length)),
    rows: menu
      ? [
        ...menu.outputs.map((o): CanvasRow => ({ label: o.label, value: outOn(o.id) ? o.detail : `Off. ${o.detail}`, home: o.locked ? "code" : "app", where: o.locked ? `Always on · built in ${file}` : `${from(setup?.fromSetup.outputs)} · keys in Vercel: ${(o.env ?? []).join(", ")}`, status: outOn(o.id) ? status(o.locked ? (health[o.integration as IntegrationId] ?? false) : has(o.env)) : undefined })),
        ...(menu.notion ? [{ label: menu.notion.pageOnly ? "Notion page goes under" : "Notion copy goes to", value: target, home: setup?.notion ? "app" : "vercel", where: setup?.notion ? `Setup v${setup.version}. Picked from pages shared with the Notion integration` : `${[menu.notion.envDb, menu.notion.envPage].filter(Boolean).join(" or ")} in Vercel, until a ${menu.notion.pageOnly ? "page" : "target"} is picked here` } as CanvasRow] : []),
        ...(setup && menu.sections.length ? [{ label: "Sections, in order", value: liveSections(menu, setup).map(sectionLabel).join(", "), home: "app", where: `${from(setup.fromSetup.sections)}. A section whose fact source is off is left out` } as CanvasRow] : []),
        { label: "Gateway actions", value: tools.length ? tools.map(([k, t]) => `${k} (${t.tier})`).join(", ") : "None. It can’t send, pay or post.", home: "code", where: "core/gateway/policy.ts. A new action type is a pull request and starts at Draft" },
        ...numbers("writes"), ...choices("writes"), ...fixed("writes"),
      ]
      : writesAccess.map((x): CanvasRow => ({ label: x.conn.name, value: [...(x.by.hands ?? []), ...(x.by.do ?? [])].join(", "), home: "app", where: "Its saved setup", status: status(isSetUp(x.conn, health)) })),
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
