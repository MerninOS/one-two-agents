import "server-only";
// Agent setup (docs/agent-setup.md): the choices Zak makes for an agent, picked from the
// agent's menu.
//
// The menu is code (agents/<id>/menu.ts): the thinking steps and the models each may use,
// the fact sources, the outputs, and every tuning number with its default, lowest and
// highest value. The setup is a row in `agent_setup`: only choices from that menu.
//
// A setup is choices, never authority. It can't add an integration, a fact source, an output
// or a gateway action type, and nothing that decides what an agent may do reads this file:
// lint keeps core/gateway and integrations/ from importing it. Anything in a setup that the
// menu doesn't offer is ignored and the menu's default is used, so an agent always runs.
import { db } from "@/core/db";

export type Effort = "low" | "medium" | "high";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high"];
/** Longest instructions a setup may hold. The built-in text is about 1,500 characters. */
export const MAX_INSTRUCTIONS = 6000;

/** Where a setting lives: picked in the app, fixed in code, a key in Vercel, or a row in Supabase with no screen yet. */
export type Home = "app" | "code" | "vercel" | "database";

export interface StepDef {
  id: string;
  label: string;
  /** What the step needs from a model, in plain words, for the canvas. */
  needs: string;
  /** What the step needs from a model (integrations/models.ts Cap): only models with all of it are offered. */
  requires: readonly string[];
  /** Model ids this step may use: integrations/models.ts modelsFor(requires). `model` below is the default. */
  models: readonly string[];
  model: string;
  effort: Effort;
  /** Tried once when `model` can't be reached, before the agent's fixed rules. Null: straight to the rules. */
  fallback: string | null;
  /** The agent's code has no fallback for this step, so a setup can't pick one. */
  fallbackOff?: boolean;
}

/** The model choice for one thinking step. */
export interface StepChoice { model: string; effort: Effort; fallback: string | null }

export interface NumberDef {
  label: string;
  /** Which canvas box it belongs to. */
  box: "reads" | "thinking" | "guardrails" | "writes" | "memory";
  unit: string;
  default: number;
  min: number;
  max: number;
}

/** A fact source or an output: built in code, listed here so the canvas can show it. */
export interface PartDef {
  id: string;
  label: string;
  detail: string;
  /** An IntegrationId from dashboard/crew.ts, for the Connected / Missing key status. */
  integration: string;
  /** Env vars this part needs, by name only. Values never leave the server. */
  env?: readonly string[];
  /** Always on: the agent can't work without it (a table its next run reads). */
  locked?: boolean;
}

/** A pick-list setting (Rowan's areas, the kinds of business): options are fixed in code, a setup picks some. */
export interface ChoiceDef {
  label: string;
  box: NumberDef["box"];
  detail: string;
  options: readonly { id: string; label: string }[];
  default: readonly string[];
  min: number;
  max: number;
}

/** A part of the agent's output (a section of the brief). Order and on/off are setup choices. */
export interface SectionDef {
  id: string;
  label: string;
  detail: string;
  /** Fact sources (PartDef ids in `reads`) it is built from: with any of them off, the section is left out. */
  needs?: readonly string[];
  /** Always on: the output makes no sense without it. */
  locked?: boolean;
}

/** Where a Notion output may go: any page shared with the integration, or a database with these properties. */
export interface NotionDef {
  /** The output id in `outputs` this target is for. */
  output: string;
  /** Property name to Notion type ("title", "date", "number", "rich_text", "checkbox") that a database must have. */
  dbProps: Record<string, string>;
  /** Env vars used when the setup picks no target, in order: a database id, then a parent page id. */
  envDb?: string;
  envPage?: string;
  /** The agent writes a new page each run, so only a parent page can be picked, not a database. */
  pageOnly?: boolean;
}

/** A Notion page or database the brief goes to, picked in the Control Room from what the integration can see. */
export interface NotionTarget { kind: "database" | "page"; id: string; title: string }

/** A value that is fixed in code today, shown on the canvas so nothing is hidden. */
export interface FixedDef { box: NumberDef["box"]; label: string; value: string; note?: string }

export interface AgentMenu {
  agentId: string;
  /**
   * The thinking steps. The first is the one `Setup.model` describes; the others are in
   * `Setup.more`. Empty for an agent that calls no model (Morgan): computed in code.
   */
  steps: readonly StepDef[];
  numbers: Record<string, NumberDef>;
  choices?: Record<string, ChoiceDef>;
  reads: readonly PartDef[];
  outputs: readonly PartDef[];
  /** The output's sections, in their built-in order. */
  sections: readonly SectionDef[];
  notion?: NotionDef;
  fixed: readonly FixedDef[];
  /** The built-in instructions, used until a setup holds its own. */
  instructions: string;
  /** The instructions are fixed in code (several prompts, or none), so a setup can't change them. */
  instructionsLocked?: boolean;
  /**
   * The locked safety block, for the canvas only. The agent's code sends its own copy first on
   * every call; a setup can't change or remove it.
   */
  safety: string;
}

export interface Setup {
  agentId: string;
  /** The active version, or null when the menu's built-in defaults are in use. */
  version: number | null;
  note: string | null;
  createdAt: string | null;
  model: string;
  effort: Effort;
  fallback: string | null;
  instructions: string;
  /** Model choices for the steps after the first, by step id. */
  more: Record<string, StepChoice>;
  numbers: Record<string, number>;
  /** Pick-list settings, by key in the menu's `choices`. */
  choices: Record<string, string[]>;
  /** Fact sources turned off (ids in the menu's `reads`). */
  readsOff: string[];
  /** Outputs turned off (ids in the menu's `outputs`). Never all of them. */
  outputsOff: string[];
  /** Sections that are on, in order. Locked sections are always in. */
  sections: string[];
  /** The Notion page or database picked in the app; null means the env vars (NOTION_BRIEFS_DB_ID, NOTION_BRIEF_PARENT_ID). */
  notion: NotionTarget | null;
  /** Which values came from the setup row; everything else is the menu's default. */
  fromSetup: { model: boolean; effort: boolean; fallback: boolean; instructions: boolean; more: Record<string, boolean>; numbers: Record<string, boolean>; choices: Record<string, boolean>; reads: boolean; outputs: boolean; sections: boolean; notion: boolean };
  /** Values in the row that the menu doesn't offer. Each was ignored and the default used. */
  problems: string[];
}

interface Row { version: number; setup: unknown; note: string | null; created_at: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The menu's defaults with a setup row laid over them. Pure: no I/O.
 * A value the menu doesn't offer (a model not on the step's list, a number outside its
 * range) is dropped with a line in `problems`, never clamped into something Zak didn't pick.
 */
export function resolveSetup(menu: AgentMenu, row: Row | null): Setup {
  const step = menu.steps[0] as StepDef | undefined;
  const s: Setup = {
    agentId: menu.agentId, version: row?.version ?? null, note: row?.note ?? null, createdAt: row?.created_at ?? null,
    model: step?.model ?? NO_MODEL, effort: step?.effort ?? "low", fallback: step?.fallback ?? null, instructions: menu.instructions,
    more: Object.fromEntries(menu.steps.slice(1).map((d) => [d.id, { model: d.model, effort: d.effort, fallback: d.fallback }])),
    numbers: Object.fromEntries(Object.entries(menu.numbers).map(([k, d]) => [k, d.default])),
    choices: Object.fromEntries(Object.entries(menu.choices ?? {}).map(([k, d]) => [k, [...d.default]])),
    readsOff: [], outputsOff: [], sections: menu.sections.map((x) => x.id), notion: null,
    fromSetup: { model: false, effort: false, fallback: false, instructions: false, more: {}, numbers: {}, choices: {}, reads: false, outputs: false, sections: false, notion: false },
    problems: [],
  };
  if (!row) return s;
  const raw = obj(row.setup), thinking = step ? obj(raw.thinking) : {}, numbers = obj(raw.numbers), reads = obj(raw.reads), writes = obj(raw.writes), choices = obj(raw.choices);
  if (!step && Object.keys(obj(raw.thinking)).length) s.problems.push("this agent calls no model, so thinking choices were ignored");
  if (step?.fallbackOff && thinking.fallback !== undefined && thinking.fallback !== null) { s.problems.push(`${step.label} has no fallback`); delete thinking.fallback; }
  if (menu.instructionsLocked && thinking.instructions !== undefined && thinking.instructions !== null) { s.problems.push("the instructions are fixed in code"); delete thinking.instructions; }

  if (thinking.model !== undefined && step) {
    if (typeof thinking.model === "string" && step.models.includes(thinking.model)) { s.model = thinking.model; s.fromSetup.model = true; }
    else s.problems.push(`model ${JSON.stringify(thinking.model)} is not on ${step.label}'s list`);
  }
  if (thinking.effort !== undefined && step) {
    if (EFFORTS.includes(thinking.effort as Effort)) { s.effort = thinking.effort as Effort; s.fromSetup.effort = true; }
    else s.problems.push(`effort ${JSON.stringify(thinking.effort)} is not low, medium or high`);
  }
  if (thinking.fallback !== undefined && step) {
    if (thinking.fallback === null || (typeof thinking.fallback === "string" && step.models.includes(thinking.fallback))) { s.fallback = thinking.fallback as string | null; s.fromSetup.fallback = true; }
    else s.problems.push(`fallback model ${JSON.stringify(thinking.fallback)} is not on ${step.label}'s list`);
  }
  if (thinking.instructions !== undefined && thinking.instructions !== null) {
    const t = typeof thinking.instructions === "string" ? thinking.instructions.trim() : "";
    if (t && t.length <= MAX_INSTRUCTIONS) { s.instructions = t; s.fromSetup.instructions = true; }
    else s.problems.push(t ? `instructions are longer than ${MAX_INSTRUCTIONS} characters` : "instructions are empty");
  }
  for (const [id, v] of Object.entries(obj(thinking.steps))) {
    const d = menu.steps.slice(1).find((x) => x.id === id);
    if (!d) { s.problems.push(`"${id}" is not a thinking step this agent has`); continue; }
    const c = resolveStep(d, v);
    if (typeof c === "string") s.problems.push(c); else { s.more[id] = c; s.fromSetup.more[id] = true; }
  }
  for (const [k, v] of Object.entries(choices)) {
    const d = menu.choices?.[k];
    if (!d) { s.problems.push(`"${k}" is not a setting this agent has`); continue; }
    const on = Array.isArray(v) && v.every((x) => typeof x === "string") ? [...new Set(v as string[])] : null;
    const bad = on?.filter((x) => !d.options.some((o) => o.id === x)) ?? [];
    if (!on || bad.length) s.problems.push(on ? `${d.label}: ${bad.join(", ")} is not on the list` : `${d.label} is not a list`);
    else if (on.length < d.min || on.length > d.max) s.problems.push(`${d.label} needs ${d.min} to ${d.max} picks`);
    else { s.choices[k] = on; s.fromSetup.choices[k] = true; }
  }
  for (const [k, v] of Object.entries(numbers)) {
    const d = menu.numbers[k];
    if (!d) { s.problems.push(`"${k}" is not a setting this agent has`); continue; }
    if (typeof v === "number" && Number.isFinite(v) && v >= d.min && v <= d.max) { s.numbers[k] = v; s.fromSetup.numbers[k] = true; }
    else s.problems.push(`${d.label} ${JSON.stringify(v)} is outside ${d.min} to ${d.max}`);
  }
  if (reads.off !== undefined) {
    const off = ids(reads.off), bad = off?.filter((x) => !menu.reads.some((r) => r.id === x)) ?? [];
    const locked = off?.filter((x) => menu.reads.find((r) => r.id === x)?.locked) ?? [];
    if (off && !bad.length && !locked.length) { s.readsOff = off; s.fromSetup.reads = true; }
    else s.problems.push(!off ? "the list of fact sources turned off is not a list" : bad.length ? `fact source ${bad.join(", ")} is not on the menu` : `${locked.join(", ")} can't be turned off`);
  }
  if (writes.off !== undefined) {
    const off = ids(writes.off), bad = off?.filter((x) => !menu.outputs.some((o) => o.id === x)) ?? [];
    const locked = off?.filter((x) => menu.outputs.find((o) => o.id === x)?.locked) ?? [];
    if (!off || bad.length) s.problems.push(off ? `output ${bad.join(", ")} is not on the menu` : "the list of outputs turned off is not a list");
    else if (locked.length) s.problems.push(`${locked.join(", ")} can't be turned off`);
    else if (menu.outputs.length && off.length >= menu.outputs.length) s.problems.push("every output was turned off, so all stay on");
    else { s.outputsOff = off; s.fromSetup.outputs = true; }
  }
  if (writes.sections !== undefined) {
    const on = ids(writes.sections), bad = on?.filter((x) => !menu.sections.some((d) => d.id === x)) ?? [];
    const missing = menu.sections.filter((d) => d.locked && !on?.includes(d.id)).map((d) => d.label);
    if (!on || bad.length || new Set(on).size !== on.length) s.problems.push(on ? (bad.length ? `section ${bad.join(", ")} is not on the menu` : "a section is listed twice") : "the section list is not a list");
    else if (missing.length) s.problems.push(`${missing.join(", ")} can't be turned off`);
    else { s.sections = on; s.fromSetup.sections = true; }
  }
  if (writes.notion !== undefined && writes.notion !== null) {
    const t = notionTarget(writes.notion);
    if (t && menu.notion?.pageOnly && t.kind === "database") s.problems.push("this agent writes a new page each run, so the Notion target must be a page");
    else if (t && menu.notion) { s.notion = t; s.fromSetup.notion = true; }
    else s.problems.push(menu.notion ? "the Notion target is not a page or database id" : "this agent has no Notion output");
  }
  return s;
}

/** The model id an agent with no thinking step reports. */
export const NO_MODEL = "none";

/** One extra step's stored choice, checked against its menu entry; a string says why it was ignored. */
function resolveStep(d: StepDef, v: unknown): StepChoice | string {
  const x = obj(v);
  const c: StepChoice = { model: d.model, effort: d.effort, fallback: d.fallback };
  if (x.model !== undefined) { if (typeof x.model === "string" && d.models.includes(x.model)) c.model = x.model; else return `model ${JSON.stringify(x.model)} is not on ${d.label}'s list`; }
  if (x.effort !== undefined) { if (EFFORTS.includes(x.effort as Effort)) c.effort = x.effort as Effort; else return `${d.label} effort ${JSON.stringify(x.effort)} is not low, medium or high`; }
  if (x.fallback !== undefined) {
    if (x.fallback === null) c.fallback = null;
    else if (!d.fallbackOff && typeof x.fallback === "string" && d.models.includes(x.fallback)) c.fallback = x.fallback;
    else return d.fallbackOff ? `${d.label} has no fallback` : `fallback ${JSON.stringify(x.fallback)} is not on ${d.label}'s list`;
  }
  return c;
}

/** A list of short ids, or null. */
const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && /^[a-z0-9_]{1,40}$/.test(x)) ? [...v] as string[] : null);

/** A Notion target in the stored shape, or null. The id is 32 hex characters; the title is only for showing. */
export function notionTarget(v: unknown): NotionTarget | null {
  const x = obj(v);
  const id = typeof x.id === "string" ? x.id.replace(/-/g, "").toLowerCase() : "";
  if ((x.kind !== "database" && x.kind !== "page") || !/^[0-9a-f]{32}$/.test(id)) return null;
  const title = typeof x.title === "string" ? x.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { kind: x.kind, id, title: title || "Untitled" };
}

/** The sections that will be written: on in the setup, and every fact source they need is read. In order. */
export function liveSections(menu: AgentMenu, s: Pick<Setup, "sections" | "readsOff">): string[] {
  return s.sections.filter((id) => !(menu.sections.find((d) => d.id === id)?.needs ?? []).some((r) => s.readsOff.includes(r)));
}

/** Is this output on? */
export const outputOn = (s: Pick<Setup, "outputsOff">, id: string) => !s.outputsOff.includes(id);

/** The agent's active setup. Throws when the table can't be read; see setupOrDefaults. */
export async function loadSetup(menu: AgentMenu): Promise<Setup> {
  const { data, error } = await db().from("agent_setup").select("version, setup, note, created_at").eq("agent_id", menu.agentId).eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  return resolveSetup(menu, data as Row | null);
}

/**
 * The active setup, or the menu's defaults when the table can't be read (not migrated yet,
 * Supabase down). Never throws: a setup that can't be loaded must not stop a run.
 */
export async function setupOrDefaults(menu: AgentMenu): Promise<{ setup: Setup; problem?: string }> {
  try { return { setup: await loadSetup(menu) }; }
  catch (e) { return { setup: resolveSetup(menu, null), problem: (e instanceof Error ? e.message : String(e)).slice(0, 100) }; }
}

/** A short line for run summaries: "setup v3", or "built-in setup". */
export const setupWords = (s: Setup) => `${s.version == null ? "built-in setup" : `setup v${s.version}`}${s.problems.length ? ` (ignored: ${s.problems.join("; ").slice(0, 160)})` : ""}`;

// ---- Editing a setup in the Control Room (slices 2 and 4)

/** What the setup editors send: every editable value, picked from the menu. One draft covers all the boxes. */
export interface SetupDraft {
  model: string; effort: Effort; fallback: string | null; instructions: string;
  more: Record<string, StepChoice>;
  numbers: Record<string, number>;
  choices: Record<string, string[]>;
  readsOff: string[]; outputsOff: string[]; sections: string[]; notion: NotionTarget | null;
}

/** The setup's values as a draft. */
export const toDraft = (s: Setup): SetupDraft => ({ model: s.model, effort: s.effort, fallback: s.fallback, instructions: s.instructions, more: JSON.parse(JSON.stringify(s.more)), numbers: { ...s.numbers }, choices: JSON.parse(JSON.stringify(s.choices)), readsOff: [...s.readsOff], outputsOff: [...s.outputsOff], sections: [...s.sections], notion: s.notion });

/** The draft as a setup. Problems mean the draft asks for something the menu doesn't offer. */
export function fromDraft(menu: AgentMenu, base: Setup, d: SetupDraft): Setup {
  const s = resolveSetup(menu, { version: 0, setup: rawSetup(menu, base, d), note: null, created_at: "" });
  return { ...s, version: null, note: null, createdAt: null };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** True when two setups would run the same way. */
export const sameSetup = (a: Setup, b: Setup) => same(toDraft(a), toDraft(b));

/**
 * The JSON a new version stores. Thinking values always; anything else only when it differs
 * from the menu's default or the base setup already chose it, so a version that keeps a
 * default follows the code when the default improves (the built-in instructions, a new section).
 */
function rawSetup(menu: AgentMenu, base: Setup, d: SetupDraft) {
  const def = resolveSetup(menu, null);
  const instructions = typeof d.instructions === "string" ? d.instructions.trim() : d.instructions;
  const keep = <T>(v: T, dv: T, chosen: boolean) => (chosen || !same(v, dv) ? v : undefined);
  const numbers = Object.fromEntries(Object.entries(d.numbers ?? {}).filter(([k, v]) => base.fromSetup.numbers[k] || v !== def.numbers[k]));
  const choices = Object.fromEntries(Object.entries(d.choices ?? {}).filter(([k, v]) => base.fromSetup.choices[k] || !same(v, def.choices[k])));
  const steps = Object.fromEntries(Object.entries(d.more ?? {}).filter(([k, v]) => base.fromSetup.more[k] || !same(v, def.more[k])));
  const off = keep(d.readsOff, def.readsOff, base.fromSetup.reads);
  const writes = { off: keep(d.outputsOff, def.outputsOff, base.fromSetup.outputs), sections: keep(d.sections, def.sections, base.fromSetup.sections), notion: d.notion ?? undefined };
  return {
    ...(menu.steps.length ? { thinking: { model: d.model, effort: d.effort, fallback: d.fallback ?? null, ...(menu.instructionsLocked || instructions === menu.instructions.trim() ? {} : { instructions }), ...(Object.keys(steps).length ? { steps } : {}) } } : {}),
    numbers,
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(off ? { reads: { off } } : {}),
    ...(Object.values(writes).some((v) => v !== undefined) ? { writes } : {}),
  };
}

const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2 };
type Loosen = Pick<Setup, "model" | "effort" | "fallback" | "outputsOff" | "notion"> & { more?: Setup["more"] };

/**
 * Why `next` is looser than `now`, or [] when it isn't: it costs more (a pricier model or
 * fallback, more effort) or it sends the output somewhere new (an output turned back on, a
 * different Notion target). Loosening needs a confirm and DASHBOARD_CONTROLS=on; tightening
 * never does. `price` is the model's $ per output token (integrations/anthropic.ts priceOf).
 */
export function loosening(menu: AgentMenu, now: Loosen, next: Loosen, price: (m: string) => number): string[] {
  const out: string[] = [];
  if (price(next.model) > price(now.model)) out.push(`${next.model} costs more per token than ${now.model}`);
  if (next.fallback && (!now.fallback || price(next.fallback) > price(now.fallback))) out.push(`fallback ${next.fallback} costs more than ${now.fallback ?? "no fallback"}`);
  if (EFFORT_RANK[next.effort] > EFFORT_RANK[now.effort]) out.push(`effort ${next.effort} uses more tokens than ${now.effort}`);
  for (const d of menu.steps.slice(1)) {
    const a = now.more?.[d.id], b = next.more?.[d.id];
    if (!a || !b) continue;
    if (price(b.model) > price(a.model)) out.push(`${d.label}: ${b.model} costs more per token than ${a.model}`);
    if (b.fallback && (!a.fallback || price(b.fallback) > price(a.fallback))) out.push(`${d.label}: fallback ${b.fallback} costs more than ${a.fallback ?? "no fallback"}`);
    if (EFFORT_RANK[b.effort] > EFFORT_RANK[a.effort]) out.push(`${d.label}: effort ${b.effort} uses more tokens than ${a.effort}`);
  }
  for (const o of menu.outputs) if (now.outputsOff.includes(o.id) && !next.outputsOff.includes(o.id)) out.push(`${o.label} turned back on`);
  if (next.notion && next.notion.id !== now.notion?.id) out.push(`the Notion copy goes to a different ${next.notion.kind}: ${next.notion.title}`);
  return out;
}

export interface SetupVersion { version: number; active: boolean; note: string | null; createdBy: string; createdAt: string; setup: Setup }

/** Every saved version of an agent's setup, newest first. Throws when the table can't be read. */
export async function listVersions(menu: AgentMenu): Promise<SetupVersion[]> {
  const { data, error } = await db().from("agent_setup").select("version, setup, note, created_at, created_by, active").eq("agent_id", menu.agentId).order("version", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ version: r.version, active: r.active, note: r.note, createdBy: r.created_by, createdAt: r.created_at, setup: resolveSetup(menu, r as Row) }));
}

/** Makes `version` the active one. The old active row is switched off first (one active per agent), and back on if this fails. */
async function activate(agentId: string, version: number, previous: number | null) {
  if (previous != null) {
    const { error } = await db().from("agent_setup").update({ active: false }).eq("agent_id", agentId).eq("version", previous);
    if (error) throw new Error(error.message);
  }
  const { error } = await db().from("agent_setup").update({ active: true }).eq("agent_id", agentId).eq("version", version);
  if (error) {
    if (previous != null) await db().from("agent_setup").update({ active: true }).eq("agent_id", agentId).eq("version", previous);
    throw new Error(error.message);
  }
}

/**
 * Saves the draft as the next version and makes it active. The caller has already checked the
 * login, loosening and controls (dashboard/actions.ts). Returns the new version number.
 */
export async function saveVersion(menu: AgentMenu, base: Setup, d: SetupDraft, note: string, by: string): Promise<number> {
  const next = fromDraft(menu, base, d);
  if (next.problems.length) throw new Error(`Not saved: ${next.problems.join("; ")}`);
  const { data: top, error: e1 } = await db().from("agent_setup").select("version").eq("agent_id", menu.agentId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (e1) throw new Error(e1.message);
  const version = (top?.version ?? 0) + 1;
  const { error } = await db().from("agent_setup").insert({ agent_id: menu.agentId, version, setup: rawSetup(menu, base, d), note, created_by: by, active: false });
  if (error) throw new Error(error.message);
  await activate(menu.agentId, version, base.version);
  return version;
}

/** Makes an earlier version active again. Nothing is deleted; the version list keeps every row. */
export async function rollBack(menu: AgentMenu, base: Setup, version: number): Promise<void> {
  if (version === base.version) throw new Error(`v${version} is already active.`);
  const { data, error } = await db().from("agent_setup").select("version").eq("agent_id", menu.agentId).eq("version", version).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`There is no v${version}.`);
  await activate(menu.agentId, version, base.version);
}

/**
 * What a Preview shows: the agent's real output for a draft setup, with nothing written or
 * sent. Built by the agent's own preview function (agents/registry.ts).
 */
export interface SetupPreview {
  /** The model that wrote the answer: the draft's model, its fallback, or "rules" when neither could be reached. */
  servedBy: string;
  watch: string[];
  focus: { action: string; reason: string };
  remember: string[];
  email: { subject: string; html: string } | null;
  /** The Briefs database row it would write, as label and value. Empty when the Notion copy isn't a database. */
  row: [string, string][];
  /** Where a real run would send it, in words. */
  sendsTo: string;
  /** The sections it would include, in order. */
  sections: string[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  note: string;
}
