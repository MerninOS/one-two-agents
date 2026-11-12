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
}

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
}

/** A value that is fixed in code today, shown on the canvas so nothing is hidden. */
export interface FixedDef { box: NumberDef["box"]; label: string; value: string; note?: string }

export interface AgentMenu {
  agentId: string;
  /** One thinking step for now; an agent with two model calls gets two. The first is the one `Setup.model` describes. */
  steps: readonly StepDef[];
  numbers: Record<string, NumberDef>;
  reads: readonly PartDef[];
  outputs: readonly PartDef[];
  fixed: readonly FixedDef[];
  /** The built-in instructions, used until a setup holds its own. */
  instructions: string;
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
  numbers: Record<string, number>;
  /** Which values came from the setup row; everything else is the menu's default. */
  fromSetup: { model: boolean; effort: boolean; fallback: boolean; instructions: boolean; numbers: Record<string, boolean> };
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
  const step = menu.steps[0];
  const s: Setup = {
    agentId: menu.agentId, version: row?.version ?? null, note: row?.note ?? null, createdAt: row?.created_at ?? null,
    model: step.model, effort: step.effort, fallback: step.fallback, instructions: menu.instructions,
    numbers: Object.fromEntries(Object.entries(menu.numbers).map(([k, d]) => [k, d.default])),
    fromSetup: { model: false, effort: false, fallback: false, instructions: false, numbers: {} },
    problems: [],
  };
  if (!row) return s;
  const raw = obj(row.setup), thinking = obj(raw.thinking), numbers = obj(raw.numbers);

  if (thinking.model !== undefined) {
    if (typeof thinking.model === "string" && step.models.includes(thinking.model)) { s.model = thinking.model; s.fromSetup.model = true; }
    else s.problems.push(`model ${JSON.stringify(thinking.model)} is not on ${step.label}'s list`);
  }
  if (thinking.effort !== undefined) {
    if (EFFORTS.includes(thinking.effort as Effort)) { s.effort = thinking.effort as Effort; s.fromSetup.effort = true; }
    else s.problems.push(`effort ${JSON.stringify(thinking.effort)} is not low, medium or high`);
  }
  if (thinking.fallback !== undefined) {
    if (thinking.fallback === null || (typeof thinking.fallback === "string" && step.models.includes(thinking.fallback))) { s.fallback = thinking.fallback as string | null; s.fromSetup.fallback = true; }
    else s.problems.push(`fallback model ${JSON.stringify(thinking.fallback)} is not on ${step.label}'s list`);
  }
  if (thinking.instructions !== undefined && thinking.instructions !== null) {
    const t = typeof thinking.instructions === "string" ? thinking.instructions.trim() : "";
    if (t && t.length <= MAX_INSTRUCTIONS) { s.instructions = t; s.fromSetup.instructions = true; }
    else s.problems.push(t ? `instructions are longer than ${MAX_INSTRUCTIONS} characters` : "instructions are empty");
  }
  for (const [k, v] of Object.entries(numbers)) {
    const d = menu.numbers[k];
    if (!d) { s.problems.push(`"${k}" is not a setting this agent has`); continue; }
    if (typeof v === "number" && Number.isFinite(v) && v >= d.min && v <= d.max) { s.numbers[k] = v; s.fromSetup.numbers[k] = true; }
    else s.problems.push(`${d.label} ${JSON.stringify(v)} is outside ${d.min} to ${d.max}`);
  }
  return s;
}

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

// ---- Editing a setup in the Control Room (slice 2)

/** What the Thinking editor sends: every Thinking value, picked from the menu. */
export interface ThinkingDraft { model: string; effort: Effort; fallback: string | null; instructions: string }

/** The draft laid over `base` (its tuning numbers are kept). Problems mean the draft asks for something the menu doesn't offer. */
export function fromDraft(menu: AgentMenu, base: Setup, d: ThinkingDraft): Setup {
  const raw = rawSetup(menu, base, d);
  const s = resolveSetup(menu, { version: 0, setup: raw, note: null, created_at: "" });
  return { ...s, version: null, note: null, createdAt: null };
}

/**
 * The JSON a new version stores: the Thinking values, and the numbers the base setup picked.
 * Instructions are stored only when they differ from the built-in text, so a version that
 * keeps the built-in text follows it when the code's copy is improved.
 */
function rawSetup(menu: AgentMenu, base: Setup, d: ThinkingDraft) {
  const instructions = typeof d.instructions === "string" ? d.instructions.trim() : d.instructions;
  return {
    thinking: { model: d.model, effort: d.effort, fallback: d.fallback ?? null, ...(instructions === menu.instructions.trim() ? {} : { instructions }) },
    numbers: Object.fromEntries(Object.entries(base.numbers).filter(([k]) => base.fromSetup.numbers[k])),
  };
}

const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2 };

/**
 * Why `next` costs more to run than `now`, or [] when it doesn't: a pricier model, a pricier
 * fallback, or more effort. Loosening needs a confirm and DASHBOARD_CONTROLS=on; tightening
 * never does. `price` is the model's $ per output token (integrations/anthropic.ts priceOf).
 */
export function loosening(now: Pick<Setup, "model" | "effort" | "fallback">, next: Pick<Setup, "model" | "effort" | "fallback">, price: (m: string) => number): string[] {
  const out: string[] = [];
  if (price(next.model) > price(now.model)) out.push(`${next.model} costs more per token than ${now.model}`);
  if (next.fallback && (!now.fallback || price(next.fallback) > price(now.fallback))) out.push(`fallback ${next.fallback} costs more than ${now.fallback ?? "no fallback"}`);
  if (EFFORT_RANK[next.effort] > EFFORT_RANK[now.effort]) out.push(`effort ${next.effort} uses more tokens than ${now.effort}`);
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
export async function saveVersion(menu: AgentMenu, base: Setup, d: ThinkingDraft, note: string, by: string): Promise<number> {
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
  /** The Briefs database row it would write, as label and value. */
  row: [string, string][];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  note: string;
}
