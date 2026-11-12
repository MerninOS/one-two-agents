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
  /** Model ids this step may use. The first one is not special: `model` below is the default. */
  models: readonly string[];
  model: string;
  effort: Effort;
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
}

export interface Setup {
  agentId: string;
  /** The active version, or null when the menu's built-in defaults are in use. */
  version: number | null;
  note: string | null;
  createdAt: string | null;
  model: string;
  effort: Effort;
  instructions: string;
  numbers: Record<string, number>;
  /** Which values came from the setup row; everything else is the menu's default. */
  fromSetup: { model: boolean; effort: boolean; instructions: boolean; numbers: Record<string, boolean> };
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
    model: step.model, effort: step.effort, instructions: menu.instructions,
    numbers: Object.fromEntries(Object.entries(menu.numbers).map(([k, d]) => [k, d.default])),
    fromSetup: { model: false, effort: false, instructions: false, numbers: {} },
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
