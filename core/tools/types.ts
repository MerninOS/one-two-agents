// The shape of a tool on the tool list (docs/agent-builder.md). A tool is a small, specific
// ability written in code. An agent built in the app can only be handed tools from this list,
// and the model can only call the tools its spec grants. Adding a tool is a pull request on
// purpose, so nothing a model reads (a web page, an email, another agent's words) can add one.

/**
 * read: fetches data. calculate: plain code that works numbers out, no model, so numbers are
 * always computed in code. report: delivers a finished run's result to Zak or our own stores;
 * code does it after the run, the model never calls it. action: a proposal the model makes,
 * queued by code at core/gateway after the run, as an approval card for Zak.
 */
export type ToolKind = "read" | "calculate" | "report" | "action";

/** Groups on the builder screen, one per integration. */
export type ToolGroup = "shopify" | "mercury" | "supabase" | "notion" | "calculate" | "agents" | "web" | "gmail" | "email";

/** One input the model may pass. Kept to plain shapes so code can check every value. */
export type Param =
  | { name: string; type: "int"; min: number; max: number; default: number; description: string }
  | { name: string; type: "enum"; options: readonly string[]; default?: string; description: string }
  /**
   * Action tools only. A row from a tool result earlier in the same run, named by its step and the
   * pick code gave it (like numbers in finish). This is how an action names a transaction or a
   * category: never typed by the model, always one a tool returned, so text from a web page or a
   * merchant name can't choose a recipient, product or category.
   */
  | { name: string; type: "pick"; kind: string; optional?: boolean; description: string }
  /** Action tools only. Short plain text, checked in code: no links, no control characters. */
  | { name: string; type: "text"; maxLength: number; optional?: boolean; description: string };

/** A row a tool returned that an action may name: what kind of thing it is, its real id, and a label for the approval card. */
export interface Pick { kind: string; id: string; label: string }
export interface PickRef { step: number; pick: string }

export interface ToolCtx {
  agentId: string;
  /** Notion pages the spec allows notion_read_page to open: the model picks one of these ids, never a URL. */
  notionPages: { id: string; label: string }[];
  /** Agents whose latest output agent_output may read: the model picks one of these ids. */
  outputSources: { agentId: string; label: string }[];
  /** The Notion page a Notion report writes under, picked in the builder. */
  reportPage?: { id: string; label: string } | null;
}

export interface ToolResult {
  /** What the model sees. Serialised and cut to a size limit by the runner. */
  data: unknown;
  /** Numbers this tool computed in code. Later slices only let outputs and checks use numbers from here. */
  numbers?: Record<string, number>;
  /** Rows an action may name, by the pick code shown next to each row in `data`. */
  picks?: Record<string, Pick>;
}

/** What a report delivers: the finished run's result, never anything else the model wrote. */
export interface ReportInput { agentName: string; outputName: string; summary: string; numbers: { label: string; value: number }[]; date: string }

/** What an action tool hands the runner once its inputs are checked and its picks resolved. */
export interface Staged {
  /** The gateway tool it becomes (core/gateway/policy.ts TOOLS). */
  gatewayTool: string;
  target: string;
  args: Record<string, unknown>;
  actionType: string;
  title: string;
  preview: Record<string, unknown>;
}

export interface ToolDef {
  id: string;
  label: string;
  /** One line for the builder screen and the model. */
  detail: string;
  kind: ToolKind;
  group: ToolGroup;
  params: readonly Param[];
  /** When the inputs depend on the spec (Notion pages the spec allows), this replaces params. */
  paramsFor?: (ctx: ToolCtx) => Param[];
  /**
   * False when what comes back is written by people outside One Two (web pages, emails, merchant
   * names, lead websites, another agent's summary). The runner labels it as untrusted data, and
   * slice 5 stops a run that read it from choosing a recipient, URL, product or category.
   */
  trusted: boolean;
  /** Which settings must be present, by name (core/env.ts); the builder shows Connected or Missing key. */
  needs: readonly string[];
  /** Rough cost of one call outside the model, in dollars (0 for most). */
  costUsd: number;
  /** Read and calculate tools. */
  run?: (input: Record<string, string | number>, ctx: ToolCtx) => Promise<ToolResult>;
  /** Report tools: code calls it after a finished run. Returns a short note (a link, an id). */
  deliver?: (out: ReportInput, ctx: ToolCtx) => Promise<string>;
  /**
   * Report tools that save numbers code works out again itself and never use the model's words
   * (Morgan's snapshot). In a playbook run they are delivered as soon as every playbook step has
   * worked, so a model that can't be reached doesn't stop the numbers being saved.
   */
  codeOnly?: boolean;
  /**
   * Action tools: turns checked inputs (picks already resolved to their rows) into a proposal, or
   * says why not. Pure: nothing is queued here; the runner queues it at the gateway after the run.
   */
  stage?: (input: Record<string, string | number | Pick>, ctx: ToolCtx) => Staged | { problem: string };
  /** Action tools: the only agents the gateway lets use it (hard rule), copied from core/gateway. */
  agents?: readonly string[];
}

export const paramsOf = (t: ToolDef, ctx: ToolCtx): readonly Param[] => (t.paramsFor ? t.paramsFor(ctx) : t.params);

/** The checked input: every param present and inside its range or list, extra keys dropped. Null with the reason when a value is wrong. */
export function checkInput(params: readonly Param[], raw: unknown): { input: Record<string, string | number> } | { problem: string } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const input: Record<string, string | number> = {};
  for (const p of params) {
    const v = src[p.name];
    if (p.type === "int") {
      if (v === undefined || v === null) { input[p.name] = p.default; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < p.min || n > p.max) return { problem: `${p.name} must be a whole number from ${p.min} to ${p.max}` };
      input[p.name] = n;
    } else if (p.type === "text") {
      if (v === undefined || v === null || v === "") { if (p.optional) continue; return { problem: `${p.name} is required` }; }
      if (typeof v !== "string") return { problem: `${p.name} must be text` };
      const t = v.replace(/\s+/g, " ").trim();
      if (!t) { if (p.optional) continue; return { problem: `${p.name} is required` }; }
      if (t.length > p.maxLength) return { problem: `${p.name} is longer than ${p.maxLength} characters` };
      if (/[\u0000-\u001f]|https?:\/\/|www\./i.test(t)) return { problem: `${p.name} may not hold links or control characters` };
      input[p.name] = t;
    } else if (p.type === "pick") {
      // checked for shape here; the runner resolves it against the picks of that step
      if (v === undefined || v === null) { if (p.optional) continue; return { problem: `${p.name} is required: name a row from a tool result by its step and pick` }; }
      const o = (typeof v === "object" ? v : {}) as Record<string, unknown>;
      const step = Number(o.step);
      if (!Number.isInteger(step) || step < 0 || typeof o.pick !== "string" || !/^[a-z]{1,3}\d{1,4}$/.test(o.pick)) return { problem: `${p.name} must be { step, pick } from a tool result` };
      input[p.name] = JSON.stringify({ step, pick: o.pick });
    } else {
      if (v === undefined || v === null) {
        if (p.default === undefined) return { problem: `${p.name} is required` };
        input[p.name] = p.default; continue;
      }
      if (typeof v !== "string" || !p.options.includes(v)) return { problem: `${p.name} must be one of: ${p.options.join(", ")}` };
      input[p.name] = v;
    }
  }
  return { input };
}

/** JSON Schema for the Claude API, from the params. */
export function inputSchema(params: readonly Param[]) {
  const properties: Record<string, unknown> = {};
  for (const p of params) {
    properties[p.name] = p.type === "int"
      ? { type: "integer", minimum: p.min, maximum: p.max, description: `${p.description} Default ${p.default}.` }
      : p.type === "text"
        ? { type: "string", maxLength: p.maxLength, description: `${p.description} Plain text, no links.` }
        : p.type === "pick"
          ? { type: "object", properties: { step: { type: "integer" }, pick: { type: "string" } }, required: ["step", "pick"], additionalProperties: false, description: `${p.description} Name a row by the step number and pick code shown with a tool result in this run.` }
          : { type: "string", enum: [...p.options], description: p.description };
  }
  const required = params.filter((p) => (p.type === "enum" && p.default === undefined) || ((p.type === "pick" || p.type === "text") && !p.optional)).map((p) => p.name);
  return { type: "object" as const, properties, required, additionalProperties: false };
}
